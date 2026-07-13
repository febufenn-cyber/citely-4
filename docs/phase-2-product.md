# Citely Phase 2 — evidence delivery and pilot portal

## Strategic thesis

Phase 1 made measurements durable and reviewable. Phase 2 creates a controlled publication boundary between internal evidence and customer-visible conclusions.

The product is not merely a dashboard. It is a workflow:

```text
reviewed observations
→ immutable report snapshot
→ operator publication
→ expiring customer access
→ evidence drill-down
→ comparable rerun
```

A customer must never receive raw provider payloads, internal reviewer notes, incomplete runs, or machine classifications that have not been accepted or corrected by a reviewer.

## Implemented vertical slice

This phase implements the minimum assisted pilot portal:

- review-queue API and append-only accept/correct/exclude decisions;
- server-side report assembly from reviewed observations and a versioned score calculation;
- immutable report versions that identify every included observation;
- explicit completeness, failures, exclusions, methodology, and limitations;
- report publication lifecycle;
- random expiring share links stored only as SHA-256 hashes;
- server-rendered evidence portal with no public raw JSON endpoint;
- report comparison that refuses direct deltas after material methodology changes;
- prompt-approval, customer-comment, dispute, comparison, and methodology-event tables;
- Phase 2 domain tests and a deterministic HTML/report demo.

## Deliberate product boundary

This remains an assisted product. Customers do not receive unrestricted run controls. An operator approves scope, budget, publication, and share-link lifetime.

Excluded from Phase 2:

- billing and plan enforcement;
- anonymous permanent public reports;
- autonomous recommendation generation;
- automatic content publishing;
- white-label agency portals;
- industry benchmarks across customers;
- unlimited self-service reruns.

## Publication invariants

1. Only audit runs in `ready` or `delivered` state can produce reports.
2. Every observation referenced by a score must have a latest review decision of `accepted` or `corrected`.
3. Failures and exclusions are disclosed but are never inserted into brand-absence denominators.
4. Report versions are append-only.
5. Publishing creates a separate publication record; corrections create a new version.
6. Public responses contain accepted classifications, answer text, and public sources, but not raw provider payloads or reviewer notes.
7. Share tokens are returned once, stored only as hashes, expire, and can be revoked.

## Report lifecycle

```text
draft
→ internal_review
→ customer_ready
→ published
→ superseded | withdrawn
```

A published report is an immutable historical statement. It is never silently edited.

## Customer experience

A shared report shows:

- executive summary;
- mention rate, weighted visibility, completeness, and reviewed evidence count;
- successful, failed, and excluded observation counts;
- customer-visible findings;
- prompt-level answers and citations;
- provider, model, search mode, and stability;
- methodology and limitations.

Every metric can be traced to an included observation ID stored in the report version.

## Comparison contract

Direct movement is shown only when these dimensions remain stable:

- prompt-panel version;
- provider profiles;
- search modes;
- geography and locale;
- scoring model.

A reported-model change is treated as directionally comparable. A material methodology change produces `not_comparable` and requires a new baseline.

Prompt changes are classified as:

- newly visible;
- lost visibility;
- improved prominence;
- declined prominence;
- stable positive;
- stable absent;
- not comparable.

## Security model

- Operator mutations require the existing operator bearer token plus an authenticated actor UUID header.
- Supabase service-role credentials remain Worker-only.
- Workspace data remains under RLS.
- `report_share_links` has no authenticated-browser read policy because token hashes are sensitive.
- Public share routes return server-rendered HTML with private/no-store headers.
- Share-link access count and last-access time are recorded.

## Blind spots preserved for pilots

- Customer authentication is not yet a full portal session; signed report access is the pilot mechanism.
- Source URLs can change after publication; content snapshots are not yet retained.
- Reviewer capacity may become the operating bottleneck.
- A small score change may still be sampling noise.
- Customers may ask for execution services rather than analytics.
- The first real staging migration may expose PostgREST relationship-shape adjustments.

## Exit criteria

Proceed to the action engine only when:

- operators can review and publish without SQL editing;
- customer-visible reports never leak internal fields;
- post-publication correction rate is low;
- customers open evidence and request reruns;
- comparable reruns produce defensible changes;
- report preparation time and reviewer capacity are predictable;
- real Supabase and Cloudflare staging tests pass end to end.
