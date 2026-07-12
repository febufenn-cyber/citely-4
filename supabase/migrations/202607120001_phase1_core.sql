-- Citely Phase 1: reliable, reviewable AI-answer measurement engine.
-- Raw observations, attempts, reviews, and score calculations are append-only evidence.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'operator', 'reviewer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  domain text not null,
  target_geography jsonb not null default '{}'::jsonb,
  locale text not null default 'en-IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, domain)
);

create table if not exists public.brand_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  alias text not null,
  alias_type text not null default 'name' check (alias_type in ('name', 'product', 'domain', 'abbreviation', 'parent_company', 'other')),
  created_at timestamptz not null default now(),
  unique (brand_id, alias)
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  domain text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table if not exists public.competitor_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  alias text not null,
  alias_type text not null default 'name' check (alias_type in ('name', 'product', 'domain', 'abbreviation', 'parent_company', 'other')),
  created_at timestamptz not null default now(),
  unique (competitor_id, alias)
);

create table if not exists public.prompt_panels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_panel_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_panel_id uuid not null references public.prompt_panels(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (prompt_panel_id, version)
);

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  stable_key text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, stable_key)
);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  version integer not null check (version > 0),
  text text not null,
  stage text not null check (stage in ('category-discovery', 'comparison', 'use-case', 'trust-risk', 'purchase-decision', 'brand-understanding')),
  importance smallint not null check (importance between 1 and 5),
  persona text,
  geography jsonb not null default '{}'::jsonb,
  locale text not null default 'en-IN',
  created_at timestamptz not null default now(),
  unique (prompt_id, version)
);

create table if not exists public.prompt_panel_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_panel_version_id uuid not null references public.prompt_panel_versions(id) on delete cascade,
  prompt_version_id uuid not null references public.prompt_versions(id) on delete restrict,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  primary key (prompt_panel_version_id, prompt_version_id),
  unique (prompt_panel_version_id, position)
);

create table if not exists public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('openai', 'perplexity', 'mock')),
  requested_model text not null,
  search_mode text not null default 'web',
  temperature numeric,
  geography jsonb not null default '{}'::jsonb,
  locale text not null default 'en-IN',
  options jsonb not null default '{}'::jsonb,
  cost_config jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, name, version)
);

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete restrict,
  prompt_panel_version_id uuid not null references public.prompt_panel_versions(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft', 'configured', 'approved', 'queued', 'running', 'partially_failed', 'awaiting_review', 'review_in_progress', 'ready', 'delivered', 'cancelled', 'budget_stopped', 'failed')),
  frozen_configuration jsonb not null,
  repetitions integer not null check (repetitions > 0),
  audit_budget_micros bigint not null check (audit_budget_micros >= 0),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  actual_cost_micros bigint not null default 0 check (actual_cost_micros >= 0),
  workflow_instance_id text,
  stop_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_run_provider_profiles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  provider_profile_id uuid not null references public.provider_profiles(id) on delete restrict,
  frozen_profile jsonb not null,
  created_at timestamptz not null default now(),
  primary key (audit_run_id, provider_profile_id)
);

create table if not exists public.audit_run_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  prompt_version_id uuid not null references public.prompt_versions(id) on delete restrict,
  provider_profile_id uuid not null references public.provider_profiles(id) on delete restrict,
  repetition integer not null check (repetition > 0),
  idempotency_key text not null unique,
  state text not null default 'planned' check (state in ('planned', 'attempting', 'retry_scheduled', 'succeeded', 'terminal_failure', 'review_required', 'accepted', 'corrected', 'excluded')),
  lease_owner text,
  lease_expires_at timestamptz,
  successful_observation_id uuid,
  failure jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_run_id, prompt_version_id, provider_profile_id, repetition)
);

create table if not exists public.observation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  audit_run_item_id uuid not null references public.audit_run_items(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  state text not null check (state in ('running', 'succeeded', 'failed')),
  worker_id text,
  requested_provider text not null,
  requested_model text not null,
  provider_request_id text,
  estimate_micros bigint not null default 0 check (estimate_micros >= 0),
  actual_micros bigint check (actual_micros >= 0),
  latency_ms integer check (latency_ms >= 0),
  failure jsonb,
  error jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (audit_run_item_id, attempt_number)
);

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  audit_run_item_id uuid not null unique references public.audit_run_items(id) on delete restrict,
  observation_key text not null unique,
  requested_provider text not null,
  requested_model text not null,
  reported_provider text,
  reported_model text,
  provider_request_id text,
  search_mode text,
  search_performed boolean,
  geography jsonb not null default '{}'::jsonb,
  locale text,
  answer_text text not null check (length(btrim(answer_text)) > 0),
  usage jsonb,
  raw_response jsonb,
  latency_ms integer check (latency_ms >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  automated_classification jsonb not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.audit_run_items
  add constraint audit_run_items_successful_observation_fk
  foreign key (successful_observation_id) references public.observations(id) on delete restrict
  deferrable initially deferred;
