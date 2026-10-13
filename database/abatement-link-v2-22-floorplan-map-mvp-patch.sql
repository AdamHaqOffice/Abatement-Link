-- Abatement Link v2.22 floorplan map MVP polish
-- v2.21 created the floorplan tables. This patch keeps older/fresh databases aligned.

alter table public.floorplans add column if not exists layout_json jsonb not null default '{"walls":[],"zones":[],"labels":[],"arrows":[]}'::jsonb;
alter table public.floorplan_assets add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists idx_floorplan_assets_type on public.floorplan_assets(asset_type);
