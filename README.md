# Citely

> Evidence-backed AI answer visibility measurement and controlled customer reporting.

Citely now contains three connected product layers:

1. **Phase 0 — audit operator:** configurable prompt panels, provider adapters, raw evidence, directional analysis, Markdown and HTML output.
2. **Phase 1 — reliable measurement engine:** immutable observations, retries, budgets, review decisions, versioned scoring, Supabase and Cloudflare Workflows.
3. **Phase 2 — evidence delivery:** review APIs, immutable report versions, publication, expiring share links, evidence-first HTML reports, and guarded baseline comparisons.

## Phase 2 principle

A customer never sees a machine-only conclusion. The publication path is:

```text
provider evidence
→ automated candidate
→ human accept/correct/exclude
→ versioned score
→ immutable report snapshot
→ published customer report
```

## Local validation

```bash
npm run check
npm run check:worker
npm run demo:phase2
```

The Phase 2 demo writes:

```text
output/phase2-demo/report.json
output/phase2-demo/comparison.json
output/phase2-demo/report.html
```

## Phase 2 API

Public:

```text
GET /health
GET /portal
GET /share/:token
```

Operator-authenticated:

```text
GET  /v1/review-queue?workspace_id=...
POST /v1/audit-run-items/:id/review
POST /v1/audit-runs/:id/report-draft
POST /v1/reports/:id/publish
POST /v1/reports/:id/share
POST /v1/reports/:id/compare/:baselineId
GET  /v1/reports/:id
```

Mutations also require `x-actor-id` with the UUID of the acting Supabase user.

## Database migrations

Apply all ordered migrations through the normal Supabase workflow:

```bash
supabase db push
```

Phase 2 adds report drafts and immutable versions, publications, hashed share links, prompt approvals, comments, disputes, comparisons, methodology events, RLS, and publication immutability controls.

## Cloudflare configuration

Existing secrets remain required:

```bash
npx wrangler@latest secret put SUPABASE_URL
npx wrangler@latest secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler@latest secret put OPERATOR_API_KEY
npx wrangler@latest secret put OPENAI_API_KEY
npx wrangler@latest secret put PERPLEXITY_API_KEY
```

`PUBLIC_BASE_URL` is optional. When omitted, share links use the request origin.

## Important boundaries

- Migrations and public-report routes require a supervised staging deployment before production use.
- Public links are expiring and revocable; permanent anonymous reports are intentionally unsupported.
- Published reports disclose observed AI-answer visibility, not guaranteed traffic, leads, or revenue.
- Recommendation execution and autonomous publishing remain outside Phase 2.

See `docs/phase-2-product.md` for the product reasoning, invariants, blind spots, and exit criteria.
