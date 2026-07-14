# Phase 4 operator and deployment runbook

## Deploy the same commit and schema

1. Export `ENVIRONMENT`, `BUILD_COMMIT`, `SCHEMA_VERSION`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and Worker secrets.
2. Run `supabase db push` against staging.
3. Run `npm run check` and `npm run check:worker`.
4. Deploy with Wrangler using the staging environment.
5. Call `/health` and confirm commit and schema values.
6. Execute the staging smoke checks with a short-lived user token.
7. Insert a `deployment_records` row only after successful health and authorization checks.

## Rollback-safe practice

Migrations are additive. Roll back application code to the prior commit without deleting new tables. Do not run destructive down migrations on customer evidence. A schema cleanup requires a separately reviewed migration after retention and backup checks.

## Backup and restore

Before a production migration, create a provider-native Postgres backup and record its identifier in the deployment ticket. Test restoration in a non-production project quarterly. Raw observations, report versions, review decisions, implementation evidence and experiment evaluations are immutable records.

## Incident response

Use the correlation ID to trace authorization, workflow, provider, budget, publication and experiment events. Rotate affected credentials, revoke sessions, pause schedules and provider calls, preserve evidence, then publish a post-incident record. Never copy raw provider payloads or bearer tokens into tickets or logs.

## Data deletion

Delete tenant data only through an approved workspace deletion workflow that first disables runs and share links, exports required audit records, records the request, and applies retention obligations. Cross-customer benchmarks are not implemented in Phase 4.
