# Citely Phase 4 — productionization, authentication and pilot operations

Phase 4 turns the evidence and experiment engines into an operable pilot system. Normal human access uses verified Supabase sessions. The legacy operator key remains only as a machine-to-machine escape hatch and should be rotated and restricted in production.

## Pre-phase verification

- Main commit: `89ffed8340f272cbaeba8057733ddbd4e80ef833`
- Package version: `0.4.0`
- Previous PR: #4, merged
- Existing CI: green
- Conflicting production PR: none
- Latest schema before phase: `202607130005_phase3_actions.sql`
- Live credentials: unavailable in this execution environment
- Decision: **PROCEED**, with live deployment verification explicitly pending

## Security boundary

Human requests present a Supabase access token. The Worker verifies it through Supabase Auth and resolves a platform role. Workspace-facing console reads additionally require a workspace membership and permission. The service bearer token is accepted only for trusted machine operations.

Platform roles and workspace roles are distinct. Support can read operational context but cannot mutate brands or launch runs. Reviewers cannot publish or start provider spend. Authorization attempts are append-only events and metadata is redacted.

## Pilot console

`GET /ops?workspace_id=<uuid>` returns a responsive, keyboard-readable internal console with brands, recent audit states, cost, review backlog, reports, interventions and the latest pilot verification. It is deliberately compact; it removes the need for direct SQL while avoiding a second customer-facing product.

## Deployment and recovery

- Environments are explicit: local, test, staging and production.
- Health responses disclose environment, build commit and schema version without secrets.
- Deployment records bind environment, commit and schema.
- Pilot verification records the complete audit-to-evaluation chain and security checks.
- Migrations are additive. No table or column is dropped.
- Backup, restore, retention and incident steps live in `docs/phase-4-runbook.md`.

## Live gate

Code and fixture verification do not prove that Supabase migrations or Cloudflare bindings work in the user's account. Production status remains pending until the smoke procedure is executed with real staging credentials.
