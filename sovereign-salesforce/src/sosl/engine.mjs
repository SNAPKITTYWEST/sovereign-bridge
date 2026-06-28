/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

export function parseSosl(sosl) {
  const match = String(sosl).trim().match(/^FIND\s+\{([^}]+)\}\s+IN\s+ALL\s+FIELDS\s+RETURNING\s+(.+)$/i);
  if (!match) throw new Error('unsupported SOSL query');
  return {
    term: match[1],
    returning: match[2].split(/\s*,\s*(?=[A-Za-z][A-Za-z0-9_]*\()/).map(parseReturning)
  };
}

export function transpileSosl(sosl, companyId) {
  const parsed = parseSosl(sosl);
  return parsed.returning.map((ret) => ({
    objectType: ret.objectType,
    fields: ret.fields,
    sql: `SELECT ${ret.fields.map((f) => f === 'Id' ? 'sf_id AS "Id"' : `fields->>'${f}' AS "${f}"`).join(', ')}
          FROM sf_record
          WHERE company_id = $1
            AND object_type = $2
            AND is_deleted = false
            AND fields::text ILIKE $3
          LIMIT 50`,
    params: [companyId, ret.objectType, `%${parsed.term}%`]
  }));
}

function parseReturning(text) {
  const match = text.match(/^([A-Za-z][A-Za-z0-9_]*)\(([^)]+)\)$/);
  if (!match) throw new Error(`invalid SOSL returning clause: ${text}`);
  return {
    objectType: match[1],
    fields: match[2].split(',').map((v) => v.trim())
  };
}
