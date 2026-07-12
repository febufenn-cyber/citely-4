# Citely Phase 1 — reliable measurement engine

Phase 1 converts the Phase 0 concierge audit into a durable, reviewable measurement system. It does not claim deterministic LLM answers. It guarantees a reproducible methodology, immutable evidence, explicit variability, safe retries, and versioned human-reviewed scoring.

## Implemented boundary

This branch includes:

- a dependency-free measurement-engine core with deterministic observation identities;
- explicit audit-run and observation-item state machines;
- leases and duplicate-safe accepted observations;
- provider failure classification and bounded retries;
- three-scope budget enforcement using integer micro-USD units;
- immutable raw observations separated from review corrections;
- reviewed `visibility-v1` scoring with completeness and stability metrics;
- a Supabase/Postgres schema with RLS, append-only evidence triggers, and atomic item claiming;
- a Cloudflare Workflow and operator API skeleton using the current Workflows entrypoint model;
- OpenAI Responses web-search and Perplexity Sonar provider adapters;
- a deterministic failure-injection demo and Phase 1 test suite.

## Core invariant

An intended observation is uniquely identified by:

```text
audit run
+ prompt version
+ provider profile version
+ repetition number
```

The provider may be called more than once after a transport interruption, but Citely accepts at most one immutable observation for that intended observation. Attempts and provider request IDs are retained separately.

## Data flow

```text
Approved prompt panel version
        ↓
Frozen audit configuration
        ↓
Prompt × provider profile × repetition items
        ↓
Lease and cost reservation
        ↓
Provider attempt(s)
        ↓
Immutable accepted observation
        ↓
Deterministic candidate extraction
        ↓
Human accept / correct / exclude
        ↓
Versioned score calculation
        ↓
Ready-for-delivery run
```

## State machines

### Audit run

```text
draft → configured → approved → queued/running
running → awaiting_review | partially_failed | budget_stopped | failed
awaiting_review/partially_failed → review_in_progress → ready → delivered
```

### Intended observation

```text
planned → attempting → retry_scheduled → attempting
attempting → review_required | terminal_failure
review_required → accepted | corrected | excluded
```

Provider failures never become brand absences. Scoring denominators contain only reviewed, eligible observations.

## Evidence layers

1. **Attempt** — transport-level execution, including failures, latency, requested model and cost estimate.
2. **Observation** — the single accepted raw response for an intended observation.
3. **Automated classification** — deterministic alias and citation interpretation.
4. **Review decision** — append-only human acceptance, correction or exclusion.
5. **Score calculation** — derived, versioned metrics referencing reviewed observations.

The `observations`, completed attempts, review decisions, score calculations and audit events are append-only in Postgres.

## Cost model

Costs use integer micro-USD values to avoid floating-point accounting errors. The engine supports:

- audit budget;
- workspace budget;
- global budget;
- pre-call reservation;
- actual-cost reconciliation;
- released reservations after failures;
- budget-stop events.

Provider rates remain configuration data because pricing changes independently of code.

## Scoring model `visibility-v1`

The model produces separate metrics rather than one magical score:

- intended observations;
- successful observations;
- terminal failures;
- excluded observations;
- data completeness;
- review completion;
- mention rate;
- first-mention rate;
- importance-weighted visibility;
- provider and prompt-stage breakdowns;
- repeated-sample stability.

Changing the scoring formula creates a new scoring-model version; it does not rewrite evidence.

## Cloudflare execution

`workers/src/workflow.ts` implements one Workflow instance per audit run. Each intended observation is a durable step with bounded retries. An exhausted step is terminalized and the remaining panel continues. A deterministic Workflow instance ID prevents accidental duplicate starts for the same audit run.

The Workflow API is deliberately small:

```text
GET  /health
POST /v1/audit-runs/:auditRunId/start
GET  /v1/workflows/:workflowInstanceId
```

All non-health endpoints require `Authorization: Bearer $OPERATOR_API_KEY`.

## Supabase security

- Workspace tables carry `workspace_id`.
- RLS policies restrict browser access to workspace members.
- Roles are `owner`, `operator`, `reviewer`, and `viewer`.
- Provider keys and the service-role key remain Worker-only.
- The atomic `claim_audit_run_item` RPC is executable only by `service_role`.
- Browser code must never receive `SUPABASE_SERVICE_ROLE_KEY`.

## Known boundaries

- The in-memory store is a deterministic test/reference implementation, not production persistence.
- The Worker stores provider evidence and candidate alias extraction but does not yet expose the operator review UI.
- Cost commits are sequential within one Workflow instance. The database uniqueness constraints prevent duplicate accepted observations, while provider billing can still reflect a call completed immediately before a network interruption.
- Recommendation generation remains outside Phase 1. This phase establishes trustworthy measurement first.
