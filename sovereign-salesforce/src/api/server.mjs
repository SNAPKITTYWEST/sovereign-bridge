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
import { transpileSoql } from '../soql/engine.mjs';
import { transpileSosl } from '../sosl/engine.mjs';
import { runTriggers } from '../triggers/loader.mjs';

const STANDARD_OBJECTS = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Task', 'Event'];
const DEFAULT_FIELDS = ['Id', 'Name', 'OwnerId', 'CreatedDate', 'LastModifiedDate'];

export function createServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, service: 'sovereign-salesforce' }));

  app.post('/services/oauth2/token', async (req) => ({
    access_token: `sf_sovereign_${Buffer.from(`${req.body?.client_id || 'connected-app'}:${Date.now()}`).toString('base64url')}`,
    instance_url: process.env.SF_INSTANCE_URL || 'http://localhost:8082',
    id: `${process.env.SF_INSTANCE_URL || 'http://localhost:8082'}/id/sovereign/${req.body?.client_id || 'app'}`,
    token_type: 'Bearer',
    issued_at: String(Date.now()),
    signature: 'sovereign-session'
  }));

  app.get('/services/data/v60.0/', async () => ({ versions: [{ label: 'Winter Sovereign', url: '/services/data/v60.0', version: '60.0' }] }));
  app.get('/services/data/v60.0/sobjects/', async (req) => objectCatalog(companyIdFrom(req)));
  app.get('/services/data/v60.0/sobjects/:type/describe', async (req) => describeObject(companyIdFrom(req), req.params.type));
  app.post('/services/data/v60.0/sobjects/:type/', async (req, reply) => createRecord(req, reply));
  app.get('/services/data/v60.0/sobjects/:type/:id', async (req) => getRecord(req));
  app.patch('/services/data/v60.0/sobjects/:type/:id', async (req, reply) => updateRecord(req, reply));
  app.delete('/services/data/v60.0/sobjects/:type/:id', async (req, reply) => deleteRecord(req, reply));
  app.get('/services/data/v60.0/sobjects/:type/:id/:field', async (req, reply) => blobField(req, reply));
  app.post('/services/data/v60.0/query/', async (req) => query(req));
  app.post('/services/data/v60.0/search/', async (req) => search(req));
  app.post('/services/data/v60.0/composite/', async (req) => composite(req));
  app.post('/services/data/v60.0/composite/tree/:type', async (req, reply) => treeInsert(req, reply));

  return app;
}

async function objectCatalog(companyId) {
  const { rows } = await pool.query('SELECT api_name, label, custom FROM sf_object WHERE company_id = $1 ORDER BY api_name', [companyId]).catch(() => ({ rows: [] }));
  const objects = rows.length ? rows : STANDARD_OBJECTS.map((name) => ({ api_name: name, label: name, custom: false }));
  return { encoding: 'UTF-8', maxBatchSize: 200, sobjects: objects.map((o) => ({ name: o.api_name, label: o.label, custom: o.custom, keyPrefix: o.api_name.slice(0, 3) })) };
}

async function describeObject(companyId, type) {
  const { rows } = await pool.query('SELECT api_name, label, field_type, nillable FROM sf_field WHERE company_id = $1 AND object_type = $2 ORDER BY api_name', [companyId, type]).catch(() => ({ rows: [] }));
  const fields = rows.length ? rows.map((r) => ({ name: r.api_name, label: r.label, type: r.field_type, nillable: r.nillable })) : DEFAULT_FIELDS.map((name) => ({ name, label: name, type: name === 'Id' ? 'id' : 'string', nillable: name !== 'Id' }));
  return { name: type, label: type, fields, createable: true, updateable: true, deletable: true, queryable: true };
}

async function createRecord(req, reply) {
  const companyId = companyIdFrom(req);
  const type = req.params.type;
  await requireGovernance({ actor: req.headers['x-agent-name'] || 'sf-shell', action: 'sf.create', resource: type, payload: req.body, method: 'POST' });
  const before = await runTriggers({ companyId, objectType: type, eventName: 'before insert', record: req.body });
  const sfId = idFor(type);
  const row = await withCompany(companyId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO sf_record (company_id, object_type, sf_id, external_id, fields, owner_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [companyId, type, sfId, req.body?.ExternalId || null, JSON.stringify(req.body || {}), req.body?.OwnerId || null]
    );
    return rows[0];
  });
  const seal = await wormSeal({ source_system: 'salesforce', original_payload: req.body, sovereign_id: sfId, company_id: companyId, table_name: 'sf_record', record_id: sfId, event_type: 'SF_SOBJECT_MUTATION' });
  await runTriggers({ companyId, objectType: type, eventName: 'after insert', record: row, context: { before } });
  return reply.code(201).send({ id: sfId, success: true, errors: [], worm: seal.this_hash });
}

async function getRecord(req) {
  const companyId = companyIdFrom(req);
  const { type, id } = req.params;
  const { rows } = await pool.query('SELECT * FROM sf_record WHERE company_id = $1 AND object_type = $2 AND sf_id = $3 AND is_deleted = false LIMIT 1', [companyId, type, id]);
  if (!rows[0]) throw Object.assign(new Error('sobject not found'), { statusCode: 404 });
  return sfResponse(rows[0]);
}

