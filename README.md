# Citely

> Evidence-backed AI answer visibility audits for brands and agencies.

Citely measures how AI answer systems represent and recommend a brand across customer-approved commercial prompts. It preserves raw evidence, separates provider failures from brand absence, compares competitors, and produces human-reviewed, versioned visibility metrics.

## Current implementation

### Phase 0 — concierge audit operator

- JSON audit configuration
- OpenAI, Perplexity and deterministic mock providers
- Raw evidence and citation capture
- Brand and competitor alias matching
- Directional Markdown and HTML reports
- Validation and sales playbook

### Phase 1 — reliable measurement engine

- Frozen prompt and provider-profile versions
- Deterministic observation idempotency keys
- Audit-run and item state machines
- Leases, attempts and bounded retries
- Immutable accepted observations
- Failure taxonomy that never treats provider failure as brand absence
- Per-audit, workspace and global cost guards
- Human accept/correct/exclude review records
- Versioned `visibility-v1` scoring
- Supabase schema, RLS and append-only evidence controls
- Cloudflare Workflow and authenticated operator API
- Failure-injection demo and 13 dedicated Phase 1 tests

## Requirements

- Node.js 20 or newer
- Provider API keys only for live audits
- Supabase and Cloudflare accounts for the deployed Phase 1 path

The measurement-engine core has no third-party runtime dependencies.

## Run Phase 0 demo

```bash
npm run demo
```

## Run Phase 1 durable-engine demo

```bash
npm run demo:phase1
```

Generated artifact:

```text
output/phase1-demo/measurement-engine.json
```

## Validate

```bash
npm run check:phase1
npm run check
```

## Deploy Phase 1

1. Review `docs/phase-1-architecture.md`.
2. Apply the ordered migrations in `supabase/migrations/`.
3. Configure Cloudflare secrets described in `docs/phase-1-runbook.md`.
4. Deploy with `npx wrangler@latest deploy`.
5. Create a frozen audit run and start its deterministic Workflow instance.
6. Human-review every successful observation before customer delivery.

## Repository map

```text
src/citely.mjs                         Phase 0 CLI
src/engine/                            Phase 1 tested domain engine
src/phase1-demo.mjs                    Failure-injection vertical slice
workers/src/                           Cloudflare API and Workflow
supabase/migrations/                   Durable schema and RLS
examples/                              Phase 0 audit configuration
docs/phase-0-playbook.md               Validation methodology
docs/phase-1-architecture.md           Measurement-engine design
docs/phase-1-runbook.md                Operations and deployment
tests/                                 Phase 0 and Phase 1 tests
```

## Trust boundary

LLM answers are variable. Citely promises reproducible methodology and preserved evidence, not identical responses. Raw provider output is immutable; automated interpretation is provisional; human review is append-only; scores identify their scoring-model version.

Provider retries can consume more than one billable call after a network interruption, but database constraints allow only one accepted observation per intended prompt/provider/repetition item.
