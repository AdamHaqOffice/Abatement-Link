-- Abatement Link v2.24 equipment and scrubber/HEPA asset metadata
-- floorplan_assets.metadata stores HEPA life, runtime hours, install date, and notes.

alter table public.floorplan_assets add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists idx_floorplan_assets_type on public.floorplan_assets(asset_type);
create index if not exists idx_floorplan_assets_metadata_gin on public.floorplan_assets using gin(metadata);
