/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

const RESERVED = new Set(['Id', 'OwnerId', 'ExternalId']);

export function parseSoql(soql) {
  if (/;|--|\/\*/.test(soql)) throw new Error('SOQL comments and statement separators are not permitted');
  const match = String(soql).trim().match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
  if (!match) throw new Error('unsupported SOQL query');
  return {
    fields: match[1].split(',').map((v) => v.trim()),
    objectType: match[2],
    where: match[3]?.trim(),
    limit: match[4] ? Number.parseInt(match[4], 10) : 200
  };
}

export function transpileSoql(soql, companyId) {
  const parsed = parseSoql(soql);
  const select = parsed.fields.map(selectExpr).join(', ');
  const where = parsed.where ? ` AND ${whereExpr(parsed.where)}` : '';
  return {
    sql: `SELECT ${select} FROM sf_record WHERE object_type = $1 AND company_id = $2 AND is_deleted = false${where} LIMIT ${parsed.limit}`,
    params: [parsed.objectType, companyId],
    parsed
  };
}

function selectExpr(field) {
  if (field === 'Id') return 'sf_id AS "Id"';
  if (field === 'OwnerId') return 'owner_id AS "OwnerId"';
  if (field === 'ExternalId') return 'external_id AS "ExternalId"';
  if (/Amount|Total|Price|Quantity|Probability/i.test(field)) return `(fields->>'${field}')::numeric AS "${field}"`;
  return `fields->>'${field}' AS "${field}"`;
}

function whereExpr(where) {
  return where.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*'([^']*)'/g, (_, field, value) => {
    if (field === 'Id') return `sf_id = '${escapeSql(value)}'`;
    if (RESERVED.has(field)) return `${field === 'OwnerId' ? 'owner_id' : 'external_id'} = '${escapeSql(value)}'`;
    return `fields->>'${field}' = '${escapeSql(value)}'`;
  }).replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*>\s*'([^']*)'/g, (_, field, value) => {
    return `fields->>'${field}' > '${escapeSql(value)}'`;
  });
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}
