/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { companyIdFrom, withCompany } from '../../shared/db.mjs';
import { requireGovernance } from '../../shared/governance.mjs';
import { logConflict, wormSeal } from './worm.mjs';
import { resolveRoute } from './routes.mjs';

const WRITE_COLUMNS = {
  account: ['company_id', 'external_id', 'accttype', 'acctnumber', 'name', 'description', 'currency'],
  vendor: ['company_id', 'external_id', 'name', 'email', 'phone', 'currency', 'payment_terms'],
  customer: ['company_id', 'external_id', 'name', 'email', 'phone', 'currency', 'payment_terms'],
  invoice: ['company_id', 'external_id', 'customer_id', 'tran_date', 'due_date', 'status', 'memo', 'subtotal', 'tax_amount', 'total', 'amount_remaining'],
  vendor_bill: ['company_id', 'external_id', 'vendor_id', 'tran_date', 'due_date', 'status', 'memo', 'subtotal', 'tax_amount', 'total', 'amount_due'],
  purchase_order: ['company_id', 'vendor_id', 'po_number', 'tran_date', 'status', 'memo'],
  journal_entry: ['company_id', 'external_id', 'tran_date', 'period_id', 'memo', 'currency', 'status'],
  bridge_external_ref: ['company_id', 'source_system', 'source_resource', 'source_id', 'sovereign_table', 'sovereign_id']
};

const ID_COLUMNS = {
  account: 'account_id',
  vendor: 'vendor_id',
  customer: 'customer_id',
  invoice: 'invoice_id',
  vendor_bill: 'bill_id',
  purchase_order: 'po_id',
  journal_entry: 'je_id',
  bridge_external_ref: 'ref_id'
};

export function createServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, service: 'bisoft-connector' }));

  app.post('/bridge/:target/:resource', async (req, reply) => {
    const company_id = companyIdFrom(req);
    const { target, resource } = req.params;
    const route = resolveRoute(target, resource, req.body || {});
    const actor = req.headers['x-agent-name'] || 'SOVEREIGNBRIDGE';

    await requireGovernance({ actor, action: 'bridge.create', resource: `${target}.${resource}`, payload: req.body, method: 'POST' });

    const sovereign = await withCompany(company_id, async (client) => {
      const existing = await findExisting(client, route.table, company_id, req.body);
      if (existing) {
        await logConflict({
          company_id,
          source_system: target,
          source_resource: resource,
          source_id: externalId(req.body),
          sovereign_table: route.table,
          sovereign_id: existing[ID_COLUMNS[route.table]] ?? externalId(req.body),
          original_payload: req.body
        });
        return { record: existing, conflict: true };
      }
      return { record: await insertMapped(client, route, company_id, req.body), conflict: false };
    });

    const id = sovereign.record?.[ID_COLUMNS[route.table]] ?? sovereign.record?.sovereign_id ?? externalId(req.body);
    const seal = await wormSeal({
      source_system: target,
      original_payload: req.body,
      sovereign_id: id,
      company_id,
      table_name: route.table,
      record_id: id
    });

    return reply.code(sovereign.conflict ? 409 : 201).send(toTargetShape(target, resource, sovereign.record, seal, sovereign.conflict));
  });

  app.get('/bridge/:target/:resource/:id', async (req) => {
    const company_id = companyIdFrom(req);
    const { target, resource, id } = req.params;
    const route = resolveRoute(target, resource, {});
    const record = await withCompany(company_id, async (client) => findById(client, route.table, id, company_id));
    const seal = await wormSeal({
      source_system: target,
      original_payload: { method: 'GET', resource, id },
      sovereign_id: id,
      company_id,
      event_type: 'BRIDGE_READ',
      table_name: route.table,
      record_id: id
    });
    return toTargetShape(target, resource, record, seal, false);
  });

  return app;
}

async function findExisting(client, table, company_id, payload) {
  const idColumn = ID_COLUMNS[table];
  if (!idColumn) return null;
  const sourceId = externalId(payload);
  if (sourceId) {
    const { rows } = await client.query(`SELECT * FROM ${table} WHERE company_id = $1 AND external_id = $2 LIMIT 1`, [company_id, sourceId]).catch(() => ({ rows: [] }));
    if (rows[0]) return rows[0];
  }
  return null;
}

