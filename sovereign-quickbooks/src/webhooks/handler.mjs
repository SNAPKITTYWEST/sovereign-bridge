/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { pool } from '../../../shared/db.mjs';
import { wormSeal } from '../../../shared/worm.mjs';

export function verifyIntuitSignature(rawBody, signature, secret = process.env.QBO_WEBHOOK_SECRET || '') {
  if (!secret) return { ok: false, reason: 'missing QBO_WEBHOOK_SECRET' };
  if (!signature) return { ok: false, reason: 'missing intuit-signature' };
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(signature));
  if (expectedBuffer.length !== actualBuffer.length) return { ok: false, reason: 'signature length mismatch' };
  return { ok: timingSafeEqual(expectedBuffer, actualBuffer), expected };
}

export async function ingestWebhook({ companyId, payload, rawBody, signature }) {
  const verification = verifyIntuitSignature(rawBody, signature);
  const seal = await wormSeal({
    source_system: 'quickbooks',
    original_payload: payload,
    sovereign_id: payload?.eventNotifications?.[0]?.realmId || companyId,
    company_id: companyId,
    event_type: 'QBO_WEBHOOK',
    table_name: 'qbo_webhook_event',
    record_id: payload?.eventNotifications?.[0]?.realmId || companyId
  });

  await pool.query(
    `INSERT INTO qbo_webhook_event (company_id, intuit_event_id, payload, signature_ok, worm_seq)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [companyId, payload?.eventNotifications?.[0]?.id || null, JSON.stringify(payload), verification.ok, seal.seq]
  ).catch((err) => {
    if (!/qbo_webhook_event|relation .* does not exist/i.test(err.message)) throw err;
  });

  return { verification, seal };
}
