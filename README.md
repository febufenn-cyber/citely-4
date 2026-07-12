# Citely

> Evidence-backed AI answer visibility audits for brands and agencies.

Citely Phase 0 is an internal operator prototype. It runs a customer-approved panel of commercial prompts through one or more answer providers, stores raw evidence, detects brand and competitor mentions, produces directional metrics, and generates reviewable Markdown and HTML reports.

The goal is to validate a paid recurring decision loop before building the full Workers + Supabase SaaS.

## What is implemented

- JSON audit configuration with brand aliases, competitors, prompt stages, importance, geography, and repetitions
- Replaceable provider adapters for OpenAI, Perplexity, and deterministic mock data
- Immutable run output containing raw provider responses and failures
- Brand/competitor entity matching
- Citation ownership classification
- Directional mention and weighted-visibility scoring
- Prompt-level Markdown and HTML evidence reports
- Node test suite
- Phase 0 methodology, sales experiment, and validation gates

## Requirements

- Node.js 20 or newer
- Provider API keys only when using live providers

No third-party npm dependencies are required.

## Run the deterministic demo

```bash
npm run demo
```

Generated files:

```text
output/demo/run.json
output/demo/report.md
output/demo/report.html
```

## Run a live audit

Copy the example and replace the fictional entities and prompts:

```bash
cp examples/demo-audit.json examples/my-client.audit.json
cp .env.example .env
```

Export the required key in your shell, then run one or both providers:

```bash
OPENAI_API_KEY=... node src/citely.mjs audit \
  --config examples/my-client.audit.json \
  --provider openai \
  --out output/my-client

OPENAI_API_KEY=... PERPLEXITY_API_KEY=... node src/citely.mjs audit \
  --config examples/my-client.audit.json \
  --provider openai,perplexity \
  --out output/my-client
```

The CLI intentionally does not auto-load `.env`; use your shell, secret manager, or deployment environment so secrets never enter run artifacts.

## Validate

```bash
npm test
npm run check
```

## Operator workflow

1. Interview and qualify the buyer.
2. Create a commercially relevant prompt panel using `docs/phase-0-playbook.md`.
3. Obtain customer approval for the panel.
4. Run the audit and inspect `run.json`.
5. Complete the checklist in `docs/phase-0-playbook.md`.
6. Replace automatic interpretation with human-reviewed findings and three evidence-backed actions.
7. Ask for payment and a future rerun.
8. Record the outcome in `docs/phase-0-playbook.md`.

## Important limitations

- Entity matching is deterministic and can still misread ambiguous brand names.
- Automatic mention status uses presence and order; it does not yet infer sentiment or nuanced recommendation strength.
- OpenAI audits use the Responses API web-search tool; citation annotations still require operator verification.
- Provider outputs fluctuate. Increase repetitions for important prompts and report instability honestly.
- The generated report is an operator draft, not an automatically publishable customer verdict.

## Phase progression

Phase 1 should only begin after Phase 0 proves that buyers pay, act on findings, and request repeat measurement. The next engineering phase would add durable queues, database persistence, user workspaces, reviewed recommendation records, cost controls, and scheduled reruns.
