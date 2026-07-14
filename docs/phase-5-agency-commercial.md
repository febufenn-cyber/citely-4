# Citely Phase 5 — agency OS and commercialization

Phase 5 turns the authenticated pilot system into a controlled multi-client operating system. Agency access is an explicit link to each client workspace; it never merges tenant data. Clients cannot see sibling clients. Limits are enforced before provider work is started.

## Pre-phase verification

- Main commit: `74e2a8bc0e52f9f874f58c2e46f1d73f2e51222c`
- Package version: `0.5.0`
- Previous PR: #5, merged with green CI
- Schema baseline: `202607140006_phase4_production_auth.sql`
- Billing credentials: unavailable; manual/provider-neutral mode is used
- Decision: **PROCEED**

## Portfolio model

Agency owners and operators can access only workspaces linked through `agency_workspace_links`. Client owners, editors and viewers are scoped to one workspace. Safe support continues through the Phase 4 platform role and authorization audit log.

## Entitlements

Plans define brand, observation and run limits, retention and features. The Worker evaluates limits server-side before a scheduled or manually requested run. Usage and commercial decisions are immutable events. A provider webhook event is unique by provider and event ID, and stale events do not regress the subscription projection.

## Scheduling

Supported cadences are monthly, quarterly, one-time and incident. Schedule execution keys are deterministic, so duplicate scheduler deliveries cannot create duplicate runs. Paused and cancelled schedules remain inactive. A stable shard spreads work across a window.

## Agency output

Agency styling is permitted, but exports and reports always retain Citely methodology, completeness, limitations and observational-language disclosures. CSV exports use approved report snapshots only and exclude raw provider payloads and internal review notes.

## Boundaries

No cross-customer benchmark is generated. Billing may remain manual. Unlimited provider calls, autonomous site publication and revenue attribution are disabled.
