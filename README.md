# Citely

> Evidence-backed AI visibility measurement, controlled reporting, guarded experiments, authenticated operations, and multi-client commercial workflows.

Citely now contains six connected layers:

1. **Phase 0 — audit operator**
2. **Phase 1 — reliable measurement engine**
3. **Phase 2 — evidence delivery portal**
4. **Phase 3 — action and experiment engine**
5. **Phase 4 — production pilot operations**
6. **Phase 5 — agency and commercial OS:** isolated client portfolios, server-side entitlements, controlled scheduling, usage and billing event ledgers, agency-safe exports, and margin analytics.

## Phase 5 principle

Agency access never flattens tenants into one shared dataset. Every agency-to-client relationship is an explicit workspace link, every client remains isolated, and every provider-spend action is checked against server-side entitlements before work begins.

```text
agency or client identity
→ linked workspace authorization
→ entitlement and budget check
→ idempotent schedule or manual run
→ reviewed report and export
→ immutable usage/commercial events
```

## Validation

```bash
npm run check
npm run check:worker
npm run demo:phase5
```

The Phase 5 demo writes `output/phase5-demo/agency-commercial.json` and exercises two isolated clients, three brands, an active manual/provider-neutral subscription projection, entitlement checks, deterministic scheduling, and margin analytics.

## Phase 5 routes

```text
GET  /v1/agencies/:agencyId/portfolio
POST /v1/agencies/:agencyId/clients
GET  /v1/agencies/:agencyId/workspaces/:workspaceId/entitlements
POST /v1/agencies/:agencyId/workspaces/:workspaceId/schedules
POST /v1/schedules/:scheduleId/dispatch
POST /v1/workspaces/:workspaceId/reports/:reportVersionId/rerun-approval
GET  /v1/reports/:reportId/export.csv
POST /v1/billing/webhooks/:provider
```

The billing webhook is service-principal only. Billing may remain in manual mode until a provider is configured. Duplicate and out-of-order events cannot regress the current subscription projection.

## Commercial safety

- Brand, observation, run and feature entitlements are enforced server-side.
- Scheduled executions use deterministic keys and are duplicate-safe.
- Agency-branded reports retain Citely attribution, methodology, completeness and limitations.
- CSV exports use approved report snapshots and exclude raw provider payloads and internal review notes.
- Analytics report operating cost and gross margin; they do not attribute customer revenue to AI visibility.

## Important boundaries

Cross-customer benchmarks, autonomous publishing, unrestricted reruns and predictive lift promises remain disabled. Live billing, email delivery and scheduler deployment require provider credentials and staging verification.

See `docs/phase-5-agency-commercial.md`.
