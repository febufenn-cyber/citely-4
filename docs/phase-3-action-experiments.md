# Citely Phase 3 — action and experiment engine

Phase 3 converts reviewed visibility findings into accountable work and guarded measurement. It does not claim that a content change caused an LLM outcome. It freezes a hypothesis, target prompts, provider scope, baseline methodology, success threshold, and guardrails before implementation, then evaluates a later published report.

## Product loop

```text
published finding
→ prioritized action
→ assigned intervention
→ frozen experiment plan
→ implementation evidence
→ comparable rerun
→ guarded evaluation
→ retain, revise, or stop
```

## Core invariants

1. Every finding points to a published report version and exact evidence observation IDs.
2. Every intervention has an owner, explicit hypothesis, mechanism, and state history.
3. Every experiment freezes a baseline report version and methodology fingerprint before work starts.
4. Success is measured only on declared target prompts and providers.
5. A material methodology change makes the experiment invalid rather than “down” or “up.”
6. Low completeness, volatile samples, provider-wide anomalies, missing implementation evidence, or uncontrolled changes produce an inconclusive result.
7. Causal confidence is capped at `moderate`; Citely reports observational evidence, never proof of causation.
8. Implementation evidence, state events, and evaluations are append-only.

## State machines

### Intervention

```text
draft → approved → in_progress → implemented
draft/approved/in_progress → cancelled
```

### Experiment

```text
draft → approved → running → awaiting_measurement → evaluated
any active state → invalidated
```

Approved experiment plans are frozen. Changing the hypothesis, target prompts, metric, or threshold requires a new plan.

## Supported primary metrics

- `mention_rate`
- `average_mention_status`
- `weighted_visibility`

The engine evaluates only the frozen target prompt keys and optional provider list, not the entire brand dashboard.

## Outcome classes

- `success` — the signed delta meets the frozen minimum.
- `partial_success` — movement is favourable but below the minimum.
- `no_change` — no measured movement.
- `regression` — movement is opposite the expected direction.
- `inconclusive` — evidence quality or experiment controls are insufficient.
- `invalid` — the baseline or critical methodology changed.

## API surface

```text
GET  /v1/brands/:brandId/action-board
POST /v1/report-versions/:reportVersionId/findings
POST /v1/findings/:findingId/interventions
POST /v1/interventions/:interventionId/transition
POST /v1/interventions/:interventionId/evidence
POST /v1/interventions/:interventionId/evaluate
```

All endpoints are operator-authenticated. Mutations require `x-actor-id`.

## Deliberate exclusions

Phase 3 does not autonomously publish content, edit customer sites, promise visibility lift, infer revenue attribution, or run multivariate causal experiments. It establishes disciplined action tracking and observational before/after evaluation first.

## Exit criteria

- Five real interventions reach implemented state with verifiable evidence.
- At least three receive comparable reruns.
- No invalid comparison is presented as success or regression.
- Operators can explain every outcome from frozen targets and evidence.
- Customers use the action board to decide what to retain, revise, or stop.
- Review and measurement cost remain economically viable.
