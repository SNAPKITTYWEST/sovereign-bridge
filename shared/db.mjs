/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.PG_POOL_MAX || '20', 10)
} : {
  host: process.env.PG_HOST || 'localhost',
  port: Number.parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DB || 'sovereignsuite',
  user: process.env.PG_USER || 'sovereign_app',
  password: process.env.PG_PASS || '',
  max: Number.parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000
});

pool.on('error', (err) => {
  console.error('[SOVEREIGNBRIDGE] PostgreSQL pool error:', err.message);
});

export function companyIdFrom(req) {
  const value = req.headers['x-company-id'] || req.query?.companyId || req.params?.companyId || '1';
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw Object.assign(new Error('invalid company id'), { statusCode: 400 });
  }
  return parsed;
}

export async function withCompany(companyId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.company_id', String(companyId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function query(sql, params = []) {
  return pool.query(sql, params);
}
