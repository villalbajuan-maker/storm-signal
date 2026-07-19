-- Reference copy of the POC schema. The deployable source of truth is:
-- supabase/migrations/20260719073000_create_storm_signal_core.sql
-- PostgreSQL 17 with PostGIS.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE source_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL CHECK (source IN ('nws_alerts', 'spc_reports', 'noaa_storm_events')),
    source_record_id text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    payload_json jsonb NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    source_url text NOT NULL,
    UNIQUE (source, source_record_id, payload_hash)
);

CREATE TABLE storm_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    status text,
    started_at timestamptz NOT NULL,
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
    source text NOT NULL,
    source_record_id text NOT NULL,
    source_url text NOT NULL,
    raw_record_id uuid REFERENCES source_records(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_record_id)
);

CREATE INDEX storm_events_geometry_gix ON storm_events USING gist (geometry);
CREATE INDEX storm_events_centroid_gix ON storm_events USING gist (centroid);
CREATE INDEX storm_events_time_type_idx ON storm_events (started_at DESC, event_type);

CREATE TABLE ingestion_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    status text NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
    records_received integer NOT NULL DEFAULT 0,
    records_created integer NOT NULL DEFAULT 0,
    records_updated integer NOT NULL DEFAULT 0,
    error_message text
);
