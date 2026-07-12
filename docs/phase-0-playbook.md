# Citely Phase 0 validation playbook

Phase 0 is a falsification sprint, not a miniature SaaS build. Its goal is to prove that a buyer trusts the measurement, learns something new, acts on a recommendation, pays, and returns for another measurement.

## Initial customer hypotheses

Test two segments only:

1. Boutique SEO/content agencies managing at least ten client brands.
2. Founder-led B2B SaaS companies with active comparison demand and identifiable competitors.

Strong evidence is payment, report sharing, action implementation, a second brand, a rerun, or a referral. Compliments and wait-list intent are weak evidence.

## Offers to test

- **Free snapshot:** five prompts, up to three competitors, one important finding.
- **Paid diagnostic:** 20–30 approved prompts, two providers, evidence review, and three to five actions.
- **Monitoring pilot:** baseline plus a future rerun and change report.

## Prompt taxonomy

| Stage | Purpose |
|---|---|
| Category discovery | Initial consideration |
| Comparison | Alternative evaluation |
| Use case | Fit for a specific job |
| Trust and risk | Reputation and objections |
| Purchase decision | Near-term selection |
| Brand understanding | Factual representation |

Every prompt needs an ID, stage, importance from 1–5, persona, text, geography, and locale. The customer must approve the panel before a paid full audit.

## Evidence method

1. Define brand aliases, domains, competitors, geography, locale, providers, and repetitions.
2. Run the exact approved prompts and retain the full raw response, provider, model, timestamp, citations, usage, and failures.
3. Keep provider results separate. A one-off appearance is unstable visibility, not a stable ranking.
4. Use automatic entity and citation classification as an operator aid only.
5. Manually verify context, recommendation strength, source support, factual accuracy, and ambiguity.
6. Deliver no more than three to five evidence-backed actions.
7. Record whether the customer pays, shares, acts, and requests a rerun.

## Scoring rubric

The prototype avoids a magical universal score.

| Value | Directional meaning |
|---:|---|
| 0 | Brand absent |
| 1 | Passing mention, reserved for later human annotation |
| 2 | Relevant option |
| 3 | Appears before tracked competitors or is strongly recommended |
| 4 | Appears very early and is treated as a primary recommendation |

Aggregate metrics are mention rate, first-mention rate, importance-weighted visibility, and stage-level visibility. Every metric must link back to raw evidence.

## Human review checklist

- [ ] Alias matching did not create false positives.
- [ ] Negative or irrelevant mentions were not treated as recommendations.
- [ ] Citation pages were opened and support the relevant claims.
- [ ] Materially incorrect brand claims were recorded.
- [ ] Provider, model, geography, prompt text, and repetitions are visible.
- [ ] Recommendations reference the affected prompts and evidence.
- [ ] Unsupported causality was removed.

## Sales experiment

Target 100 carefully selected prospects, 20 serious conversations, eight completed audits, three paid diagnostics, and two monitoring pilots. After every audit, record the surprising finding, disputed evidence, chosen action, decision-maker, price, provider cost, human minutes, report sharing, rerun decision, and referral.

## Phase 0 exit gate

Proceed to Phase 1 only after at least five completed audits, three paid engagements, two rerun requests, two implemented recommendations, predictable provider cost, and less than two hours of human review per complete audit.

Narrow or pivot when results are interesting but do not trigger payment, action, or repeat measurement.
