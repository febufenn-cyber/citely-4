# Citely Phase 1 operator and deployment runbook

## Local validation

```bash
npm run check:phase1
npm run demo:phase1
```

The deterministic demo writes:

```text
output/phase1-demo/measurement-engine.json
```

It intentionally injects one provider rate limit, retries it, preserves both attempts, accepts one observation, completes human-review fixtures, and generates a `visibility-v1` score calculation.

## Provision Supabase

Apply migrations through your normal Supabase workflow:

```bash
supabase db push
```

The ordered migrations create tenant, prompt-version, provider-profile, execution, evidence, review, scoring, budget and event tables. Review the RLS policies before connecting any browser client.

Create an approved prompt panel and a frozen `audit_runs` record before starting the Workflow. Generate `audit_run_items` from the exact prompt-version × provider-profile × repetition product. The `idempotency_key` must be stable and unique.

## Configure Cloudflare secrets

```bash
npx wrangler@latest secret put SUPABASE_URL
npx wrangler@latest secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler@latest secret put OPERATOR_API_KEY
npx wrangler@latest secret put OPENAI_API_KEY
npx wrangler@latest secret put PERPLEXITY_API_KEY
```

Only configure provider keys that the selected provider profiles require.

## Develop and deploy

```bash
npx wrangler@latest dev
npx wrangler@latest deploy
```

Start an audit:

```bash
curl -X POST \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  "https://YOUR_WORKER/v1/audit-runs/AUDIT_RUN_UUID/start"
```

Check Workflow status:

```bash
curl \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  "https://YOUR_WORKER/v1/workflows/audit-AUDIT_RUN_UUID"
```

## Before every live audit

- Confirm the prompt-panel version is approved and frozen.
- Confirm brand and competitor aliases are reviewed.
- Confirm provider model, search mode, geography and locale are explicit.
- Confirm configured provider rates and audit budget.
- Confirm the customer agreed to the prompts.
- Run a one-prompt provider canary after rotating credentials or models.

## Failure response

### `rate_limited` or `provider_server_error`

The Workflow retries. Inspect `observation_attempts` if retries exhaust. Do not count the failed item as brand absence.

### `authentication_error`

Rotate or correct the Worker secret. Resume the audit after fixing credentials. Do not blindly rerun successful items.

### `budget_stopped`

Review estimate configuration and current spend. Increase the budget only through an explicit operator decision recorded as a `budget_events.override` entry.

### `partially_failed`

Review valid observations, acknowledge terminal failures, and decide whether completeness is sufficient. Customer-facing reports must disclose intended, successful, excluded and failed counts.

### Provider-wide score movement

Run the canary panel before attributing movement to a customer. A provider model or search change can affect many brands simultaneously.

## Review procedure

For every `review_required` item:

1. Read the full answer, not only the extracted snippet.
2. Verify entity context and ambiguity.
3. Open inline citations and confirm they support the claim.
4. Compare retrieved sources with displayed citations.
5. Accept, correct or exclude the automated classification.
6. Record a structured reason code for corrections.

A run can become `ready` only after all successful observations are reviewed and the chosen completeness threshold is met.

## Phase 1 exit criteria

- At least 95% of eligible observations complete without engineering intervention.
- Duplicate successful observations remain zero under retry and duplicate-start tests.
- Partial runs resume without repeating successful observations.
- Reviewer correction rate is measured and acceptable for high-confidence matches.
- Cost estimates are close enough to enforce useful budgets.
- Three real audits complete with predictable cost and no database editing by hand.
