-- Frozen NHC contract: versioned tropical cyclones, advisories, forecast features,
-- and derived Census/PostGIS associations. This migration does not schedule ingestion.

alter table public.source_records
  drop constraint if exists source_records_source_check;
alter table public.source_records
  add constraint source_records_source_check
  check (source in ('nws_alerts', 'spc_reports', 'noaa_storm_events', 'nhc_gis'));

alter table public.ingestion_runs
  drop constraint if exists ingestion_runs_source_check;
alter table public.ingestion_runs
  add constraint ingestion_runs_source_check
  check (source in ('nws_alerts', 'spc_reports', 'noaa_storm_events', 'nhc_gis'));

create table public.tropical_cyclones (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'nhc' check (source = 'nhc'),
  atcf_id text not null unique check (atcf_id ~ '^[A-Z]{2}[0-9]{2}[0-9]{4}$'),
  basin text not null check (basin ~ '^[A-Z]{2}$'),
  cyclone_number text not null check (cyclone_number ~ '^[0-9]{2}$'),
  season_year integer not null check (season_year between 1900 and 2200),
  current_name text,
  current_classification text,
  first_advisory_at timestamptz,
  last_advisory_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (atcf_id = basin || cyclone_number || season_year::text),
  check (last_advisory_at is null or first_advisory_at is null or last_advisory_at >= first_advisory_at)
);

comment on table public.tropical_cyclones is
  'Stable NHC cyclone identities keyed by ATCF ID; names and classifications remain mutable attributes.';

create table public.cyclone_advisories (
  id uuid primary key default gen_random_uuid(),
  cyclone_id uuid not null references public.tropical_cyclones(id) on delete cascade,
  advisory_label text not null check (btrim(advisory_label) <> ''),
  advisory_number numeric check (advisory_number is null or advisory_number >= 0),
  advisory_kind text not null check (advisory_kind in ('full', 'intermediate', 'special', 'unknown')),
  issued_at timestamptz not null,
  status text not null default 'issued' check (status in ('issued', 'superseded', 'corrected')),
  classification text,
  storm_name text,
  center extensions.geometry(Point, 4326),
  maximum_wind_kt integer check (maximum_wind_kt is null or maximum_wind_kt >= 0),
  minimum_pressure_mb integer check (minimum_pressure_mb is null or minimum_pressure_mb between 800 and 1100),
  movement_direction_degrees integer check (
    movement_direction_degrees is null or movement_direction_degrees between 0 and 360
  ),
  movement_speed_kt numeric check (movement_speed_kt is null or movement_speed_kt >= 0),
  headline text,
  source_record_id uuid not null references public.source_records(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cyclone_id, advisory_label, advisory_kind, issued_at),
  check (center is null or not extensions.st_isempty(center)),
  check (center is null or extensions.st_isvalid(center))
);

comment on table public.cyclone_advisories is
  'Immutable-in-history NHC advisory packages; supersession is explicit and does not delete earlier advisories.';

create table public.cyclone_features (
  id uuid primary key default gen_random_uuid(),
  advisory_id uuid not null references public.cyclone_advisories(id) on delete cascade,
  product_type text not null check (product_type in (
    'analysis_center',
    'forecast_track_point',
    'forecast_track_line',
    'operational_cone',
    'experimental_cone',
    'watch_warning',
    'wind_radius',
    'wind_probability',
    'arrival_time',
    'storm_surge_watch_warning',
    'storm_surge_probability',
    'storm_surge_inundation'
  )),
  evidence_class text not null check (evidence_class in (
    'analysis',
    'forecast',
    'uncertainty',
    'watch_warning',
    'probability',
    'preliminary_observation',
    'final_historical'
  )),
  product_status text not null default 'operational'
    check (product_status in ('operational', 'experimental')),
  source_feature_id text not null check (btrim(source_feature_id) <> ''),
  source_revision integer not null default 1 check (source_revision > 0),
  is_current boolean not null default true,
  superseded_at timestamptz,
  forecast_hour integer check (forecast_hour is null or forecast_hour >= 0),
  valid_at timestamptz,
  threshold_kt integer check (threshold_kt is null or threshold_kt in (34, 50, 64)),
  probability_percent numeric check (
    probability_percent is null or probability_percent between 0 and 100
  ),
  watch_warning_type text,
  geometry extensions.geometry(Geometry, 4326) not null,
  source_record_id uuid not null references public.source_records(id),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  geographic_status text not null default 'not_processed'
    check (geographic_status in ('not_processed', 'complete', 'partial', 'failed')),
  geographic_processed_at timestamptz,
  geographic_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not extensions.st_isempty(geometry)),
  check (extensions.st_isvalid(geometry)),
  check (product_type <> 'experimental_cone' or product_status = 'experimental'),
  check (product_type <> 'wind_radius' or threshold_kt is not null),
  check (product_type <> 'wind_probability' or (threshold_kt is not null and probability_percent is not null)),
  check (is_current or superseded_at is not null)
);