async function findById(client, table, id, company_id) {
  const idColumn = ID_COLUMNS[table];
  if (!idColumn) throw Object.assign(new Error(`unsupported table: ${table}`), { statusCode: 400 });
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE company_id = $1 AND ${idColumn}::text = $2 LIMIT 1`, [company_id, String(id)]);
  if (!rows[0]) throw Object.assign(new Error('record not found'), { statusCode: 404 });
  return rows[0];
}

async function insertMapped(client, route, company_id, payload) {
  const table = route.table;
  const cols = WRITE_COLUMNS[table];
  if (!cols) throw Object.assign(new Error(`write mapping not implemented for ${table}`), { statusCode: 501 });
  const mapped = mapPayloadToTable(table, route, company_id, payload);
  const insertCols = cols.filter((col) => mapped[col] !== undefined);
  const values = insertCols.map((col) => mapped[col]);
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return rows[0];
}

function mapPayloadToTable(table, route, company_id, payload = {}) {
  const sourceId = externalId(payload) || randomUUID();
  if (table === 'bridge_external_ref') {
    return {
      company_id,
      source_system: route.target,
      source_resource: route.sourceResource,
      source_id: sourceId,
      sovereign_table: route.transactionType || route.mapping || 'bridge',
      sovereign_id: payload.sovereign_id || randomUUID()
    };
  }
  if (table === 'account') {
    return {
      company_id,
      external_id: sourceId,
      accttype: payload.AccountType || payload.accttype || payload.Classification || 'Expense',
      acctnumber: payload.AcctNum || payload.acctnumber || payload.FullyQualifiedName || sourceId.slice(0, 31),
      name: payload.Name || payload.name || payload.FullyQualifiedName || 'Bridge Account',
      description: payload.Description || payload.description || null,
      currency: payload.CurrencyRef?.value || payload.currency || 'USD'
    };
  }
  if (table === 'vendor' || table === 'customer') {
    return {
      company_id,
      external_id: sourceId,
      name: payload.DisplayName || payload.Name || payload.name || payload.CompanyName || `${table}-${sourceId}`,
      email: payload.PrimaryEmailAddr?.Address || payload.Email || payload.email || null,
      phone: payload.PrimaryPhone?.FreeFormNumber || payload.Phone || payload.phone || null,
      currency: payload.CurrencyRef?.value || payload.currency || 'USD',
      payment_terms: payload.TermsRef?.name || payload.payment_terms || 'Net30'
    };
  }
  if (table === 'invoice') {
    return {
      company_id,
      external_id: sourceId,
      customer_id: Number(payload.customer_id || payload.CustomerRef?.value || 1),
      tran_date: payload.TxnDate || payload.tran_date || new Date().toISOString().slice(0, 10),
      due_date: payload.DueDate || payload.due_date || new Date().toISOString().slice(0, 10),
      status: payload.status || 'open',
      memo: payload.PrivateNote || payload.Description || payload.memo || null,
      subtotal: Number(payload.SubTotal || payload.subtotal || payload.Amount || 0),
      tax_amount: Number(payload.TxnTaxDetail?.TotalTax || payload.tax_amount || 0),
      total: Number(payload.TotalAmt || payload.total || payload.Amount || 0),
      amount_remaining: Number(payload.Balance || payload.amount_remaining || payload.TotalAmt || payload.Amount || 0)
    };
  }
  if (table === 'vendor_bill') {
    return {
      company_id,
      external_id: sourceId,
      vendor_id: Number(payload.vendor_id || payload.VendorRef?.value || 1),
      tran_date: payload.TxnDate || payload.tran_date || new Date().toISOString().slice(0, 10),
      due_date: payload.DueDate || payload.due_date || new Date().toISOString().slice(0, 10),
      status: payload.status || 'open',
      memo: payload.PrivateNote || payload.memo || null,
      subtotal: Number(payload.SubTotal || payload.subtotal || 0),
      tax_amount: Number(payload.TxnTaxDetail?.TotalTax || payload.tax_amount || 0),
      total: Number(payload.TotalAmt || payload.total || 0),
      amount_due: Number(payload.Balance || payload.amount_due || payload.TotalAmt || 0)
    };
  }
  if (table === 'purchase_order') {
    return {
      company_id,
      vendor_id: Number(payload.vendor_id || payload.VendorRef?.value || 1),
      po_number: payload.DocNumber || payload.po_number || sourceId,
      tran_date: payload.TxnDate || payload.tran_date || new Date().toISOString().slice(0, 10),
      status: payload.status || 'open',
      memo: payload.PrivateNote || payload.memo || null
    };
  }
  return { company_id, external_id: sourceId };
}

function externalId(payload = {}) {
  return payload.Id || payload.id || payload.ID || payload.external_id || payload.ExternalId || payload.DocNumber || null;
}

function toTargetShape(target, resource, record, seal, conflict) {
  const base = { seal: seal.this_hash, worm_seq: seal.seq, conflict: Boolean(conflict), sovereign: record };
  if (target === 'quickbooks') return { [capitalize(resource)]: record, time: new Date().toISOString(), ...base };
  if (target === 'salesforce') return { id: record?.sf_id || record?.external_id || record?.id, success: !conflict, errors: conflict ? ['sovereign authoritative conflict'] : [], ...base };
  if (target === 'sap') return { d: record, '@SovereignBridge.seal': seal.this_hash, conflict: Boolean(conflict) };
  return base;
}

function capitalize(value) {
  const text = String(value || 'record');
  return text[0].toUpperCase() + text.slice(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.BISOFT_PORT || '8080', 10);
  createServer().listen({ port, host: '0.0.0.0' });
}
