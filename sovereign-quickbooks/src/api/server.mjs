/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { companyIdFrom, pool, withCompany } from '../../../shared/db.mjs';
import { requireGovernance } from '../../../shared/governance.mjs';
import { wormSeal } from '../../../shared/worm.mjs';
import { transpileQboQuery } from '../suiteql/qbo_query.mjs';
import { ingestWebhook } from '../webhooks/handler.mjs';

const ENTITY = {
  account: { table: 'account', id: 'account_id', qbo: 'Account' },
  invoice: { table: 'invoice', id: 'invoice_id', qbo: 'Invoice' },
  bill: { table: 'vendor_bill', id: 'bill_id', qbo: 'Bill' },
  vendor: { table: 'vendor', id: 'vendor_id', qbo: 'Vendor' },
  customer: { table: 'customer', id: 'customer_id', qbo: 'Customer' }
};

export function createServer() {
  const app = Fastify({
    logger: true,
    bodyLimit: 8 * 1024 * 1024
  });
  app.register(cors, { origin: true });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    try {
      done(null, JSON.parse(body.toString('utf8') || '{}'));
    } catch (err) {
      done(err);
    }
  });

  app.get('/health', async () => ({ ok: true, service: 'sovereign-quickbooks' }));

  app.post('/oauth2/v1/tokens/bearer', async (req) => {
    const actor = req.body?.client_id || 'qbo-client';
    return {
      token_type: 'bearer',
      access_token: `sovereign_${Buffer.from(`${actor}:${Date.now()}`).toString('base64url')}`,
      refresh_token: `refresh_${randomUUID()}`,
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400
    };
  });

  app.get('/v3/company/:companyId/account', async (req) => listEntity(req, 'account'));
  app.post('/v3/company/:companyId/account', async (req, reply) => createEntity(req, reply, 'account'));
  app.get('/v3/company/:companyId/invoice/:id', async (req) => getEntity(req, 'invoice'));
  app.post('/v3/company/:companyId/invoice', async (req, reply) => createEntity(req, reply, 'invoice'));
  app.post('/v3/company/:companyId/invoice/:id', async (req, reply) => voidInvoice(req, reply));
  app.get('/v3/company/:companyId/bill/:id', async (req) => getEntity(req, 'bill'));
  app.post('/v3/company/:companyId/bill', async (req, reply) => createEntity(req, reply, 'bill'));
  app.get('/v3/company/:companyId/vendor', async (req) => listEntity(req, 'vendor'));
  app.post('/v3/company/:companyId/vendor', async (req, reply) => createEntity(req, reply, 'vendor'));
  app.get('/v3/company/:companyId/customer', async (req) => listEntity(req, 'customer'));
  app.post('/v3/company/:companyId/customer', async (req, reply) => createEntity(req, reply, 'customer'));

  app.post('/v3/company/:companyId/query', async (req) => {
    const companyId = companyIdFrom(req);
    const statement = req.body?.query || req.body?.Query || req.body;
    const sql = transpileQboQuery(String(statement), companyId);
    const { rows } = await pool.query(sql);
    const entityName = inferQueryEntity(String(statement));
    return qboQueryEnvelope(entityName, rows.map((row) => toQbo(entityName.toLowerCase(), row)), 1, rows.length);
  });

  app.get('/v3/company/:companyId/reports/BalanceSheet', async (req) => report(req, 'BalanceSheet'));
  app.get('/v3/company/:companyId/reports/ProfitAndLoss', async (req) => report(req, 'ProfitAndLoss'));
  app.get('/v3/company/:companyId/reports/AgedPayables', async (req) => report(req, 'AgedPayables'));
  app.get('/v3/company/:companyId/reports/AgedReceivables', async (req) => report(req, 'AgedReceivables'));

  app.post('/webhooks', async (req, reply) => {
    const companyId = Number.parseInt(req.body?.eventNotifications?.[0]?.realmId || req.headers['x-company-id'] || '1', 10);
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const result = await ingestWebhook({
      companyId,
      payload: req.body,
      rawBody,
      signature: req.headers['intuit-signature']
    });
    return reply.code(result.verification.ok ? 200 : 401).send({ ok: result.verification.ok, seal: result.seal.this_hash });
  });

  return app;
}

