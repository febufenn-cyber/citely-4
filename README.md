# Citely

> Consent-gated, evidence-backed AI visibility measurement from raw observation to benchmark intelligence.

Citely 1.0 contains seven connected layers:

1. **Phase 0 — audit operator**
2. **Phase 1 — reliable measurement engine**
3. **Phase 2 — evidence delivery portal**
4. **Phase 3 — action and experiment engine**
5. **Phase 4 — authenticated production pilot operations**
6. **Phase 5 — agency and commercial OS**
7. **Phase 6 — benchmark intelligence and data moat:** consent-gated aggregate benchmarks, source graphs, provider drift canaries and evidence-backed directional recommendations.

## Phase 6 principle

Customer evidence is not silently pooled. Every secondary-processing purpose requires active consent, every contribution is aggregate-only, every cohort preserves methodology comparability, and every published benchmark passes minimum privacy thresholds.

```text
active purpose consent
→ approved aggregate contribution
→ methodology-separated cohort
→ privacy threshold
→ immutable benchmark snapshot
→ tenant-safe benchmark view
```

Provider-wide drift is checked before customer movement is interpreted. Recommendation learning excludes invalid and inconclusive experiments and never upgrades observational history into a causal promise.

## Validation

```bash
npm run check
npm run check:worker
npm run demo:phase6
```

The final demo writes `output/phase6-demo/launch-readiness.json` with a thresholded five-workspace benchmark, tenant-safe view, source graph, stable canary result, directional recommendation evidence and explicit launch blockers.

## Phase 6 routes

Workspace-authorized:

```text
POST /v1/workspaces/:workspaceId/consents
POST /v1/workspaces/:workspaceId/report-versions/:reportVersionId/intelligence-contribution
GET  /v1/workspaces/:workspaceId/benchmarks/latest
POST /v1/workspaces/:workspaceId/source-graphs
GET  /v1/workspaces/:workspaceId/source-graphs/latest
GET  /v1/workspaces/:workspaceId/recommendations
```

Platform/service operations:

```text
POST /v1/intelligence/benchmark-snapshots
POST /v1/intelligence/canary-runs
GET  /v1/intelligence/drift-status
POST /v1/intelligence/recommendation-evidence
GET  /v1/intelligence/launch-readiness
```

## Privacy and trust

- Raw answers, prompts, customer names and peer brand identities are not stored in benchmark contributions.
- Standard cohorts require at least five workspaces, five brands and one hundred observations.
- Small cohorts are suppressed without distributions.
- Different prompt panels, provider profiles, search modes, geographies, locales or scoring models are not mixed.
- Workspace source graphs are purpose-consented and domain-aggregated.
- Canary drift must be reviewed before score movement is attributed to a customer.
- Recommendation confidence is directional and capped; historical outcomes do not prove future lift.

## Launch status

The repository may report **conditional readiness** until real Supabase and Cloudflare deployment, canary baselines, sufficient consented cohorts and intervention samples exist. Missing live evidence remains a visible blocker rather than a fabricated production claim.

See `docs/phase-6-benchmark-intelligence.md`.
