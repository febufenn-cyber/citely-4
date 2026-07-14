# Citely

> Evidence-backed AI visibility measurement, controlled reporting, guarded experiments, and authenticated pilot operations.

Citely now contains five connected layers:

1. **Phase 0 — audit operator**
2. **Phase 1 — reliable measurement engine**
3. **Phase 2 — evidence delivery portal**
4. **Phase 3 — action and experiment engine**
5. **Phase 4 — production pilot operations:** verified sessions, platform/workspace authorization, deployment manifests, operational audit events, provider health and a pilot console.

## Phase 4 principle

Human operators use verified Supabase sessions. A service bearer key remains only for narrowly scoped machine operations. Platform roles and workspace roles are evaluated separately, and every denied or allowed sensitive operation can be correlated without logging secrets.

```text
verified session
→ platform/workspace authorization
→ audited operation
→ immutable evidence workflow
→ pilot verification record
```

## Validation

```bash
npm run check
npm run check:worker
npm run demo:phase4
```

The demo writes `output/phase4-demo/pilot-verification.json` and proves the complete audit-to-evaluation stage contract with security checks. It does not claim a live Cloudflare or Supabase deployment.

## Phase 4 routes

Public:

```text
GET /health
GET /portal
GET /share/:token
```

Authenticated pilot operations:

```text
GET /ops?workspace_id=<uuid>
GET /v1/workspaces/:workspaceId/pilot-console
```

Existing Phase 1–3 APIs remain available to service principals and authorized platform staff. Human tokens are verified through Supabase Auth; the Worker never trusts an unsigned user identifier header as authentication.

## Deployment identity

Set `ENVIRONMENT`, `BUILD_COMMIT` and `SCHEMA_VERSION` on each deployment. `/health` exposes those non-secret values so a staging smoke test can prove which code and schema are running.

## Important boundaries

- The Phase 4 migration and Worker still require a real staging deployment.
- The operator service key must be rotated, restricted and excluded from browser clients.
- Billing, agency portfolios and cross-customer benchmarks remain outside Phase 4.
- Provider evidence, report versions, implementation evidence and evaluations remain immutable.

See `docs/phase-4-production-pilots.md` and `docs/phase-4-runbook.md`.
