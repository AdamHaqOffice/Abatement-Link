-- Abatement Link v2.23 area/sub-view dashboards
-- Adds areas such as Left Hospital Wing under a company or project, plus device assignment to those areas.

create extension if not exists pgcrypto;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_areas_company on public.areas(company_id);
create index if not exists idx_areas_project on public.areas(project_id);
create index if not exists idx_areas_created_by on public.areas(created_by);

create table if not exists public.area_devices (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(area_id, device_id)
);

create index if not exists idx_area_devices_area on public.area_devices(area_id);
create index if not exists idx_area_devices_device on public.area_devices(device_id);

alter table public.floorplans add column if not exists area_id uuid references public.areas(id) on delete cascade;
create index if not exists idx_floorplans_area on public.floorplans(area_id);

create or replace function public.can_access_area(target_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.areas a
    left join public.companies c on c.id = a.company_id
    where a.id = target_area_id
      and (
        a.created_by = auth.uid()
        or (a.company_id is not null and (c.created_by = auth.uid() or public.is_company_member(a.company_id)))
        or (a.project_id is not null and public.can_access_project(a.project_id))
      )
  );
$$;

create or replace function public.can_manage_area(target_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.areas a
    where a.id = target_area_id
      and (
        a.created_by = auth.uid()
        or (a.company_id is not null and public.user_can_manage_company(a.company_id))
        or (a.project_id is not null and public.can_manage_project(a.project_id))
      )
  );
$$;

alter table public.areas enable row level security;
alter table public.area_devices enable row level security;

drop policy if exists areas_select_accessible on public.areas;
create policy areas_select_accessible on public.areas for select to authenticated using (public.can_access_area(id));

drop policy if exists areas_insert_manage_scope on public.areas;
create policy areas_insert_manage_scope on public.areas for insert to authenticated with check (
  created_by = auth.uid()
  and (company_id is null or public.user_can_manage_company(company_id))
  and (project_id is null or public.can_manage_project(project_id))
);

drop policy if exists areas_update_manage on public.areas;
create policy areas_update_manage on public.areas for update to authenticated using (public.can_manage_area(id)) with check (public.can_manage_area(id));

drop policy if exists areas_delete_manage on public.areas;
create policy areas_delete_manage on public.areas for delete to authenticated using (public.can_manage_area(id));

drop policy if exists area_devices_select_accessible on public.area_devices;
create policy area_devices_select_accessible on public.area_devices for select to authenticated using (public.can_access_area(area_id));

drop policy if exists area_devices_insert_manage on public.area_devices;
create policy area_devices_insert_manage on public.area_devices for insert to authenticated with check (
  public.can_manage_area(area_id)
  and public.user_can_access_device(device_id)
);

drop policy if exists area_devices_delete_manage on public.area_devices;
create policy area_devices_delete_manage on public.area_devices for delete to authenticated using (public.can_manage_area(area_id));

-- Extend floorplan policies so area maps are managed by area managers.
create or replace function public.can_access_floorplan(target_floorplan_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.floorplans f
    left join public.companies c on c.id = f.company_id
    where f.id = target_floorplan_id
      and (
        f.created_by = auth.uid()
        or (f.area_id is not null and public.can_access_area(f.area_id))
        or (f.project_id is not null and public.can_access_project(f.project_id))
        or (f.company_id is not null and (c.created_by = auth.uid() or public.is_company_member(f.company_id)))
      )
  );
$$;

create or replace function public.can_manage_floorplan(target_floorplan_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.floorplans f
    where f.id = target_floorplan_id
      and (
        f.created_by = auth.uid()
        or (f.area_id is not null and public.can_manage_area(f.area_id))
        or (f.project_id is not null and public.can_manage_project(f.project_id))
        or (f.company_id is not null and public.user_can_manage_company(f.company_id))
      )
  );
$$;
