-- Phase 4: production authentication, invitations, deployment and pilot operations.
create table if not exists public.platform_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_admin','platform_operator','platform_reviewer','support')),
  granted_by uuid references auth.users(id), granted_at timestamptz not null default now(), revoked_at timestamptz
);
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null, role text not null check (role in ('owner','operator','reviewer','viewer')),
  token_hash text not null unique, invited_by uuid not null references auth.users(id), expires_at timestamptz not null,
  accepted_by uuid references auth.users(id), accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists workspace_invitations_workspace_idx on public.workspace_invitations(workspace_id, created_at desc);
create table if not exists public.revoked_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null unique, reason text, revoked_by uuid references auth.users(id), revoked_at timestamptz not null default now()
);
create table if not exists public.authorization_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id), principal_type text not null check (principal_type in ('anonymous','user','service')),
  platform_role text, action text not null, outcome text not null check (outcome in ('allowed','denied','error')),
  correlation_id text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists authorization_events_correlation_idx on public.authorization_events(correlation_id, created_at);
create table if not exists public.deployment_records (
  id uuid primary key default gen_random_uuid(), environment text not null check (environment in ('local','test','staging','production')),
  commit_sha text not null, schema_version text not null, worker_name text not null default 'citely', manifest jsonb not null,
  status text not null check (status in ('planned','deployed','verified','failed')), deployed_by uuid references auth.users(id),
  deployed_at timestamptz, verified_at timestamptz, created_at timestamptz not null default now(), unique(environment, commit_sha, schema_version)
);
create table if not exists public.provider_health_snapshots (
  id uuid primary key default gen_random_uuid(), provider text not null, model text, environment text not null,
  status text not null check (status in ('healthy','degraded','down','unknown')), success_rate numeric, p95_latency_ms integer,
  cost_micros bigint, sample_count integer not null default 0, correlation_id text, details jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create table if not exists public.pilot_verifications (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  environment text not null, commit_sha text not null, schema_version text not null, status text not null check (status in ('passed','failed','partial')),
  stages jsonb not null, security_checks jsonb not null, live_infrastructure_verified boolean not null default false,
  limitations jsonb not null default '[]'::jsonb, correlation_id text not null, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
alter table public.platform_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.revoked_sessions enable row level security;
alter table public.authorization_events enable row level security;
alter table public.deployment_records enable row level security;
alter table public.provider_health_snapshots enable row level security;
alter table public.pilot_verifications enable row level security;
create policy platform_members_self_read on public.platform_members for select using (user_id = auth.uid());
create policy workspace_invitations_read on public.workspace_invitations for select using (public.has_workspace_role(workspace_id, array['owner','operator']));
create policy workspace_invitations_manage on public.workspace_invitations for all using (public.has_workspace_role(workspace_id, array['owner'])) with check (public.has_workspace_role(workspace_id, array['owner']));
create policy authorization_events_workspace_read on public.authorization_events for select using (workspace_id is not null and public.has_workspace_role(workspace_id, array['owner','operator']));
create policy pilot_verifications_read on public.pilot_verifications for select using (public.is_workspace_member(workspace_id));
create policy pilot_verifications_write on public.pilot_verifications for insert with check (public.has_workspace_role(workspace_id, array['owner','operator']));
create or replace function public.prevent_phase4_audit_mutation() returns trigger language plpgsql as $$ begin raise exception 'operational audit records are append-only'; end; $$;
create trigger authorization_events_immutable before update or delete on public.authorization_events for each row execute function public.prevent_phase4_audit_mutation();
create trigger provider_health_snapshots_immutable before update or delete on public.provider_health_snapshots for each row execute function public.prevent_phase4_audit_mutation();
create trigger pilot_verifications_immutable before update or delete on public.pilot_verifications for each row execute function public.prevent_phase4_audit_mutation();
