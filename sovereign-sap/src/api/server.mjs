/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fileURLToPath } from 'url';
import { companyIdFrom, pool } from '../../../shared/db.mjs';
import { requireGovernance } from '../../../shared/governance.mjs';
import { wormSeal } from '../../../shared/worm.mjs';
import { entityToTable, parseODataQuery, toSqlWhere } from '../odata/parser.mjs';
import { processIdoc } from '../idoc/processor.mjs';
import { routeBapi } from '../bapi/router.mjs';

const ID_COLUMNS = {
  customer: 'customer_id',
  vendor: 'vendor_id',
  journal_entry: 'je_id',
  purchase_order: 'po_id',
  invoice: 'invoice_id',
  item: 'item_id'
};

export function createServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, service: 'sovereign-sap' }));

  app.get('/sap/opu/odata4/:service/:entitySet', async (req) => {
    const companyId = companyIdFrom(req);
    const table = entityToTable(req.params.entitySet);
    const parsed = parseODataQuery(req.query);
    const where = toSqlWhere(parsed.filter);
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE company_id = $1${where.clause} LIMIT $2 OFFSET $${where.params.length ? 4 : 3}`,
      where.params.length ? [companyId, parsed.top, ...where.params, parsed.skip] : [companyId, parsed.top, parsed.skip]
    );
    return { '@odata.context': `$metadata#${req.params.entitySet}`, value: rows };
  });

  app.get('/sap/opu/odata4/:service/:entitySet/:id', async (req) => {
    const companyId = companyIdFrom(req);
    const table = entityToTable(req.params.entitySet);
    const idCol = ID_COLUMNS[table];
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1 AND ${idCol}::text = $2 LIMIT 1`, [companyId, String(req.params.id)]);
    if (!rows[0]) throw Object.assign(new Error('OData entity not found'), { statusCode: 404 });
    return rows[0];
  });

  app.post('/sap/bapi/:name', async (req) => {
    const companyId = companyIdFrom(req);
    await requireGovernance({ actor: req.headers['x-agent-name'] || 'sap-shell', action: 'sap.bapi', resource: req.params.name, payload: req.body, method: 'POST' });
    const routed = routeBapi(req.params.name, req.body || {});
    const seal = await wormSeal({ source_system: 'sap', original_payload: req.body, sovereign_id: req.params.name, company_id: companyId, table_name: routed.sovereign_record_type, record_id: req.params.name, event_type: 'SAP_BAPI' });
    return { ...routed, worm: seal.this_hash };
  });

  app.post('/sap/idoc', async (req) => {
    const companyId = companyIdFrom(req);
    await requireGovernance({ actor: req.headers['x-agent-name'] || 'sap-shell', action: 'sap.idoc', resource: req.body?.IDOCTYP || 'idoc', payload: req.body, method: 'POST' });
    const processed = processIdoc(req.body || {});
    const seal = await wormSeal({ source_system: 'sap', original_payload: req.body, sovereign_id: processed.sovereign_payload.external_id, company_id: companyId, table_name: 'idoc', record_id: processed.sovereign_payload.external_id, event_type: 'SAP_IDOC' });
    return { ...processed, worm: seal.this_hash };
  });

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.SAP_PORT || '8083', 10);
  createServer().listen({ port, host: '0.0.0.0' });
}
