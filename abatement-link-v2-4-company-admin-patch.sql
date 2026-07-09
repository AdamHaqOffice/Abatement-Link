-- Abatement Link v2 Supabase/Postgres schema
-- Run this in Supabase SQL Editor before deploying the app.
-- This creates email-auth profiles, devices, live readings, alarm history, notifications, companies, and sharing.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email, name = coalesce(excluded.name, public.profiles.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  serial_number text not null,
  nickname text not null,
  model text not null default 'PPM4',
  validation_code text not null default lpad((floor(random() * 1000000))::text, 6, '0'),
  verified_at timestamptz,
  last_seen_at timestamptz,
  last_job_no text,
  latest_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pending_takeover boolean not null default false,
  takeover_finalized_at timestamptz
);

create index if not exists idx_devices_serial_number on public.devices(serial_number);
create index if not exists idx_devices_owner_serial on public.devices(owner_id, serial_number);

create table if not exists public.device_readings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  serial_number text not null,
  job_no text,
  device_ts timestamptz not null,
  received_at timestamptz not null default now(),
  room_no int,
  sensor_no int,
  metric text not null,
  value numeric,
  upper_limit numeric,
  lower_limit numeric,
  alarm_state text not null default 'ok' check (alarm_state in ('ok', 'high', 'low', 'alarm', 'unknown')),
  event_text text,
  raw_payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_device_readings_device_ts on public.device_readings(device_id, device_ts desc);
create index if not exists idx_device_readings_serial on public.device_readings(serial_number);

create table if not exists public.alarm_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  reading_id uuid references public.device_readings(id) on delete set null,
  alarm_state text not null check (alarm_state in ('high', 'low', 'alarm', 'ok')),
  metric text,
  room_no int,
  sensor_no int,
  value numeric,
  limit_value numeric,
  event_text text,
  started_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_alarm_events_device_started on public.alarm_events(device_id, started_at desc);
create index if not exists idx_alarm_events_open on public.alarm_events(device_id) where resolved_at is null;

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  push_high boolean not null default true,
  push_low boolean not null default true,
  push_ok boolean not null default true,
  email_high boolean not null default false,
  email_low boolean not null default false,
  email_ok boolean not null default false,
  sms_high boolean not null default false,
  sms_low boolean not null default false,
  sms_ok boolean not null default false,
  extra_emails jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id, user_id)
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  alarm_id uuid references public.alarm_events(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null check (channel in ('push', 'email', 'sms')),
  alarm_state text not null,
  recipients jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  provider_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, user_id)
);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.company_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, device_id)
);

create or replace function public.user_can_access_device(target_device_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.devices d
    where d.id = target_device_id and d.owner_id = auth.uid()
  ) or exists (
    select 1
    from public.company_devices cd
    join public.company_members cm on cm.company_id = cd.company_id
    where cd.device_id = target_device_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  );
$$;

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.device_readings enable row level security;
alter table public.alarm_events enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_logs enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.company_devices enable row level security;

-- Profiles are readable so company owners can add existing users by email.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Devices
drop policy if exists devices_select_accessible on public.devices;
create policy devices_select_accessible on public.devices for select to authenticated using (public.user_can_access_device(id));
drop policy if exists devices_insert_own on public.devices;
create policy devices_insert_own on public.devices for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists devices_update_owner on public.devices;
create policy devices_update_owner on public.devices for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists devices_delete_owner on public.devices;
create policy devices_delete_owner on public.devices for delete to authenticated using (owner_id = auth.uid());

-- Data and alarms
drop policy if exists readings_select_accessible on public.device_readings;
create policy readings_select_accessible on public.device_readings for select to authenticated using (public.user_can_access_device(device_id));
drop policy if exists alarms_select_accessible on public.alarm_events;
create policy alarms_select_accessible on public.alarm_events for select to authenticated using (public.user_can_access_device(device_id));

-- Notification rules/logs
drop policy if exists notification_rules_select on public.notification_rules;
create policy notification_rules_select on public.notification_rules for select to authenticated using (user_id = auth.uid() and public.user_can_access_device(device_id));
drop policy if exists notification_rules_insert on public.notification_rules;
create policy notification_rules_insert on public.notification_rules for insert to authenticated with check (user_id = auth.uid() and public.user_can_access_device(device_id));
drop policy if exists notification_rules_update on public.notification_rules;
create policy notification_rules_update on public.notification_rules for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.user_can_access_device(device_id));
drop policy if exists notification_rules_delete on public.notification_rules;
create policy notification_rules_delete on public.notification_rules for delete to authenticated using (user_id = auth.uid());
drop policy if exists notification_logs_select on public.notification_logs;
create policy notification_logs_select on public.notification_logs for select to authenticated using (user_id = auth.uid() or public.user_can_access_device(device_id));

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

-- Realtime publication. Ignore duplicate-table warnings if you re-run sections manually.
do $$
begin
  begin alter publication supabase_realtime add table public.devices; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.device_readings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.alarm_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.company_devices; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notification_logs; exception when duplicate_object then null; end;
end $$;

-- v2.11: browser/phone push subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user_enabled on public.push_subscriptions(user_id, enabled);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
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
