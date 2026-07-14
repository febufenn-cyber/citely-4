# Citely Phase 6 — benchmark intelligence and data moat

Phase 6 creates defensible aggregate intelligence without turning customer evidence into an uncontrolled shared dataset. Participation is purpose-specific and revocable. Contributions contain approved aggregate metrics only; raw answers, prompts, customer names and peer brand identities are never published in benchmark output.

## Pre-phase verification

- Main commit: `30fdbacd5aa46714d354f3e4e34406198551d6bd`
- Package version: `0.6.0`
- Previous PR: #6, merged with green CI
- Schema baseline: `2026071400071_phase5_shared_plan_policy.sql`
- Conflicting benchmark PRs: none
- Decision: **PROCEED**

## Consent and purpose limitation

Consent purposes are separate: benchmark intelligence, recommendation learning and source graphs. Withdrawing one purpose does not affect another. Snapshot builders recheck current consent rather than trusting an old contribution flag. Processing events record grants, withdrawals, contributions and published snapshots.

## Privacy thresholds

A standard cohort requires at least five distinct workspaces, five brands and one hundred reviewed observations under the same methodology and declared industry/geography/locale dimensions. Smaller cohorts are returned only as suppressed counts without distributions. Cohorts with different prompt panels, provider profiles, search modes, geography, locale or scoring models are not mixed.

## Source intelligence

Source graphs distinguish inline citations from retrieved sources, aggregate by domain and provider, retain ownership categories, and mark provider-dependent domains. Graphs are workspace-scoped unless a separate consented aggregate rule is introduced.

## Drift before interpretation

Fixed canary panels measure refusal rate, citation patterns, latency, cost and mention distribution. Medium or high provider drift sets `mustReviewBeforeCustomerInterpretation`. A customer score movement must not be explained as marketing performance until this check is clear.

## Recommendation learning

Recommendation evidence includes only implemented interventions with verifiable implementation evidence and valid outcomes. Invalid and inconclusive experiments are excluded. Small samples are suppressed, confidence remains directional, and every response states that historical observational outcomes do not prove causation or future lift.

## Launch status

Version 1.0 may ship with a `conditional` readiness status when live Supabase/Cloudflare deployment, canary baselines, sufficient consented cohorts or intervention samples are missing. Those capabilities remain visibly blocked rather than fabricated.
