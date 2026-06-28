# SOVEREIGNBRIDGE

Clean-room connector shells for public enterprise API surfaces on top of the SovereignSuite PostgreSQL ledger.

Pattern:

```text
public API surface -> sovereign implementation -> WORM audit -> Trust Deed -> Bisoft layer
```

This repo intentionally contains original implementation code only. It does not copy proprietary vendor source code.

## Components

- `bisoft-connector`: Fastify proxy for `sap`, `netsuite`, `quickbooks`, and `salesforce` targets.
- `sovereign-quickbooks`: QuickBooks Online REST v3-shaped shell backed by SovereignSuite GL/AP/AR tables.
- `sovereign-salesforce`: Salesforce REST, SOQL, SOSL, composite, and trigger shell.
- `sovereign-sap`: SAP-style OData, BAPI, and IDoc shell.
- `shared`: PostgreSQL pool, WORM sealing, and Trust Deed governance gate.

## Run

```bash
npm install
npm test
npm run bridge
npm run quickbooks
npm run salesforce
npm run sap
```

Configure database with either `DATABASE_URL` or `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, `PG_PASS`.
