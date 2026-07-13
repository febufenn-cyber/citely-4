-- Citely Phase 2: reviewed report publication, controlled customer access, approvals, and comparisons.

create table if not exists public.report_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null unique references public.audit_runs(id) on delete restrict,
  title text not null,
  state text not null default 'draft' check (state in ('draft','internal_review','customer_ready','published','superseded','withdrawn')),
  executive_summary text not null default '',
  internal_notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_draft_id uuid not null references public.report_drafts(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  input_observation_ids uuid[] not null,
  scoring_model_version text not null references public.scoring_models(version),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (report_draft_id, version)
);

create table if not exists public.report_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_version_id uuid not null unique references public.report_versions(id) on delete restrict,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  superseded_by uuid references public.report_publications(id) on delete restrict
);

create table if not exists public.report_share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_publication_id uuid not null references public.report_publications(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  last_accessed_at timestamptz,
  access_count bigint not null default 0 check (access_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.prompt_approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_panel_version_id uuid not null references public.prompt_panel_versions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','approved','changes_requested','cancelled')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.prompt_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null references public.prompt_approval_requests(id) on delete cascade,
  prompt_version_id uuid references public.prompt_versions(id) on delete restrict,
  decided_by uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','changes_requested','irrelevant','suggested')),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_draft_id uuid not null references public.report_drafts(id) on delete cascade,
  report_version_id uuid references public.report_versions(id) on delete restrict,
  observation_id uuid references public.observations(id) on delete restrict,
  visibility text not null default 'customer' check (visibility in ('internal','customer')),
  body text not null check (length(btrim(body)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create table if not exists public.finding_disputes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_version_id uuid not null references public.report_versions(id) on delete restrict,
  finding_id text not null,
  explanation text not null,
  supporting_url text,
  state text not null default 'open' check (state in ('open','accepted','rejected','revision_required','resolved')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_notes text
);

create table if not exists public.audit_run_comparisons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  current_audit_run_id uuid not null references public.audit_runs(id) on delete restrict,
  baseline_audit_run_id uuid not null references public.audit_runs(id) on delete restrict,
  current_report_version_id uuid references public.report_versions(id) on delete restrict,
  baseline_report_version_id uuid references public.report_versions(id) on delete restrict,
  comparability text not null check (comparability in ('fully_comparable','directionally_comparable','not_comparable')),
  reasons jsonb not null default '[]'::jsonb,
  results jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (current_audit_run_id, baseline_audit_run_id, current_report_version_id, baseline_report_version_id)
);

create table if not exists public.methodology_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  audit_run_id uuid references public.audit_runs(id) on delete cascade,
  event_type text not null check (event_type in ('prompt_panel_changed','provider_profile_changed','reported_model_changed','search_mode_changed','scoring_model_changed','alias_corrected','provider_incident','new_baseline')),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists report_versions_report_idx on public.report_versions (report_draft_id, version desc);
create index if not exists report_publications_version_idx on public.report_publications (report_version_id);
create index if not exists report_share_links_token_idx on public.report_share_links (token_hash) where revoked_at is null;
create index if not exists report_comments_report_idx on public.report_comments (report_draft_id, created_at);
create index if not exists finding_disputes_version_idx on public.finding_disputes (report_version_id, state);
create index if not exists methodology_events_brand_idx on public.methodology_events (brand_id, occurred_at desc);
