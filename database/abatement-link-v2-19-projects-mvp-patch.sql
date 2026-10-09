-- Abatement Link v2.19 Projects MVP patch
-- Adds a generic Projects framework with ICRA / Healthcare Construction as the first project type.
-- Run after the prior Abatement Link patches.

create extension if not exists pgcrypto;

create table if not exists public.project_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into public.project_types (slug, name, description)
values (
  'icra_healthcare_construction',
  'ICRA / Healthcare Construction',
  'Time-bounded healthcare construction monitoring project record using existing Abatement Link device history.'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  project_type_id uuid references public.project_types(id) on delete set null,
  project_name text not null,
  project_number text,
  facility text,
  building text,
  floor text,
  department text,
  room_area text,
  contractor text,
  infection_prevention_contact text,
  facility_contact text,
  project_manager text,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  started_at timestamptz,
  actual_end_at timestamptz,
  containment_type text,
  notes text,
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_projects_company on public.projects(company_id);
create index if not exists idx_projects_status on public.projects(status);

create table if not exists public.project_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_type text not null,
  pressure_relationship text check (pressure_relationship in ('negative','positive','neutral') or pressure_relationship is null),
  target_value numeric,
  lower_limit numeric,
  upper_limit numeric,
  units text,
  notes text,
  effective_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_requirements_project on public.project_requirements(project_id, effective_at desc);

create table if not exists public.project_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  removed_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_assets_project on public.project_asset_assignments(project_id);
create index if not exists idx_project_assets_device on public.project_asset_assignments(device_id);
create index if not exists idx_project_assets_active on public.project_asset_assignments(project_id, device_id) where removed_at is null;

create table if not exists public.project_contacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  contact_role text,
  name text,
  email text,
  phone text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_contacts_project on public.project_contacts(project_id);

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  alarm_id uuid references public.alarm_events(id) on delete set null,
  event_type text not null default 'note',
  title text not null,
  description text,
  severity text not null default 'info',
  event_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_events_project on public.project_events(project_id, event_at desc);

create table if not exists public.project_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_id uuid references public.project_events(id) on delete set null,
  alarm_id uuid references public.alarm_events(id) on delete set null,
  cause text,
  action_taken text not null,
  responded_by text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_corrective_actions_project on public.project_corrective_actions(project_id, created_at desc);

create table if not exists public.project_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  generated_by uuid references auth.users(id) on delete set null,
  report_type text not null default 'draft',
  data_start_at timestamptz,
  data_end_at timestamptz,
  report_version text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_reports_project on public.project_reports(project_id, created_at desc);

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and (
        p.owner_id = auth.uid()
        or (
          p.company_id is not null
          and exists (
            select 1 from public.company_members cm
            where cm.company_id = p.company_id
              and cm.user_id = auth.uid()
              and cm.accepted_at is not null
          )
        )
      )
  );
$$;

create or replace function public.can_manage_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and (
        p.owner_id = auth.uid()
        or (
          p.company_id is not null
          and exists (
            select 1 from public.company_members cm
            where cm.company_id = p.company_id
              and cm.user_id = auth.uid()
              and cm.accepted_at is not null
              and cm.role in ('owner','admin')
          )
        )
      )
  );
$$;

create or replace function public.can_create_project_for_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select target_company_id is null
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = target_company_id
        and cm.user_id = auth.uid()
        and cm.accepted_at is not null
        and cm.role in ('owner','admin')
    );
$$;

alter table public.project_types enable row level security;
alter table public.projects enable row level security;
alter table public.project_requirements enable row level security;
alter table public.project_asset_assignments enable row level security;
alter table public.project_contacts enable row level security;
alter table public.project_events enable row level security;
alter table public.project_corrective_actions enable row level security;
alter table public.project_reports enable row level security;

drop policy if exists "Project types are readable" on public.project_types;
create policy "Project types are readable" on public.project_types for select to authenticated using (true);

drop policy if exists "Projects are readable by owner or company members" on public.projects;
create policy "Projects are readable by owner or company members" on public.projects for select to authenticated using (public.can_access_project(id));

drop policy if exists "Projects can be created by owner or company admins" on public.projects;
create policy "Projects can be created by owner or company admins" on public.projects for insert to authenticated with check (owner_id = auth.uid() and public.can_create_project_for_company(company_id));

drop policy if exists "Projects can be updated by owner or company admins" on public.projects;
create policy "Projects can be updated by owner or company admins" on public.projects for update to authenticated using (public.can_manage_project(id)) with check (public.can_manage_project(id));

drop policy if exists "Project requirements readable" on public.project_requirements;
create policy "Project requirements readable" on public.project_requirements for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project requirements manageable" on public.project_requirements;
create policy "Project requirements manageable" on public.project_requirements for all to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

drop policy if exists "Project assets readable" on public.project_asset_assignments;
create policy "Project assets readable" on public.project_asset_assignments for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project assets manageable" on public.project_asset_assignments;
create policy "Project assets manageable" on public.project_asset_assignments for all to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

drop policy if exists "Project contacts readable" on public.project_contacts;
create policy "Project contacts readable" on public.project_contacts for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project contacts manageable" on public.project_contacts;
create policy "Project contacts manageable" on public.project_contacts for all to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

drop policy if exists "Project events readable" on public.project_events;
create policy "Project events readable" on public.project_events for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project events insertable" on public.project_events;
create policy "Project events insertable" on public.project_events for insert to authenticated with check (public.can_access_project(project_id));
drop policy if exists "Project events updatable by managers" on public.project_events;
create policy "Project events updatable by managers" on public.project_events for update to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

drop policy if exists "Project corrective actions readable" on public.project_corrective_actions;
create policy "Project corrective actions readable" on public.project_corrective_actions for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project corrective actions insertable" on public.project_corrective_actions;
create policy "Project corrective actions insertable" on public.project_corrective_actions for insert to authenticated with check (public.can_access_project(project_id));
drop policy if exists "Project corrective actions updatable by managers" on public.project_corrective_actions;
create policy "Project corrective actions updatable by managers" on public.project_corrective_actions for update to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

drop policy if exists "Project reports readable" on public.project_reports;
create policy "Project reports readable" on public.project_reports for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "Project reports insertable" on public.project_reports;
create policy "Project reports insertable" on public.project_reports for insert to authenticated with check (public.can_access_project(project_id));
