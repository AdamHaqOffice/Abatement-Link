-- Companies and sharing
-- v2.4: creator/admin companies are manageable; viewer/shared companies are view-only.
-- Security-definer helpers avoid RLS self-recursion on company policies.

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  );
$$;

create or replace function public.user_can_manage_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and c.created_by = auth.uid()
  )
  or exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
      and cm.accepted_at is not null
  );
$$;

drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies for select to authenticated using (
  created_by = auth.uid() or public.is_company_member(id)
);
drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated with check (created_by = auth.uid());
drop policy if exists companies_update_owner on public.companies;
create policy companies_update_owner on public.companies for update to authenticated using (public.user_can_manage_company(id)) with check (public.user_can_manage_company(id));

drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members for select to authenticated using (
  user_id = auth.uid() or public.user_can_manage_company(company_id) or public.is_company_member(company_id)
);
drop policy if exists company_members_insert_owner on public.company_members;
create policy company_members_insert_owner on public.company_members for insert to authenticated with check (
  public.user_can_manage_company(company_id)
);
drop policy if exists company_members_update_admin on public.company_members;
create policy company_members_update_admin on public.company_members for update to authenticated using (
  public.user_can_manage_company(company_id)
) with check (
  public.user_can_manage_company(company_id)
);
drop policy if exists company_members_delete_admin on public.company_members;
create policy company_members_delete_admin on public.company_members for delete to authenticated using (
  public.user_can_manage_company(company_id)
);

drop policy if exists company_invites_select_owner on public.company_invites;
create policy company_invites_select_owner on public.company_invites for select to authenticated using (
  email = (select lower(email) from auth.users where id = auth.uid()) or public.user_can_manage_company(company_id)
);
drop policy if exists company_invites_insert_owner on public.company_invites;
create policy company_invites_insert_owner on public.company_invites for insert to authenticated with check (
  public.user_can_manage_company(company_id)
);
drop policy if exists company_invites_update_admin on public.company_invites;
create policy company_invites_update_admin on public.company_invites for update to authenticated using (
  public.user_can_manage_company(company_id) or email = (select lower(email) from auth.users where id = auth.uid())
) with check (
  public.user_can_manage_company(company_id) or email = (select lower(email) from auth.users where id = auth.uid())
);
drop policy if exists company_invites_delete_admin on public.company_invites;
create policy company_invites_delete_admin on public.company_invites for delete to authenticated using (
  public.user_can_manage_company(company_id)
);

drop policy if exists company_devices_select on public.company_devices;
create policy company_devices_select on public.company_devices for select to authenticated using (
  public.is_company_member(company_id) or public.user_can_manage_company(company_id)
);
drop policy if exists company_devices_insert_owner on public.company_devices;
create policy company_devices_insert_owner on public.company_devices for insert to authenticated with check (
  public.user_can_manage_company(company_id)
  and exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
);
drop policy if exists company_devices_delete_owner on public.company_devices;
create policy company_devices_delete_owner on public.company_devices for delete to authenticated using (
  public.user_can_manage_company(company_id)
);

