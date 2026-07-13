-- Citely Phase 2: publication immutability and workspace-isolated access.

create trigger report_drafts_set_updated_at before update on public.report_drafts for each row execute function public.set_updated_at();
create trigger report_versions_immutable before update or delete on public.report_versions for each row execute function public.prevent_evidence_mutation();
create trigger prompt_approval_decisions_immutable before update or delete on public.prompt_approval_decisions for each row execute function public.prevent_evidence_mutation();
create trigger audit_run_comparisons_immutable before update or delete on public.audit_run_comparisons for each row execute function public.prevent_evidence_mutation();
create trigger methodology_events_immutable before update or delete on public.methodology_events for each row execute function public.prevent_evidence_mutation();

alter table public.report_drafts enable row level security;
alter table public.report_versions enable row level security;
alter table public.report_publications enable row level security;
alter table public.report_share_links enable row level security;
alter table public.prompt_approval_requests enable row level security;
alter table public.prompt_approval_decisions enable row level security;
alter table public.report_comments enable row level security;
alter table public.finding_disputes enable row level security;
alter table public.audit_run_comparisons enable row level security;
alter table public.methodology_events enable row level security;

create policy report_drafts_select on public.report_drafts for select using (public.is_workspace_member(workspace_id));
create policy report_drafts_insert on public.report_drafts for insert with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));
create policy report_drafts_update on public.report_drafts for update using (public.has_workspace_role(workspace_id, array['owner','operator'])) with check (public.has_workspace_role(workspace_id, array['owner','operator']));

create policy report_versions_select on public.report_versions for select using (public.is_workspace_member(workspace_id));
create policy report_versions_insert on public.report_versions for insert with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));

create policy report_publications_select on public.report_publications for select using (public.is_workspace_member(workspace_id));
create policy report_publications_insert on public.report_publications for insert with check (public.has_workspace_role(workspace_id, array['owner','operator']));
create policy report_publications_update on public.report_publications for update using (public.has_workspace_role(workspace_id, array['owner','operator'])) with check (public.has_workspace_role(workspace_id, array['owner','operator']));

-- Share-link hashes are service-role only. No authenticated browser policy is created.

create policy prompt_approval_requests_select on public.prompt_approval_requests for select using (public.is_workspace_member(workspace_id));
create policy prompt_approval_requests_insert on public.prompt_approval_requests for insert with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));
create policy prompt_approval_requests_update on public.prompt_approval_requests for update using (public.has_workspace_role(workspace_id, array['owner','operator'])) with check (public.has_workspace_role(workspace_id, array['owner','operator']));
create policy prompt_approval_decisions_select on public.prompt_approval_decisions for select using (public.is_workspace_member(workspace_id));
create policy prompt_approval_decisions_insert on public.prompt_approval_decisions for insert with check (public.is_workspace_member(workspace_id));

create policy report_comments_select on public.report_comments for select using (public.is_workspace_member(workspace_id) and (visibility = 'customer' or public.has_workspace_role(workspace_id, array['owner','operator','reviewer'])));
create policy report_comments_insert on public.report_comments for insert with check (public.is_workspace_member(workspace_id));
create policy report_comments_update on public.report_comments for update using (public.has_workspace_role(workspace_id, array['owner','operator','reviewer'])) with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));

create policy finding_disputes_select on public.finding_disputes for select using (public.is_workspace_member(workspace_id));
create policy finding_disputes_insert on public.finding_disputes for insert with check (public.is_workspace_member(workspace_id));
create policy finding_disputes_update on public.finding_disputes for update using (public.has_workspace_role(workspace_id, array['owner','operator','reviewer'])) with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));

create policy audit_run_comparisons_select on public.audit_run_comparisons for select using (public.is_workspace_member(workspace_id));
create policy audit_run_comparisons_insert on public.audit_run_comparisons for insert with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));
create policy methodology_events_select on public.methodology_events for select using (public.is_workspace_member(workspace_id));
create policy methodology_events_insert on public.methodology_events for insert with check (public.has_workspace_role(workspace_id, array['owner','operator','reviewer']));