comment on table public.cyclone_features is
  'Typed NHC geometries whose analysis, forecast, uncertainty, warning, and probability semantics remain distinct.';
comment on column public.cyclone_features.geographic_status is
  'Processing status for derived Census/PostGIS associations; offshore features may complete with zero associations.';

create table public.cyclone_feature_areas (
  cyclone_feature_id uuid not null references public.cyclone_features(id) on delete cascade,
  geographic_area_id uuid not null references public.geographic_areas(id) on delete cascade,
  relation text not null check (relation = 'intersects_geometry'),
  intersection_ratio numeric check (intersection_ratio is null or intersection_ratio between 0 and 1),
  derived_at timestamptz not null default now(),
  method_version text not null,
  primary key (cyclone_feature_id, geographic_area_id, relation, method_version)
);

comment on table public.cyclone_feature_areas is
  'Derived NHC-feature intersections with Census areas; overlap is not impact, probability, or damage.';

create index tropical_cyclones_active_idx
  on public.tropical_cyclones (active, last_advisory_at desc);
create index tropical_cyclones_basin_season_idx
  on public.tropical_cyclones (basin, season_year desc, cyclone_number);

create index cyclone_advisories_cyclone_issued_idx
  on public.cyclone_advisories (cyclone_id, issued_at desc);
create index cyclone_advisories_issued_idx
  on public.cyclone_advisories (issued_at desc);
create index cyclone_advisories_center_gix
  on public.cyclone_advisories using gist (center);

create index cyclone_features_advisory_idx
  on public.cyclone_features (advisory_id, product_type, valid_at);
create index cyclone_features_valid_idx
  on public.cyclone_features (valid_at, evidence_class, threshold_kt);
create index cyclone_features_geographic_queue_idx
  on public.cyclone_features (geographic_status, created_at)
  where geographic_status in ('not_processed', 'failed');
create index cyclone_features_geometry_gix
  on public.cyclone_features using gist (geometry);

create unique index cyclone_features_revision_identity_idx
  on public.cyclone_features (
    advisory_id,
    product_type,
    source_feature_id,
    coalesce(valid_at, '-infinity'::timestamptz),
    coalesce(threshold_kt, -1),
    product_status,
    source_revision
  );

create unique index cyclone_features_one_current_identity_idx
  on public.cyclone_features (
    advisory_id,
    product_type,
    source_feature_id,
    coalesce(valid_at, '-infinity'::timestamptz),
    coalesce(threshold_kt, -1),
    product_status
  ) where is_current;

create index cyclone_feature_areas_area_idx
  on public.cyclone_feature_areas (geographic_area_id, cyclone_feature_id);

create trigger tropical_cyclones_set_updated_at
before update on public.tropical_cyclones
for each row execute function public.set_updated_at();

create trigger cyclone_advisories_set_updated_at
before update on public.cyclone_advisories
for each row execute function public.set_updated_at();

create trigger cyclone_features_set_updated_at
before update on public.cyclone_features
for each row execute function public.set_updated_at();

alter table public.tropical_cyclones enable row level security;
alter table public.cyclone_advisories enable row level security;
alter table public.cyclone_features enable row level security;
alter table public.cyclone_feature_areas enable row level security;

revoke all on table public.tropical_cyclones, public.cyclone_advisories,
  public.cyclone_features, public.cyclone_feature_areas from public, anon, authenticated;

grant select, insert, update, delete on table public.tropical_cyclones,
  public.cyclone_advisories, public.cyclone_features, public.cyclone_feature_areas to service_role;
