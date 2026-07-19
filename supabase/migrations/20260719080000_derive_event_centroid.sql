-- Keep a queryable representative point for every geometry.
create function public.set_storm_event_centroid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.geometry is null then
        new.centroid = null;
    elsif tg_op = 'INSERT' or new.centroid is null or new.geometry is distinct from old.geometry then
        new.centroid = extensions.st_pointonsurface(new.geometry)::extensions.geometry(Point, 4326);
    end if;
    return new;
end;
$$;

create trigger storm_events_set_centroid
before insert or update of geometry on public.storm_events
for each row execute function public.set_storm_event_centroid();

revoke execute on function public.set_storm_event_centroid() from public, anon, authenticated;
