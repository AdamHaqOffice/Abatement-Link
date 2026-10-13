-- Abatement Link v2.25 drawing tools
-- Drawing data is stored in floorplans.layout_json: walls, zones, labels, and arrows.

alter table public.floorplans add column if not exists layout_json jsonb not null default '{"walls":[],"zones":[],"labels":[],"arrows":[]}'::jsonb;
update public.floorplans
set layout_json = coalesce(layout_json, '{}'::jsonb) || jsonb_build_object(
  'walls', coalesce(layout_json->'walls', '[]'::jsonb),
  'zones', coalesce(layout_json->'zones', '[]'::jsonb),
  'labels', coalesce(layout_json->'labels', '[]'::jsonb),
  'arrows', coalesce(layout_json->'arrows', '[]'::jsonb)
)
where layout_json is null
   or not (layout_json ? 'zones')
   or not (layout_json ? 'labels')
   or not (layout_json ? 'arrows');
