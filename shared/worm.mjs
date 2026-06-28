/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { pool } from './db.mjs';

export function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function wormSeal({
  source_system,
  original_payload,
  sovereign_id,
  timestamp = new Date().toISOString(),
  company_id = 1,
  event_type = 'BRIDGE_CALL',
  table_name = 'bridge',
  record_id = sovereign_id
}) {
  const payload = { source_system, original_payload, sovereign_id, timestamp };
  const { rows: prev } = await pool.query('SELECT this_hash FROM worm_chain ORDER BY seq DESC LIMIT 1');
  const prevHash = prev[0]?.this_hash || '';
  const thisHash = hashPayload({ prevHash, payload });

  try {
    const { rows } = await pool.query(
      `INSERT INTO worm_chain (event_type, table_name, record_id, payload, prev_hash, company_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING seq, this_hash`,
      [event_type, table_name, String(record_id ?? ''), JSON.stringify(payload), prevHash, company_id]
    );
    return { ...rows[0], payload };
  } catch (err) {
    if (!/worm_chain|relation .* does not exist/i.test(err.message)) throw err;
    return { seq: null, this_hash: thisHash, payload, degraded: true };
  }
}

export async function logConflict({ company_id, source_system, source_resource, source_id, sovereign_table, sovereign_id, original_payload }) {
  const seal = await wormSeal({
    source_system,
    original_payload,
    sovereign_id,
    company_id,
    event_type: 'BRIDGE_CONFLICT',
    table_name: sovereign_table,
    record_id: sovereign_id
  });

  await pool.query(
    `INSERT INTO bridge_conflict
       (company_id, source_system, source_resource, source_id, sovereign_table, sovereign_id, original_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT DO NOTHING`,
    [company_id, source_system, source_resource, source_id, sovereign_table, String(sovereign_id), JSON.stringify(original_payload ?? {})]
  ).catch((err) => {
    if (!/bridge_conflict|relation .* does not exist/i.test(err.message)) throw err;
  });

  return seal;
}
