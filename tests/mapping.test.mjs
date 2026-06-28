/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, SAP_BAPI_TO_RECORD, SAP_IDOC_TO_TRANSACTION, QUICKBOOKS_RESOURCE_TO_TABLE, SALESFORCE_OBJECT_TO_TABLE } from '../bisoft-connector/src/routes.mjs';
import { transpileQboQuery } from '../sovereign-quickbooks/src/suiteql/qbo_query.mjs';
import { parseSoql, transpileSoql } from '../sovereign-salesforce/src/soql/engine.mjs';
import { parseSosl, transpileSosl } from '../sovereign-salesforce/src/sosl/engine.mjs';
import { entityToTable, parseODataQuery } from '../sovereign-sap/src/odata/parser.mjs';
import { processIdoc } from '../sovereign-sap/src/idoc/processor.mjs';
import { routeBapi } from '../sovereign-sap/src/bapi/router.mjs';

test('required bridge mappings are present', () => {
  assert.equal(SAP_BAPI_TO_RECORD.BAPI_ACC_DOCUMENT_POST, 'journal_entry');
  assert.equal(SAP_IDOC_TO_TRANSACTION.INVOIC02, 'ap_vendor_bill');
  assert.equal(QUICKBOOKS_RESOURCE_TO_TABLE.invoice, 'invoice');
  assert.equal(QUICKBOOKS_RESOURCE_TO_TABLE.bill, 'vendor_bill');
  assert.equal(SALESFORCE_OBJECT_TO_TABLE.Account, 'customer');
  assert.equal(SALESFORCE_OBJECT_TO_TABLE.Opportunity, 'invoice');
  assert.equal(SALESFORCE_OBJECT_TO_TABLE.Contact, 'customer_contact');
});

test('resolveRoute maps target/resource to sovereign table', () => {
  assert.equal(resolveRoute('quickbooks', 'invoice').table, 'invoice');
  assert.equal(resolveRoute('salesforce', 'Account').table, 'customer');
  assert.equal(resolveRoute('sap', 'bapi', { bapi: 'BAPI_ACC_DOCUMENT_POST' }).table, 'journal_entry');
});

test('QBO SQL transpiles to PostgreSQL table and fields', () => {
  const sql = transpileQboQuery("SELECT Id, TotalAmt FROM Invoice WHERE TxnDate > '2026-01-01'", 44);
  assert.match(sql, /FROM invoice WHERE company_id = 44/);
  assert.match(sql, /tran_date > '2026-01-01'/);
  assert.match(sql, /total AS "TotalAmt"/);
});

test('SOQL transpiles JSONB fields and object scope', () => {
  const parsed = parseSoql("SELECT Id, Name, Amount FROM Opportunity WHERE StageName = 'Closed Won'");
  assert.equal(parsed.objectType, 'Opportunity');
  const { sql, params } = transpileSoql("SELECT Id, Name, Amount FROM Opportunity WHERE StageName = 'Closed Won'", 7);
  assert.deepEqual(params, ['Opportunity', 7]);
  assert.match(sql, /sf_id AS "Id"/);
  assert.match(sql, /fields->>'StageName' = 'Closed Won'/);
});

test('SOSL parses returning clauses and emits plans', () => {
  const parsed = parseSosl('FIND {Ahmad} IN ALL FIELDS RETURNING Account(Name), Contact(Name, Email)');
  assert.equal(parsed.term, 'Ahmad');
  assert.equal(parsed.returning.length, 2);
  const plans = transpileSosl('FIND {Ahmad} IN ALL FIELDS RETURNING Account(Name), Contact(Name, Email)', 9);
  assert.equal(plans[0].objectType, 'Account');
  assert.deepEqual(plans[1].params, [9, 'Contact', '%Ahmad%']);
});

test('SAP shell maps OData, IDoc, and BAPI surfaces', () => {
  assert.equal(entityToTable('A_Supplier'), 'vendor');
  assert.equal(parseODataQuery({ $select: 'BusinessPartner,Name', $top: '5' }).top, 5);
  assert.equal(processIdoc({ IDOCTYP: 'INVOIC02', segments: [{ E1EDK01: {} }] }).transaction_type, 'ap_vendor_bill');
  assert.equal(routeBapi('BAPI_PO_CREATE1').sovereign_record_type, 'purchase_order');
});
