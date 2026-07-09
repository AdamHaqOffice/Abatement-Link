-- Abatement Link v2.14 device setup + pending company email access patch
-- Run this once in Supabase SQL Editor after v2.11 if your database already exists.

-- When a company admin adds an email before that person has an account, keep the pending invite.
-- As soon as that email signs up, this function converts pending invites into accepted company_members rows.
create or replace function public.claim_company_invites_for_user(target_user_id uuid, target_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_count integer := 0;
begin
  if target_user_id is null or target_email is null or length(trim(target_email)) = 0 then
    return 0;
  end if;

  with matching_invites as (
    select distinct on (company_id)
      company_id,
      lower(email) as email,
      role,
      invited_by,
      created_at
    from public.company_invites
    where lower(email) = lower(target_email)
      and accepted_at is null
    order by company_id, created_at desc
  ), inserted_members as (
    insert into public.company_members (company_id, user_id, role, invited_by, accepted_at)
    select company_id, target_user_id, role, invited_by, now()
    from matching_invites
    on conflict (company_id, user_id) do update
      set role = excluded.role,
          accepted_at = coalesce(public.company_members.accepted_at, now())
    returning company_id
  )
  update public.company_invites ci
     set accepted_at = now()
   where lower(ci.email) = lower(target_email)
     and ci.accepted_at is null
     and ci.company_id in (select company_id from inserted_members);

  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$;

create or replace function public.claim_my_company_invites()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.claim_company_invites_for_user(
    auth.uid(),
    (select lower(email) from auth.users where id = auth.uid())
  );
$$;

-- Update the new-user trigger so future signups are auto-connected to pending company email access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(excluded.name, public.profiles.name);

  perform public.claim_company_invites_for_user(new.id, new.email);
  return new;
end;
$$;

-- Make sure admins can view/manage pending email access and the invited email can see its own invite.
drop policy if exists company_invites_select_owner on public.company_invites;
create policy company_invites_select_owner on public.company_invites
for select to authenticated
using (
  email = (select lower(email) from auth.users where id = auth.uid())
  or public.user_can_manage_company(company_id)
);

drop policy if exists company_invites_insert_owner on public.company_invites;
create policy company_invites_insert_owner on public.company_invites
for insert to authenticated
with check (public.user_can_manage_company(company_id));

drop policy if exists company_invites_update_admin on public.company_invites;
create policy company_invites_update_admin on public.company_invites
for update to authenticated
using (
  public.user_can_manage_company(company_id)
  or email = (select lower(email) from auth.users where id = auth.uid())
)
with check (
  public.user_can_manage_company(company_id)
  or email = (select lower(email) from auth.users where id = auth.uid())
);

drop policy if exists company_invites_delete_admin on public.company_invites;
create policy company_invites_delete_admin on public.company_invites
for delete to authenticated
using (public.user_can_manage_company(company_id));

do $$
begin
  begin alter publication supabase_realtime add table public.company_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.company_invites; exception when duplicate_object then null; end;
end $$;
