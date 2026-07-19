-- Remove the ten SPC interpretations created during the 2026-07-19 12Z
-- alias rotation. The source rows were already present with the correct
-- convective-day identity; these UUIDs are the one-day-shifted copies.
with removed as (
  delete from public.storm_events
  where id in (
  '088e9018-509d-41bd-9da6-9e4e08f98ce6',
  '20dd3708-484f-4068-a4fd-afee212556ef',
  'cb0a7927-49fc-440e-ad50-94a4e094667e',
  '835f7ace-e5d4-4a19-a928-db35fcb0bf3b',
  'f9e8d8ef-c03b-4633-a453-46a2f51254df',
  '56527af2-fda2-4c04-a2be-ab23a10d137e',
  '8e259a7b-37b7-4078-a7c1-92559c1e682d',
  '51def47f-52d5-4a3f-9b55-f71572cab998',
  'ddc54760-baa6-488f-88c9-c82d8367bf1e',
    'b7c9a116-f03c-475c-bb7f-15f4cd5008cf'
  )
  returning raw_record_id
)
delete from public.source_records r
using removed
where r.id = removed.raw_record_id
  and not exists (select 1 from public.storm_events e where e.raw_record_id = r.id);
