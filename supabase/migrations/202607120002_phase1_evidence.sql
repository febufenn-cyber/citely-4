-- Citely Phase 1: evidence, review, scoring, budgets, and indexes.

create table if not exists public.response_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  observation_id uuid not null references public.observations(id) on delete cascade,
  url text not null,
  title text,
  domain text,
  source_kind text not null default 'retrieved' check (source_kind in ('retrieved', 'inline_citation')),
  ownership text not null default 'unknown' check (ownership in ('brand_owned', 'competitor_owned', 'third_party', 'unknown', 'invalid')),
  citation_start integer,
  citation_end integer,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  observation_id uuid not null references public.observations(id) on delete cascade,
  entity_kind text not null check (entity_kind in ('brand', 'competitor', 'other')),
  entity_id uuid,
  alias text not null,
  character_start integer not null check (character_start >= 0),
  character_end integer not null check (character_end >= character_start),
  machine_confidence numeric check (machine_confidence between 0 and 1),
  context_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  audit_run_item_id uuid not null references public.audit_run_items(id) on delete restrict,
  observation_id uuid not null references public.observations(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('accepted', 'corrected', 'excluded')),
  reason_code text,
  notes text,
  machine_classification jsonb not null,
  accepted_classification jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scoring_models (
  version text primary key,
  description text not null,
  configuration jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.scoring_models (version, description, configuration)
values ('visibility-v1', 'Reviewed decomposed visibility metrics; failures are excluded from brand-absence denominators.', '{"mention_status_min":0,"mention_status_max":4}'::jsonb)
on conflict (version) do nothing;

create table if not exists public.score_calculations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  scoring_model_version text not null references public.scoring_models(version),
  input_observation_ids uuid[] not null,
  metrics jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.budget_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid references public.audit_runs(id) on delete cascade,
  audit_run_item_id uuid references public.audit_run_items(id) on delete cascade,
  event_type text not null check (event_type in ('estimated', 'reserved', 'committed', 'released', 'rejected', 'override')),
  scope text not null check (scope in ('audit', 'workspace', 'global')),
  amount_micros bigint not null check (amount_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid references public.audit_runs(id) on delete cascade,
  audit_run_item_id uuid references public.audit_run_items(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('system', 'user', 'workflow', 'provider')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_run_items_run_state_idx on public.audit_run_items (audit_run_id, state);
create index if not exists audit_run_items_lease_idx on public.audit_run_items (lease_expires_at) where lease_owner is not null;
create index if not exists observation_attempts_item_idx on public.observation_attempts (audit_run_item_id, attempt_number);
create index if not exists observations_run_idx on public.observations (audit_run_id);
create index if not exists response_sources_observation_idx on public.response_sources (observation_id);
create index if not exists review_decisions_item_idx on public.review_decisions (audit_run_item_id, created_at desc);
create index if not exists audit_events_run_created_idx on public.audit_events (audit_run_id, created_at);
