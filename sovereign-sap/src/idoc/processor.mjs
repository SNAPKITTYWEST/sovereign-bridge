/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

import { SAP_IDOC_TO_TRANSACTION } from '../../../bisoft-connector/src/routes.mjs';

export function processIdoc(idoc = {}) {
  const type = idoc.IDOCTYP || idoc.messageType || idoc.type;
  const transactionType = SAP_IDOC_TO_TRANSACTION[type] || 'unknown_idoc';
  return {
    idoc_type: type,
    transaction_type: transactionType,
    control: idoc.EDI_DC40 || idoc.control || {},
    segments: idoc.segments || idoc.SEGMENTS || [],
    sovereign_payload: {
      external_id: idoc.DOCNUM || idoc.id,
      transaction_type: transactionType,
      raw_segment_count: (idoc.segments || idoc.SEGMENTS || []).length
    }
  };
}
