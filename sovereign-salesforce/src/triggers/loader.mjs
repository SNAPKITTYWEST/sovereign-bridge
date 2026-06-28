/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import { pool } from '../../../shared/db.mjs';

export async function loadTriggers(companyId, objectType, eventName) {
  const { rows } = await pool.query(
    `SELECT * FROM sf_trigger
     WHERE company_id = $1 AND object_type = $2 AND event_name = $3 AND active = true
     ORDER BY trigger_id`,
    [companyId, objectType, eventName]
  ).catch(() => ({ rows: [] }));
  return rows;
}

export async function runTriggers({ companyId, objectType, eventName, record, context = {} }) {
  const triggers = await loadTriggers(companyId, objectType, eventName);
  return triggers.map((trigger) => ({
    trigger_id: trigger.trigger_id,
    handler: trigger.handler,
    status: 'queued_for_suiteflow',
    context: { objectType, eventName, sf_id: record?.sf_id, ...context }
  }));
}