async function listEntity(req, kind) {
  const companyId = companyIdFrom(req);
  const spec = ENTITY[kind];
  const { rows } = await pool.query(`SELECT * FROM ${spec.table} WHERE company_id = $1 ORDER BY ${spec.id} LIMIT 100`, [companyId]);
  return qboQueryEnvelope(spec.qbo, rows.map((row) => toQbo(kind, row)), 1, rows.length);
}

async function getEntity(req, kind) {
  const companyId = companyIdFrom(req);
  const spec = ENTITY[kind];
  const { rows } = await pool.query(`SELECT * FROM ${spec.table} WHERE company_id = $1 AND ${spec.id}::text = $2 LIMIT 1`, [companyId, String(req.params.id)]);
  if (!rows[0]) throw Object.assign(new Error(`${spec.qbo} not found`), { statusCode: 404 });
  return { [spec.qbo]: toQbo(kind, rows[0]), time: new Date().toISOString() };
}

async function createEntity(req, reply, kind) {
  const companyId = companyIdFrom(req);
  const spec = ENTITY[kind];
  await requireGovernance({ actor: req.headers['x-agent-name'] || 'qbo-shell', action: `qbo.${kind}.create`, resource: kind, payload: req.body, method: 'POST' });
  const record = await withCompany(companyId, async (client) => insertEntity(client, kind, companyId, req.body?.[spec.qbo] || req.body || {}));
  await wormSeal({
    source_system: 'quickbooks',
    original_payload: req.body,
    sovereign_id: record[spec.id],
    company_id: companyId,
    table_name: spec.table,
    record_id: record[spec.id]
  });
  return reply.code(200).send({ [spec.qbo]: toQbo(kind, record), time: new Date().toISOString() });
}

async function voidInvoice(req, reply) {
  if (req.query.operation !== 'void') throw Object.assign(new Error('unsupported operation'), { statusCode: 400 });
  const companyId = companyIdFrom(req);
  await requireGovernance({ actor: req.headers['x-agent-name'] || 'qbo-shell', action: 'qbo.invoice.void', resource: 'invoice', payload: req.body, method: 'POST' });
  const { rows } = await pool.query(
    `UPDATE invoice SET status = 'voided', amount_remaining = 0 WHERE company_id = $1 AND invoice_id::text = $2 RETURNING *`,
    [companyId, String(req.params.id)]
  );
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  await wormSeal({ source_system: 'quickbooks', original_payload: { operation: 'void', id: req.params.id }, sovereign_id: req.params.id, company_id: companyId, table_name: 'invoice', record_id: req.params.id });
  return reply.send({ Invoice: toQbo('invoice', rows[0]), time: new Date().toISOString() });
}

