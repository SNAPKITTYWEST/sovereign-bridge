/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

export const SAP_BAPI_TO_RECORD = Object.freeze({
  BAPI_ACC_DOCUMENT_POST: 'journal_entry',
  BAPI_AP_ACC_GETOPENITEMS: 'vendor_bill',
  BAPI_AR_ACC_GETOPENITEMS: 'invoice',
  BAPI_CUSTOMER_GETDETAIL2: 'customer',
  BAPI_VENDOR_GETDETAIL: 'vendor',
  BAPI_MATERIAL_GET_DETAIL: 'item',
  BAPI_SALESORDER_CREATEFROMDAT2: 'invoice',
  BAPI_PO_CREATE1: 'purchase_order'
});

export const SAP_IDOC_TO_TRANSACTION = Object.freeze({
  INVOIC02: 'ap_vendor_bill',
  ORDERS05: 'purchase_order',
  DEBMAS06: 'customer_master',
  CREMAS05: 'vendor_master',
  MATMAS05: 'item_master',
  ACC_DOCUMENT03: 'gl_journal_entry',
  DELVRY07: 'fulfillment'
});

export const NETSUITE_RECORD_TO_TABLE = Object.freeze({
  account: 'account',
  vendor: 'vendor',
  vendorBill: 'vendor_bill',
  customer: 'customer',
  invoice: 'invoice',
  purchaseOrder: 'purchase_order',
  journalEntry: 'journal_entry',
  inventoryItem: 'item'
});

export const QUICKBOOKS_RESOURCE_TO_TABLE = Object.freeze({
  account: 'account',
  invoice: 'invoice',
  bill: 'vendor_bill',
  vendor: 'vendor',
  customer: 'customer',
  chartofaccounts: 'account',
  chart_of_accounts: 'account'
});

export const QUICKBOOKS_RESOURCE_TO_RECORD = Object.freeze({
  Account: 'GL account',
  Invoice: 'AR invoice',
  Bill: 'AP vendor_bill'
});

export const SALESFORCE_OBJECT_TO_TABLE = Object.freeze({
  Account: 'customer',
  Opportunity: 'invoice',
  Contact: 'customer_contact',
  Lead: 'customer',
  Case: 'sf_record',
  Task: 'sf_record',
  Event: 'sf_record'
});

export const TARGETS = Object.freeze({
  sap: {
    resources: {
      bapi: SAP_BAPI_TO_RECORD,
      idoc: SAP_IDOC_TO_TRANSACTION,
      businesspartner: { table: 'customer' },
      journalentry: { table: 'journal_entry' },
      purchaseorder: { table: 'purchase_order' },
      supplier: { table: 'vendor' },
      customer: { table: 'customer' }
    }
  },
  netsuite: {
    resources: NETSUITE_RECORD_TO_TABLE
  },
  quickbooks: {
    resources: QUICKBOOKS_RESOURCE_TO_TABLE
  },
  salesforce: {
    resources: SALESFORCE_OBJECT_TO_TABLE
  }
});

export function normalizeResource(resource) {
  return String(resource || '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

export function resolveRoute(target, resource, payload = {}) {
  const cleanTarget = String(target || '').toLowerCase();
  const targetSpec = TARGETS[cleanTarget];
  if (!targetSpec) {
    throw Object.assign(new Error(`unsupported bridge target: ${target}`), { statusCode: 404 });
  }

  if (cleanTarget === 'sap' && normalizeResource(resource) === 'bapi') {
    const bapiName = payload.bapi || payload.BAPI || payload.name;
    return { target: cleanTarget, sourceResource: 'bapi', table: SAP_BAPI_TO_RECORD[bapiName] || 'bridge_external_ref', mapping: bapiName };
  }
  if (cleanTarget === 'sap' && normalizeResource(resource) === 'idoc') {
    const messageType = payload.messageType || payload.IDOCTYP || payload.idoc_type;
    return { target: cleanTarget, sourceResource: 'idoc', table: 'bridge_external_ref', transactionType: SAP_IDOC_TO_TRANSACTION[messageType] || 'unknown_idoc' };
  }

  const direct = targetSpec.resources[resource] || targetSpec.resources[normalizeResource(resource)] || targetSpec.resources[capitalize(resource)];
  const table = typeof direct === 'string' ? direct : direct?.table;
  if (!table) {
    throw Object.assign(new Error(`unsupported resource for ${target}: ${resource}`), { statusCode: 404 });
  }
  return { target: cleanTarget, sourceResource: resource, table, mapping: direct };
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
