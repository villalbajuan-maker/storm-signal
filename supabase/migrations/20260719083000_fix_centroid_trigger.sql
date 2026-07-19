-- Avoid ambiguous PostGIS equality operators during upserts. This trigger only
-- runs when geometry is inserted or explicitly updated, so recomputing is safe.
create or replace function public.set_storm_event_centroid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.geometry is null then
        new.centroid = null;
    else
        new.centroid = extensions.st_pointonsurface(new.geometry)::extensions.geometry(Point, 4326);
    end if;
    return new;
end;
$$;

