-- Citely Phase 3: findings, assigned interventions, implementation evidence, and guarded experiment evaluation.

create table if not exists public.action_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  source_report_version_id uuid not null references public.report_versions(id) on delete restrict,
  finding_type text not null check (finding_type in ('visibility_gap','competitor_advantage','citation_gap','accuracy_risk','source_opportunity','other')),
  title text not null,
  summary text not null,
  evidence_observation_ids uuid[] not null default '{}',
  impact smallint not null default 3 check (impact between 1 and 5),
  confidence_score smallint not null default 3 check (confidence_score between 1 and 5),
  urgency smallint not null default 3 check (urgency between 1 and 5),
  effort smallint not null default 3 check (effort between 1 and 5),
  priority_score numeric not null check (priority_score >= 0),
  state text not null default 'open' check (state in ('open','planned','dismissed','resolved')),
  customer_visible boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  finding_id uuid not null references public.action_findings(id) on delete restrict,
  title text not null,
  intervention_type text not null check (intervention_type in ('content_update','new_content','technical','digital_pr','source_correction','product_messaging','other')),
  hypothesis text not null,
  mechanism text not null,
  owner_user_id uuid references auth.users(id),
  target_urls jsonb not null default '[]'::jsonb,
  state text not null default 'draft' check (state in ('draft','approved','in_progress','implemented','cancelled')),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  started_at timestamptz,
  implemented_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intervention_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  event_type text not null check (event_type in ('created','approved','started','implemented','cancelled','note','owner_changed')),
  actor_id uuid references auth.users(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.implementation_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('url','deployment','screenshot','document','note','other')),
  url text,
  description text not null,
  content_hash text,
  captured_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (url is not null or length(btrim(description)) > 0)
);

create table if not exists public.experiment_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  intervention_id uuid not null unique references public.interventions(id) on delete restrict,
  baseline_report_version_id uuid not null references public.report_versions(id) on delete restrict,
  baseline_methodology_fingerprint text not null,
  baseline_value numeric not null,
  target_prompt_keys text[] not null check (cardinality(target_prompt_keys) > 0),
  target_providers text[] not null default '{}',
  primary_metric text not null check (primary_metric in ('mention_rate','average_mention_status','weighted_visibility')),
  expected_direction text not null default 'increase' check (expected_direction in ('increase','decrease')),
  minimum_delta numeric not null default 0 check (minimum_delta >= 0),
  minimum_completeness numeric not null default 0.8 check (minimum_completeness between 0 and 1),
  minimum_sample_size integer not null default 3 check (minimum_sample_size > 0),
  observation_window_days integer not null default 30 check (observation_window_days between 1 and 365),
  guardrails jsonb not null default '{"requireImplementationEvidence":true,"rejectProviderWideAnomaly":true,"requireStableTargetSamples":true}'::jsonb,
  state text not null default 'draft' check (state in ('draft','approved','running','awaiting_measurement','evaluated','invalidated')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.experiment_evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_plan_id uuid not null references public.experiment_plans(id) on delete restrict,
  baseline_report_version_id uuid not null references public.report_versions(id) on delete restrict,
  current_report_version_id uuid not null references public.report_versions(id) on delete restrict,
  outcome text not null check (outcome in ('success','partial_success','no_change','regression','inconclusive','invalid')),
  causal_confidence text not null check (causal_confidence in ('none','low','moderate')),
  baseline_value numeric not null,
  current_value numeric not null,
  delta numeric not null,
  target_observation_counts jsonb not null,
  data_completeness numeric not null check (data_completeness between 0 and 1),
  comparability jsonb not null,
  reasons text[] not null default '{}',
  statement text not null,
  provider_wide_anomaly boolean not null default false,
  uncontrolled_changes jsonb not null default '[]'::jsonb,
  evaluated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (experiment_plan_id, current_report_version_id)
);

create trigger action_findings_set_updated_at before update on public.action_findings for each row execute function public.set_updated_at();
create trigger interventions_set_updated_at before update on public.interventions for each row execute function public.set_updated_at();
create trigger experiment_plans_set_updated_at before update on public.experiment_plans for each row execute function public.set_updated_at();

create trigger intervention_events_immutable before update or delete on public.intervention_events for each row execute function public.prevent_evidence_mutation();
create trigger implementation_evidence_immutable before update or delete on public.implementation_evidence for each row execute function public.prevent_evidence_mutation();
create trigger experiment_evaluations_immutable before update or delete on public.experiment_evaluations for each row execute function public.prevent_evidence_mutation();

create or replace function public.prevent_frozen_experiment_mutation()
returns trigger language plpgsql as $$
begin
  if old.state <> 'draft' and (
    new.intervention_id is distinct from old.intervention_id or
    new.baseline_report_version_id is distinct from old.baseline_report_version_id or
    new.baseline_methodology_fingerprint is distinct from old.baseline_methodology_fingerprint or
    new.baseline_value is distinct from old.baseline_value or
    new.target_prompt_keys is distinct from old.target_prompt_keys or
    new.target_providers is distinct from old.target_providers or
    new.primary_metric is distinct from old.primary_metric or
    new.expected_direction is distinct from old.expected_direction or
    new.minimum_delta is distinct from old.minimum_delta or
    new.minimum_completeness is distinct from old.minimum_completeness or
    new.minimum_sample_size is distinct from old.minimum_sample_size or
    new.observation_window_days is distinct from old.observation_window_days or
    new.guardrails is distinct from old.guardrails
  ) then
    raise exception 'Approved experiment configuration is frozen; invalidate and create a new plan';
  end if;
  return new;
end;
$$;
create trigger experiment_plans_frozen before update on public.experiment_plans for each row when (old.state <> 'draft') execute function public.prevent_frozen_experiment_mutation();

alter table public.action_findings enable row level security;
alter table public.interventions enable row level security;
alter table public.intervention_events enable row level security;
alter table public.implementation_evidence enable row level security;
alter table public.experiment_plans enable row level security;
alter table public.experiment_evaluations enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['action_findings','interventions','intervention_events','implementation_evidence','experiment_plans','experiment_evaluations'] loop
    execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for insert with check (public.has_workspace_role(workspace_id, array[''owner'',''operator'',''reviewer'']))', table_name || '_insert', table_name);
    if table_name in ('action_findings','interventions','experiment_plans') then
      execute format('create policy %I on public.%I for update using (public.has_workspace_role(workspace_id, array[''owner'',''operator''])) with check (public.has_workspace_role(workspace_id, array[''owner'',''operator'']))', table_name || '_update', table_name);
    end if;
  end loop;
end $$;

create index if not exists action_findings_brand_state_idx on public.action_findings (brand_id, state, priority_score desc);
create index if not exists interventions_finding_state_idx on public.interventions (finding_id, state);
create index if not exists intervention_events_intervention_idx on public.intervention_events (intervention_id, created_at);
create index if not exists implementation_evidence_intervention_idx on public.implementation_evidence (intervention_id, captured_at);
create index if not exists experiment_plans_brand_state_idx on public.experiment_plans (brand_id, state);
create index if not exists experiment_evaluations_plan_created_idx on public.experiment_evaluations (experiment_plan_id, created_at desc);
