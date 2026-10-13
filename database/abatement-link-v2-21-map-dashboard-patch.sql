-- Abatement Link v2.21 map dashboard / floorplan MVP
-- Adds company/project-scoped floorplans and draggable map assets.

create extension if not exists pgcrypto;

create table if not exists public.floorplans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  image_data_url text,
  layout_json jsonb not null default '{"walls":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_floorplans_company on public.floorplans(company_id);
create index if not exists idx_floorplans_project on public.floorplans(project_id);
create index if not exists idx_floorplans_created_by on public.floorplans(created_by);

create table if not exists public.floorplan_assets (
  id uuid primary key default gen_random_uuid(),
  floorplan_id uuid not null references public.floorplans(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  asset_type text not null default 'monitor',
  label text,
  x numeric not null default 50,
  y numeric not null default 50,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_floorplan_assets_floorplan on public.floorplan_assets(floorplan_id);
create index if not exists idx_floorplan_assets_device on public.floorplan_assets(device_id);

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
        or (f.project_id is not null and public.can_manage_project(f.project_id))
        or (f.company_id is not null and public.user_can_manage_company(f.company_id))
      )
  );
$$;

alter table public.floorplans enable row level security;
alter table public.floorplan_assets enable row level security;

drop policy if exists floorplans_select_accessible on public.floorplans;
create policy floorplans_select_accessible
on public.floorplans
for select
to authenticated
using (public.can_access_floorplan(id));

drop policy if exists floorplans_insert_manage_scope on public.floorplans;
create policy floorplans_insert_manage_scope
on public.floorplans
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (company_id is null or public.user_can_manage_company(company_id))
  and (project_id is null or public.can_manage_project(project_id))
);

drop policy if exists floorplans_update_manage on public.floorplans;
create policy floorplans_update_manage
on public.floorplans
for update
to authenticated
using (public.can_manage_floorplan(id))
with check (public.can_manage_floorplan(id));

drop policy if exists floorplans_delete_manage on public.floorplans;
create policy floorplans_delete_manage
on public.floorplans
for delete
to authenticated
using (public.can_manage_floorplan(id));

drop policy if exists floorplan_assets_select_accessible on public.floorplan_assets;
create policy floorplan_assets_select_accessible
on public.floorplan_assets
for select
to authenticated
using (public.can_access_floorplan(floorplan_id));

drop policy if exists floorplan_assets_insert_manage on public.floorplan_assets;
create policy floorplan_assets_insert_manage
on public.floorplan_assets
for insert
to authenticated
with check (
  public.can_manage_floorplan(floorplan_id)
  and (device_id is null or public.user_can_access_device(device_id))
);

drop policy if exists floorplan_assets_update_manage on public.floorplan_assets;
create policy floorplan_assets_update_manage
on public.floorplan_assets
for update
to authenticated
using (public.can_manage_floorplan(floorplan_id))
with check (
  public.can_manage_floorplan(floorplan_id)
  and (device_id is null or public.user_can_access_device(device_id))
);

drop policy if exists floorplan_assets_delete_manage on public.floorplan_assets;
create policy floorplan_assets_delete_manage
on public.floorplan_assets
for delete
to authenticated
using (public.can_manage_floorplan(floorplan_id));
