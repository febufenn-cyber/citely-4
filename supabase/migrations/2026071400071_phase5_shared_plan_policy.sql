-- Shared commercial plan definitions are readable but not browser-writable.
alter table public.commercial_plans enable row level security;
create policy commercial_plans_read on public.commercial_plans for select to authenticated using (status = 'active');