async function updateRecord(req, reply) {
  const companyId = companyIdFrom(req);
  const { type, id } = req.params;
  await requireGovernance({ actor: req.headers['x-agent-name'] || 'sf-shell', action: 'sf.update', resource: type, payload: req.body, method: 'PATCH' });
  await runTriggers({ companyId, objectType: type, eventName: 'before update', record: req.body });
  const { rows } = await pool.query(
    `UPDATE sf_record
     SET fields = fields || $4::jsonb, owner_id = COALESCE($5, owner_id), updated_at = now()
     WHERE company_id = $1 AND object_type = $2 AND sf_id = $3 AND is_deleted = false
     RETURNING *`,
    [companyId, type, id, JSON.stringify(req.body || {}), req.body?.OwnerId || null]
  );
  if (!rows[0]) throw Object.assign(new Error('sobject not found'), { statusCode: 404 });
  await wormSeal({ source_system: 'salesforce', original_payload: req.body, sovereign_id: id, company_id: companyId, table_name: 'sf_record', record_id: id, event_type: 'SF_SOBJECT_MUTATION' });
  await runTriggers({ companyId, objectType: type, eventName: 'after update', record: rows[0] });
  return reply.code(204).send();
}

async function deleteRecord(req, reply) {
  const companyId = companyIdFrom(req);
  const { type, id } = req.params;
  await requireGovernance({ actor: req.headers['x-agent-name'] || 'sf-shell', action: 'sf.delete', resource: type, payload: {}, method: 'DELETE' });
  const { rowCount } = await pool.query('UPDATE sf_record SET is_deleted = true, updated_at = now() WHERE company_id = $1 AND object_type = $2 AND sf_id = $3', [companyId, type, id]);
  if (!rowCount) throw Object.assign(new Error('sobject not found'), { statusCode: 404 });
  await wormSeal({ source_system: 'salesforce', original_payload: { deleted: true }, sovereign_id: id, company_id: companyId, table_name: 'sf_record', record_id: id, event_type: 'SF_SOBJECT_MUTATION' });
  return reply.code(204).send();
}

async function blobField(req, reply) {
  const companyId = companyIdFrom(req);
  const { rows } = await pool.query(
    `SELECT * FROM sf_attachment WHERE company_id = $1 AND object_type = $2 AND sf_id = $3 AND field_name = $4 ORDER BY attachment_id DESC LIMIT 1`,
    [companyId, req.params.type, req.params.id, req.params.field]
  ).catch(() => ({ rows: [] }));
  if (!rows[0]) throw Object.assign(new Error('blob field not found'), { statusCode: 404 });
  return reply.send({ minio_bucket: rows[0].minio_bucket, minio_key: rows[0].minio_key, content_type: rows[0].content_type });
}

async function query(req) {
  const companyId = companyIdFrom(req);
  const { sql, params } = transpileSoql(req.body?.q || req.body?.query || '', companyId);
  const { rows } = await pool.query(sql, params);
  return { totalSize: rows.length, done: true, records: rows.map((r) => ({ attributes: { type: inferObject(req.body?.q || req.body?.query), url: null }, ...r })) };
}

async function search(req) {
  const companyId = companyIdFrom(req);
  const plans = transpileSosl(req.body?.q || req.body?.search || '', companyId);
  const searchRecords = [];
  for (const plan of plans) {
    const { rows } = await pool.query(plan.sql, plan.params);
    searchRecords.push(...rows.map((row) => ({ attributes: { type: plan.objectType }, ...row })));
  }
  return { searchRecords };
}

async function composite(req) {
  const requests = req.body?.compositeRequest || [];
  return { compositeResponse: requests.map((r, i) => ({ body: { referenceId: r.referenceId || `ref${i}`, accepted: true }, httpHeaders: {}, httpStatusCode: 200, referenceId: r.referenceId || `ref${i}` })) };
}

async function treeInsert(req, reply) {
  const companyId = companyIdFrom(req);
  const type = req.params.type;
  const records = req.body?.records || [];
  const results = [];
  for (const record of records) {
    const sfId = idFor(type);
    await pool.query(
      'INSERT INTO sf_record (company_id, object_type, sf_id, external_id, fields, owner_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)',
      [companyId, type, sfId, record.referenceId || null, JSON.stringify(record), record.OwnerId || null]
    );
    await wormSeal({ source_system: 'salesforce', original_payload: record, sovereign_id: sfId, company_id: companyId, table_name: 'sf_record', record_id: sfId, event_type: 'SF_TREE_INSERT' });
    results.push({ referenceId: record.referenceId, id: sfId });
  }
  return reply.code(201).send({ hasErrors: false, results });
}

function sfResponse(row) {
  return { attributes: { type: row.object_type, url: `/services/data/v60.0/sobjects/${row.object_type}/${row.sf_id}` }, Id: row.sf_id, OwnerId: row.owner_id, ...row.fields };
}

function idFor(type) {
  return `${type.slice(0, 3).padEnd(3, 'X')}${randomUUID().replace(/-/g, '').slice(0, 15)}`;
}

function inferObject(soql) {
  return String(soql).match(/\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/i)?.[1] || 'Record';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.SF_PORT || '8082', 10);
  createServer().listen({ port, host: '0.0.0.0' });
}
