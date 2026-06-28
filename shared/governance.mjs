/*
 * Copyright 2026 SnapKitty Collective
 * SPDX-License-Identifier: Apache-2.0
 */

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function governance_check({ actor = 'anonymous', action, resource, payload = {}, method = 'GET' }) {
  const issues = [];
  if (MUTATION_METHODS.has(method.toUpperCase()) && payload?.verdict === 'SILENCE') {
    issues.push('SILENCE blocks mutation');
  }
  if (payload?.TrustDeed === false || payload?.trust_deed === false) {
    issues.push('Trust Deed gate failed');
  }
  if (payload?.pii_mode === 'raw' && !payload?.consent_ref) {
    issues.push('raw PII requires consent_ref');
  }

  return {
    ok: issues.length === 0,
    actor,
    action,
    resource,
    issues,
    mode: 'EVIDENCE_OR_SILENCE'
  };
}

export async function requireGovernance(input) {
  const result = await governance_check(input);
  if (!result.ok) {
    const err = new Error(`governance_check failed: ${result.issues.join('; ')}`);
    err.statusCode = 403;
    err.governance = result;
    throw err;
  }
  return result;
}
