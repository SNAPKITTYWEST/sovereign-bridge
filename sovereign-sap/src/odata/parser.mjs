/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

const ENTITY_TABLES = Object.freeze({
  A_BusinessPartner: 'customer',
  A_Customer: 'customer',
  A_Supplier: 'vendor',
  A_Product: 'item',
  A_JournalEntry: 'journal_entry',
  A_PurchaseOrder: 'purchase_order',
  A_SalesOrder: 'invoice'
});

export function entityToTable(entitySet) {
  const table = ENTITY_TABLES[entitySet];
  if (!table) throw new Error(`unsupported SAP OData entity set: ${entitySet}`);
  return table;
}

export function parseODataQuery(query = {}) {
  return {
    select: query.$select ? String(query.$select).split(',').map((v) => v.trim()) : ['*'],
    filter: query.$filter ? parseFilter(String(query.$filter)) : null,
    top: query.$top ? Math.min(Number.parseInt(query.$top, 10), 200) : 100,
    skip: query.$skip ? Number.parseInt(query.$skip, 10) : 0
  };
}

export function toSqlWhere(filter) {
  if (!filter) return { clause: '', params: [] };
  const col = sapFieldToColumn(filter.field);
  return { clause: ` AND ${col} ${filter.operator} $3`, params: [filter.value] };
}

function parseFilter(filter) {
  const match = filter.match(/^([A-Za-z0-9_]+)\s+(eq|ne|gt|ge|lt|le)\s+'?([^']+)'?$/i);
  if (!match) throw new Error(`unsupported OData $filter: ${filter}`);
  const op = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }[match[2].toLowerCase()];
  return { field: match[1], operator: op, value: match[3] };
}

function sapFieldToColumn(field) {
  const map = {
    BusinessPartner: 'external_id',
    Customer: 'external_id',
    Supplier: 'external_id',
    CompanyCode: 'company_id',
    PostingDate: 'tran_date',
    DocumentReferenceID: 'external_id'
  };
  return map[field] || field.replace(/[A-Z]/g, (m, i) => `${i ? '_' : ''}${m.toLowerCase()}`);
}
