-- Phase 6: consent-gated benchmark intelligence, source graphs, canary drift and recommendation evidence.
create table if not exists public.data_processing_consents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purpose text not null check(purpose in('benchmark_intelligence','recommendation_learning','source_graph')),
  policy_version text not null, status text not null check(status in('granted','withdrawn','expired')),
  granted_by uuid references auth.users(id), granted_at timestamptz, expires_at timestamptz,
  withdrawn_by uuid references auth.users(id), withdrawn_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists active_processing_consent_idx on public.data_processing_consents(workspace_id,purpose) where status='granted';
create table if not exists public.benchmark_cohort_rules (
  id uuid primary key default gen_random_uuid(), key text not null, version integer not null check(version>0), purpose text not null default 'benchmark_intelligence',
  dimensions jsonb not null, min_workspaces integer not null check(min_workspaces>=3), min_brands integer not null check(min_brands>=3),
  min_observations integer not null check(min_observations>=1), metric_keys jsonb not null, active boolean not null default true,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(key,version)
);
insert into public.benchmark_cohort_rules(key,version,dimensions,min_workspaces,min_brands,min_observations,metric_keys)
values('standard-industry-geo-locale',1,'["industry","geography","locale"]'::jsonb,5,5,100,'["mentionRate","weightedVisibility","firstMentionRate"]'::jsonb)
on conflict(key,version) do nothing;
create table if not exists public.benchmark_contributions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade, report_version_id uuid not null references public.report_versions(id) on delete restrict,
  consent_id uuid not null references public.data_processing_consents(id) on delete restrict, cohort_rule_id uuid not null references public.benchmark_cohort_rules(id) on delete restrict,
  methodology_fingerprint text not null, cohort_dimensions jsonb not null, aggregate_metrics jsonb not null,
  observation_count integer not null check(observation_count>0), eligible boolean not null default true, excluded_reason text,
  contributed_at timestamptz not null default now(), unique(report_version_id,cohort_rule_id)
);
create index if not exists benchmark_contributions_cohort_idx on public.benchmark_contributions(cohort_rule_id,methodology_fingerprint,eligible);
create table if not exists public.benchmark_snapshots (
  id uuid primary key default gen_random_uuid(), cohort_rule_id uuid not null references public.benchmark_cohort_rules(id) on delete restrict,
  fingerprint text not null unique, snapshot jsonb not null, status text not null check(status in('draft','published','superseded','withdrawn')),
  generated_by text not null default 'system', generated_at timestamptz not null default now(), published_at timestamptz
);
create table if not exists public.source_graph_snapshots (
  id uuid primary key default gen_random_uuid(), scope_key text not null, methodology_fingerprint text not null,
  fingerprint text not null unique, graph jsonb not null, status text not null check(status in('draft','published','superseded')),
  generated_at timestamptz not null default now()
);
create table if not exists public.canary_panels (
  id uuid primary key default gen_random_uuid(), key text not null, version integer not null check(version>0), prompts jsonb not null,
  provider_profiles jsonb not null, active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(key,version)
);
create table if not exists public.canary_runs (
  id uuid primary key default gen_random_uuid(), canary_panel_id uuid not null references public.canary_panels(id) on delete restrict,
  environment text not null, build_commit text, status text not null check(status in('running','completed','failed')),
  started_at timestamptz not null default now(), completed_at timestamptz, correlation_id text not null
);
create table if not exists public.canary_metrics (
  id uuid primary key default gen_random_uuid(), canary_run_id uuid not null references public.canary_runs(id) on delete cascade,
  provider text not null, model text, sample_count integer not null check(sample_count>=0), success_rate numeric,
  refusal_rate numeric, mean_citations numeric, p95_latency_ms integer, mean_cost_micros bigint, mean_mention_status numeric,
  drift_status text check(drift_status in('stable','medium','high','unknown')), drift_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), unique(canary_run_id,provider,model)
);
create table if not exists public.recommendation_evidence (
  id uuid primary key default gen_random_uuid(), cohort_key text not null, intervention_type text not null, mechanism text not null,
  sample_count integer not null check(sample_count>=0), favourable_rate numeric, regression_rate numeric, median_delta numeric,
  confidence text not null check(confidence in('suppressed','low_directional','moderate_directional')),
  limitations jsonb not null, evidence_window jsonb not null, status text not null check(status in('draft','published','withdrawn')),
  fingerprint text not null unique, generated_at timestamptz not null default now()
);
create table if not exists public.processing_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  purpose text not null, event_type text not null, resource_type text, resource_id text, actor_type text not null check(actor_type in('user','service','system')),
  actor_id text, correlation_id text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.launch_readiness_snapshots (
  id uuid primary key default gen_random_uuid(), build_commit text not null, schema_version text not null,
  status text not null check(status in('ready','conditional','blocked')), checks jsonb not null, blocked_capabilities jsonb not null,
  live_infrastructure_verified boolean not null default false, created_at timestamptz not null default now()
);
alter table public.data_processing_consents enable row level security;
alter table public.benchmark_cohort_rules enable row level security;
alter table public.benchmark_contributions enable row level security;
alter table public.benchmark_snapshots enable row level security;
alter table public.source_graph_snapshots enable row level security;
alter table public.canary_panels enable row level security;
alter table public.canary_runs enable row level security;
alter table public.canary_metrics enable row level security;
alter table public.recommendation_evidence enable row level security;
alter table public.processing_events enable row level security;
alter table public.launch_readiness_snapshots enable row level security;
create policy processing_consents_read on public.data_processing_consents for select using(public.is_workspace_member(workspace_id));
create policy processing_consents_insert on public.data_processing_consents for insert with check(public.has_workspace_role(workspace_id,array['owner']));
create policy processing_consents_update on public.data_processing_consents for update using(public.has_workspace_role(workspace_id,array['owner'])) with check(public.has_workspace_role(workspace_id,array['owner']));
-- Intelligence source records and snapshots are service-only. Workspace APIs return only thresholded, tenant-safe projections.
create or replace function public.prevent_intelligence_snapshot_mutation() returns trigger language plpgsql as $$ begin raise exception 'intelligence snapshots and processing events are append-only'; end; $$;
create trigger benchmark_snapshots_immutable before update or delete on public.benchmark_snapshots for each row execute function public.prevent_intelligence_snapshot_mutation();
create trigger source_graph_snapshots_immutable before update or delete on public.source_graph_snapshots for each row execute function public.prevent_intelligence_snapshot_mutation();
create trigger canary_metrics_immutable before update or delete on public.canary_metrics for each row execute function public.prevent_intelligence_snapshot_mutation();
create trigger recommendation_evidence_immutable before update or delete on public.recommendation_evidence for each row execute function public.prevent_intelligence_snapshot_mutation();
create trigger processing_events_immutable before update or delete on public.processing_events for each row execute function public.prevent_intelligence_snapshot_mutation();
create trigger launch_readiness_immutable before update or delete on public.launch_readiness_snapshots for each row execute function public.prevent_intelligence_snapshot_mutation();
