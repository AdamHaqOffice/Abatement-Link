-- Abatement Link v2.20 firmware payload/RLS patch
-- Run after previous schema/patches. This fixes company invite policies that could
-- raise: permission denied for table users.

create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = auth, public
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
  limit 1
$$;

revoke all on function public.current_user_email() from public;
grant execute on function public.current_user_email() to authenticated;

drop policy if exists company_invites_select_owner on public.company_invites;
create policy company_invites_select_owner
on public.company_invites
for select
to authenticated
using (
  lower(email) = public.current_user_email()
  or public.user_can_manage_company(company_id)
);

drop policy if exists company_invites_update_admin on public.company_invites;
create policy company_invites_update_admin
on public.company_invites
for update
to authenticated
using (
  public.user_can_manage_company(company_id)
  or lower(email) = public.current_user_email()
)
with check (
  public.user_can_manage_company(company_id)
  or lower(email) = public.current_user_email()
);

create or replace function public.claim_my_company_invites()
returns integer
language sql
security definer
set search_path = public, auth
as $$
  select public.claim_company_invites_for_user(
    auth.uid(),
    public.current_user_email()
  );
$$;

grant execute on function public.claim_my_company_invites() to authenticated;
