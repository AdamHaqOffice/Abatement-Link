-- Abatement Link future Supabase/Postgres sketch
-- This is not used by v1. It is a starting point for the real backend.

create table app_profiles (
  id uuid primary key,
  email text unique not null,
  full_name text,
  created_at timestamptz default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_profiles(id),
  serial text not null,
  name text not null,
  model text,
  validation_code text,
  verified_at timestamptz,
  created_at timestamptz default now()
);

create unique index devices_owner_serial_unique on devices(owner_id, serial);

create table device_readings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id) on delete cascade,
  serial text not null,
  job_no text,
  device_timestamp timestamptz,
  received_at timestamptz default now(),
  room int,
  sensor int,
  metric text,
  value numeric,
  upper_limit numeric,
  lower_limit numeric,
  event_text text,
  event_kind text,
  alarm_state text,
  raw_payload jsonb
);

create table alarm_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id) on delete cascade,
  reading_id uuid references device_readings(id) on delete set null,
  state text not null,
  metric text,
  room int,
  sensor int,
  value numeric,
  limit_value numeric,
  started_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_profiles(id),
  name text not null,
  created_at timestamptz default now()
);

create table company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references app_profiles(id),
  role text default 'viewer',
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create table company_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  device_id uuid references devices(id) on delete cascade,
  created_at timestamptz default now(),
  unique(company_id, device_id)
);

create table company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  email text not null,
  invited_by uuid references app_profiles(id),
  role text default 'viewer',
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id) on delete cascade,
  user_id uuid references app_profiles(id),
  rules jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id) on delete cascade,
  alarm_id uuid references alarm_events(id) on delete cascade,
  channel text,
  state text,
  recipients jsonb,
  status text,
  created_at timestamptz default now()
);