async function insertEntity(client, kind, companyId, body) {
  if (kind === 'account') {
    const { rows } = await client.query(
      `INSERT INTO account (company_id, external_id, accttype, acctnumber, name, description, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, body.Id || body.SyncToken || null, body.AccountType || 'Expense', body.AcctNum || body.Name || randomUUID().slice(0, 8), body.Name || 'QBO Account', body.Description || null, body.CurrencyRef?.value || 'USD']
    );
    return rows[0];
  }
  if (kind === 'vendor' || kind === 'customer') {
    const table = ENTITY[kind].table;
    const { rows } = await client.query(
      `INSERT INTO ${table} (company_id, external_id, name, email, phone, currency, payment_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, body.Id || null, body.DisplayName || body.CompanyName || body.Name || `QBO ${kind}`, body.PrimaryEmailAddr?.Address || null, body.PrimaryPhone?.FreeFormNumber || null, body.CurrencyRef?.value || 'USD', body.TermsRef?.name || 'Net30']
    );
    return rows[0];
  }
  if (kind === 'invoice') {
    const { rows } = await client.query(
      `INSERT INTO invoice (company_id, external_id, customer_id, tran_date, due_date, status, memo, subtotal, tax_amount, total, amount_remaining)
       VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10) RETURNING *`,
      [companyId, body.Id || null, Number(body.CustomerRef?.value || body.customer_id || 1), body.TxnDate || today(), body.DueDate || today(), body.PrivateNote || null, Number(body.SubTotal || 0), Number(body.TxnTaxDetail?.TotalTax || 0), Number(body.TotalAmt || 0), Number(body.Balance || body.TotalAmt || 0)]
    );
    return rows[0];
  }
  const { rows } = await client.query(
    `INSERT INTO vendor_bill (company_id, external_id, vendor_id, tran_date, due_date, status, memo, subtotal, tax_amount, total, amount_due)
     VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10) RETURNING *`,
    [companyId, body.Id || null, Number(body.VendorRef?.value || body.vendor_id || 1), body.TxnDate || today(), body.DueDate || today(), body.PrivateNote || null, Number(body.SubTotal || 0), Number(body.TxnTaxDetail?.TotalTax || 0), Number(body.TotalAmt || 0), Number(body.Balance || body.TotalAmt || 0)]
  );
  return rows[0];
}

async function report(req, name) {
  const companyId = companyIdFrom(req);
  const view = name === 'AgedPayables' ? 'ap_aging' : name === 'AgedReceivables' ? 'ar_aging' : 'trial_balance';
  const { rows } = await pool.query(`SELECT * FROM ${view} WHERE company_id = $1 LIMIT 200`, [companyId]).catch(() => ({ rows: [] }));
  return {
    Header: { ReportName: name, Time: new Date().toISOString(), ReportBasis: 'Accrual' },
    Rows: { Row: rows.map((row) => ({ ColData: Object.values(row).map((value) => ({ value: String(value ?? '') })) })) }
  };
}

function qboQueryEnvelope(entityName, items, startPosition = 1, maxResults = 25) {
  return { QueryResponse: { [entityName]: items, startPosition, maxResults }, time: new Date().toISOString() };
}

function toQbo(kind, row) {
  if (kind === 'account') return { Id: String(row.account_id), Name: row.name, AcctNum: row.acctnumber, AccountType: row.accttype, Active: !row.isinactive, CurrencyRef: { value: row.currency } };
  if (kind === 'vendor') return { Id: String(row.vendor_id), DisplayName: row.name, PrimaryEmailAddr: row.email ? { Address: row.email } : undefined, PrimaryPhone: row.phone ? { FreeFormNumber: row.phone } : undefined, Active: !row.isinactive };
  if (kind === 'customer') return { Id: String(row.customer_id), DisplayName: row.name, PrimaryEmailAddr: row.email ? { Address: row.email } : undefined, PrimaryPhone: row.phone ? { FreeFormNumber: row.phone } : undefined, Active: !row.isinactive };
  if (kind === 'bill') return { Id: String(row.bill_id), VendorRef: { value: String(row.vendor_id) }, TxnDate: row.tran_date, DueDate: row.due_date, TotalAmt: row.total, Balance: row.amount_due, PrivateNote: row.memo };
  return { Id: String(row.invoice_id), CustomerRef: { value: String(row.customer_id) }, TxnDate: row.tran_date, DueDate: row.due_date, TotalAmt: row.total, Balance: row.amount_remaining, PrivateNote: row.memo };
}

function inferQueryEntity(query) {
  return query.match(/\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/i)?.[1] || 'Entity';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.QBO_PORT || '8081', 10);
  createServer().listen({ port, host: '0.0.0.0' });
}
