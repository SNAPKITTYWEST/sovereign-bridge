/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

const TABLE_MAP = Object.freeze({
  Account: 'account',
  Invoice: 'invoice',
  Bill: 'vendor_bill',
  Vendor: 'vendor',
  Customer: 'customer',
  Class: 'qbo_class',
  Department: 'qbo_department',
  TaxCode: 'qbo_taxcode'
});

const FIELD_MAP = Object.freeze({
  Id: 'id',
  Name: 'name',
  DisplayName: 'name',
  TxnDate: 'tran_date',
  DueDate: 'due_date',
  TotalAmt: 'total',
  Balance: 'amount_remaining',
  Active: 'NOT isinactive',
  AcctNum: 'acctnumber'
});

export function transpileQboQuery(query, companyId = 1) {
  const parsed = parseQboSelect(query);
  const table = TABLE_MAP[parsed.entity];
  if (!table) throw new Error(`unsupported QBO query entity: ${parsed.entity}`);
  const columns = parsed.fields.includes('*')
    ? '*'
    : parsed.fields.map((f) => `${mapField(f)} AS "${f}"`).join(', ');
  const where = parsed.where ? ` AND ${mapWhere(parsed.where)}` : '';
  const limit = Number.isFinite(parsed.limit) ? ` LIMIT ${parsed.limit}` : ' LIMIT 25';
  return `SELECT ${columns} FROM ${table} WHERE company_id = ${Number(companyId)}${where}${limit}`;
}

export function parseQboSelect(query) {
  if (/;|--|\/\*/.test(query)) throw new Error('QBO query comments and statement separators are not permitted');
  const match = String(query).trim().match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)\s*(?:WHERE\s+(.+?))?\s*(?:MAXRESULTS\s+(\d+))?$/i);
  if (!match) throw new Error('unsupported QBO SQL query');
  return {
    fields: match[1].split(',').map((v) => v.trim()),
    entity: canonicalEntity(match[2]),
    where: match[3]?.trim(),
    limit: match[4] ? Number.parseInt(match[4], 10) : 25
  };
}

function canonicalEntity(entity) {
  const found = Object.keys(TABLE_MAP).find((name) => name.toLowerCase() === String(entity).toLowerCase());
  return found || entity;
}

function mapField(field) {
  if (field === '*') return '*';
  return FIELD_MAP[field] || snake(field);
}

function mapWhere(where) {
  return where
    .replace(/\bTxnDate\b/g, 'tran_date')
    .replace(/\bDueDate\b/g, 'due_date')
    .replace(/\bTotalAmt\b/g, 'total')
    .replace(/\bBalance\b/g, 'amount_remaining')
    .replace(/\bId\b/g, 'id')
    .replace(/\bName\b/g, 'name')
    .replace(/\bDisplayName\b/g, 'name');
}

function snake(value) {
  return String(value).replace(/[A-Z]/g, (m, i) => `${i ? '_' : ''}${m.toLowerCase()}`);
}
