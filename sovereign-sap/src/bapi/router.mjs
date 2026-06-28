/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import { SAP_BAPI_TO_RECORD } from '../../../bisoft-connector/src/routes.mjs';

export function routeBapi(name, payload = {}) {
  const recordType = SAP_BAPI_TO_RECORD[name];
  if (!recordType) throw new Error(`unsupported BAPI: ${name}`);
  return {
    bapi: name,
    sovereign_record_type: recordType,
    payload,
    return: [{ TYPE: 'S', ID: 'SOVEREIGNBRIDGE', NUMBER: '000', MESSAGE: 'BAPI routed to sovereign implementation' }]
  };
}
