# Citely

> Evidence-backed AI answer visibility measurement, controlled customer reporting, and guarded action experiments.

Citely now contains four connected product layers:

1. **Phase 0 — audit operator:** configurable prompt panels, provider adapters, raw evidence, directional analysis, Markdown and HTML output.
2. **Phase 1 — reliable measurement engine:** immutable observations, retries, budgets, review decisions, versioned scoring, Supabase and Cloudflare Workflows.
3. **Phase 2 — evidence delivery:** review APIs, immutable report versions, publication, expiring share links, evidence-first HTML reports, and guarded baseline comparisons.
4. **Phase 3 — action and experiment engine:** prioritized findings, assigned interventions, frozen hypotheses and success criteria, implementation evidence, comparable reruns, and observational outcome evaluation.

## Phase 3 principle

Citely does not jump from a visibility gap to an unsupported recommendation. The action loop is:

```text
published finding
→ prioritized action
→ assigned intervention
→ frozen experiment plan
→ implementation evidence
→ comparable rerun
→ guarded evaluation
```

Every experiment freezes its baseline report, target prompts, provider scope, primary metric, minimum effect, completeness threshold, sample requirement, and guardrails before implementation. Results are capped at `moderate` causal confidence and explicitly described as observational rather than proof.

## Local validation

```bash
npm run check
npm run check:worker
npm run demo:phase3
```

The Phase 3 demo writes:

```text
output/phase3-demo/action-experiment.json
```

## Phase 3 API

Operator-authenticated:

```text
GET  /v1/brands/:brandId/action-board
POST /v1/report-versions/:reportVersionId/findings
POST /v1/findings/:findingId/interventions
POST /v1/interventions/:interventionId/transition
POST /v1/interventions/:interventionId/evidence
POST /v1/interventions/:interventionId/evaluate
```

Existing Phase 2 public report and operator endpoints remain available. Mutations require `x-actor-id` with the UUID of the acting Supabase user.

## Database migrations

Apply all ordered migrations through the normal Supabase workflow:

```bash
supabase db push
```

Phase 3 adds findings, interventions, append-only state events, implementation evidence, frozen experiment plans, immutable evaluations, RLS, and experiment-configuration freeze controls.

## Important boundaries

- A success result means the frozen target metric improved under a comparable rerun; it does not prove causation.
- Material methodology changes make an experiment invalid.
- Low completeness, volatile samples, provider-wide anomalies, missing implementation evidence, and uncontrolled changes produce an inconclusive result.
- Autonomous publishing, direct CMS changes, revenue attribution, and predictive lift promises remain unsupported.
- All new migrations and routes require a supervised staging deployment before production use.

See `docs/phase-3-action-experiments.md` for the model, invariants, API, blind spots, and exit criteria.
