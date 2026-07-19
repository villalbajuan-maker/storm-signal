-- Storm Signal POC: durable provenance, normalized events, and ingestion health.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table public.source_records (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('nws_alerts', 'spc_reports', 'noaa_storm_events')),
    source_record_id text not null,
    retrieved_at timestamptz not null,
    payload_json jsonb not null,
    payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
    source_url text not null,
    created_at timestamptz not null default now(),
    unique (source, source_record_id, payload_hash)
);

comment on table public.source_records is
    'Immutable source payload versions retained for provenance and reprocessing.';

create index source_records_identity_idx
    on public.source_records (source, source_record_id, retrieved_at desc);

create table public.storm_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (event_type in (
        'hail_report',
        'severe_thunderstorm_warning',
        'tornado_warning',
        'wind_report',
        'tornado_report',
        'historical_hail_event'
    )),
    status text,
    started_at timestamptz not null,
    ended_at timestamptz,
    magnitude numeric,
    magnitude_unit text,
    severity text,
    urgency text,
    certainty text,
    geometry extensions.geometry(Geometry, 4326),
    centroid extensions.geometry(Point, 4326),
    state text,
    county text,
    source text not null check (source in ('nws_alerts', 'spc_reports', 'noaa_storm_events')),
    source_record_id text not null,
    source_url text not null,
    raw_record_id uuid references public.source_records(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ended_at is null or ended_at >= started_at),
    unique (source, source_record_id)
);

comment on table public.storm_events is
    'Current normalized interpretation of each source event; raw versions remain in source_records.';

create index storm_events_geometry_gix
    on public.storm_events using gist (geometry);
create index storm_events_centroid_gix
    on public.storm_events using gist (centroid);
create index storm_events_time_type_idx
    on public.storm_events (started_at desc, event_type);
create index storm_events_state_time_idx
    on public.storm_events (state, started_at desc);

create table public.ingestion_runs (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('nws_alerts', 'spc_reports', 'noaa_storm_events')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    status text not null check (status in ('running', 'complete', 'partial', 'failed')),
    records_received integer not null default 0 check (records_received >= 0),
    records_created integer not null default 0 check (records_created >= 0),
    records_updated integer not null default 0 check (records_updated >= 0),
    error_message text,
    check (completed_at is null or completed_at >= started_at)
);

create index ingestion_runs_source_started_idx
    on public.ingestion_runs (source, started_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger storm_events_set_updated_at
before update on public.storm_events
for each row execute function public.set_updated_at();

-- The POC is backend-only. No rows are exposed through Supabase's public API.
alter table public.source_records enable row level security;
alter table public.storm_events enable row level security;
alter table public.ingestion_runs enable row level security;

revoke all on table public.source_records from anon, authenticated;
revoke all on table public.storm_events from anon, authenticated;
revoke all on table public.ingestion_runs from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

