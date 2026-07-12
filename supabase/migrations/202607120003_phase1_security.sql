-- Citely Phase 1: functions, append-only controls, atomic claiming, and RLS.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger brands_set_updated_at before update on public.brands for each row execute function public.set_updated_at();
create trigger competitors_set_updated_at before update on public.competitors for each row execute function public.set_updated_at();
create trigger prompt_panels_set_updated_at before update on public.prompt_panels for each row execute function public.set_updated_at();
create trigger audit_runs_set_updated_at before update on public.audit_runs for each row execute function public.set_updated_at();
create trigger audit_run_items_set_updated_at before update on public.audit_run_items for each row execute function public.set_updated_at();

create or replace function public.prevent_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Citely evidence is append-only; create a review/correction record instead';
end;
$$;

create trigger observations_immutable before update or delete on public.observations for each row execute function public.prevent_evidence_mutation();
create trigger observation_attempts_immutable before update or delete on public.observation_attempts for each row when (old.completed_at is not null) execute function public.prevent_evidence_mutation();
create trigger review_decisions_immutable before update or delete on public.review_decisions for each row execute function public.prevent_evidence_mutation();
create trigger score_calculations_immutable before update or delete on public.score_calculations for each row execute function public.prevent_evidence_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function public.prevent_evidence_mutation();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any(allowed_roles)
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.has_workspace_role(uuid, text[]) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated, service_role;

create or replace function public.claim_audit_run_item(p_item_id uuid, p_worker_id text, p_lease_seconds integer default 60)
returns setof public.audit_run_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 1 and 900';
  end if;
  return query
  update public.audit_run_items item
     set state = 'attempting',
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where item.id = p_item_id
     and item.successful_observation_id is null
     and item.state in ('planned', 'retry_scheduled', 'terminal_failure', 'attempting')
     and (item.lease_owner is null or item.lease_expires_at < now() or item.lease_owner = p_worker_id)
  returning item.*;
end;
$$;

revoke all on function public.claim_audit_run_item(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_audit_run_item(uuid, text, integer) to service_role;

-- Browser access is workspace-isolated. Provider keys and service-role credentials remain Worker-only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspaces','workspace_members','brands','brand_aliases','competitors','competitor_aliases',
    'prompt_panels','prompt_panel_versions','prompts','prompt_versions','prompt_panel_items',
    'provider_profiles','audit_runs','audit_run_provider_profiles','audit_run_items',
    'observation_attempts','observations','response_sources','entity_mentions','review_decisions',
    'score_calculations','budget_events','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy workspaces_select on public.workspaces for select using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update using (public.has_workspace_role(id, array['owner'])) with check (public.has_workspace_role(id, array['owner']));
create policy workspace_members_select on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy workspace_members_manage on public.workspace_members for all using (public.has_workspace_role(workspace_id, array['owner'])) with check (public.has_workspace_role(workspace_id, array['owner']));

-- Generate standard workspace policies for all tenant tables except the two above.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'brands','brand_aliases','competitors','competitor_aliases','prompt_panels','prompt_panel_versions',
    'prompts','prompt_versions','prompt_panel_items','provider_profiles','audit_runs','audit_run_provider_profiles',
    'audit_run_items','observation_attempts','observations','response_sources','entity_mentions','review_decisions',
    'score_calculations','budget_events','audit_events'
  ] loop
    execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for insert with check (public.has_workspace_role(workspace_id, array[''owner'',''operator'',''reviewer'']))', table_name || '_insert', table_name);
    -- Immutable evidence tables reject updates through triggers even for operators.
    if table_name not in ('observations','review_decisions','score_calculations','audit_events') then
      execute format('create policy %I on public.%I for update using (public.has_workspace_role(workspace_id, array[''owner'',''operator''])) with check (public.has_workspace_role(workspace_id, array[''owner'',''operator'']))', table_name || '_update', table_name);
    end if;
  end loop;
end $$;

alter table public.scoring_models enable row level security;
create policy scoring_models_read on public.scoring_models for select to authenticated using (true);
