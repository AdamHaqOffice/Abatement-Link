-- Abatement Link v2.26 map-first RLS fix
-- Fixes 403 errors when authenticated users create floorplans/maps.
-- Also keeps map ownership simple: if you created the map, you can edit it.

create extension if not exists pgcrypto;

alter table public.floorplans
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists area_id uuid references public.areas(id) on delete cascade,
  add column if not exists name text not null default 'Live map',
  add column if not exists image_data_url text,
  add column if not exists layout_json jsonb not null default '{"walls":[],"zones":[],"labels":[],"arrows":[]}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.floorplan_assets
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.can_access_floorplan(target_floorplan_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.floorplans f
    left join public.companies c on c.id = f.company_id
    where f.id = target_floorplan_id
      and (
        f.created_by = auth.uid()
        or (f.area_id is not null and to_regclass('public.areas') is not null and public.can_access_area(f.area_id))
        or (f.project_id is not null and public.can_access_project(f.project_id))
        or (
          f.company_id is not null
          and (
            c.created_by = auth.uid()
            or public.is_company_member(f.company_id)
          )
        )
      )
  );
end;
$$;

create or replace function public.can_manage_floorplan(target_floorplan_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.floorplans f
    where f.id = target_floorplan_id
      and (
        f.created_by = auth.uid()
        or (f.area_id is not null and to_regclass('public.areas') is not null and public.can_manage_area(f.area_id))
        or (f.project_id is not null and public.can_manage_project(f.project_id))
        or (f.company_id is not null and public.user_can_manage_company(f.company_id))
      )
  );
end;
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
drop policy if exists floorplans_insert_own on public.floorplans;
create policy floorplans_insert_own
on public.floorplans
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists floorplans_update_manage on public.floorplans;
drop policy if exists floorplans_update_own on public.floorplans;
create policy floorplans_update_own
on public.floorplans
for update
to authenticated
using (public.can_manage_floorplan(id))
with check (created_by = auth.uid() or public.can_manage_floorplan(id));

drop policy if exists floorplans_delete_manage on public.floorplans;
drop policy if exists floorplans_delete_own on public.floorplans;
create policy floorplans_delete_own
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
drop policy if exists floorplan_assets_insert_own_map on public.floorplan_assets;
create policy floorplan_assets_insert_own_map
on public.floorplan_assets
for insert
to authenticated
with check (
  public.can_manage_floorplan(floorplan_id)
  and (device_id is null or public.user_can_access_device(device_id))
);

drop policy if exists floorplan_assets_update_manage on public.floorplan_assets;
drop policy if exists floorplan_assets_update_own_map on public.floorplan_assets;
create policy floorplan_assets_update_own_map
on public.floorplan_assets
for update
to authenticated
using (public.can_manage_floorplan(floorplan_id))
with check (
  public.can_manage_floorplan(floorplan_id)
  and (device_id is null or public.user_can_access_device(device_id))
);

drop policy if exists floorplan_assets_delete_manage on public.floorplan_assets;
drop policy if exists floorplan_assets_delete_own_map on public.floorplan_assets;
create policy floorplan_assets_delete_own_map
on public.floorplan_assets
for delete
to authenticated
using (public.can_manage_floorplan(floorplan_id));
