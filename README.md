# Storm Signal

This proof of concept ingests, normalizes, persists, and serves evidence from three authoritative severe-weather sources. It preserves raw provenance and hashes while maintaining a queryable PostGIS interpretation of each event.

It also includes a remote MCP server that exposes persisted evidence and deterministic decision support through eight read-only tools: `search_storm_events`, `get_storm_event`, `assess_location`, `summarize_storm_activity`, `search_tropical_cyclones`, `rank_markets`, `build_field_plan`, and `prepare_field_brief`.

Product promise, frozen commercial outcomes, delivery order, and Gulf Coast expansion are governed by [the product and commercial roadmap](docs/product-commercial-roadmap.md).

## Run it

Requires Python 3.11+ and outbound HTTPS access; there are no runtime dependencies.

```bash
PYTHONPATH=src python -m storm_signal_recon.cli
```

Optional controls:

```bash
PYTHONPATH=src python -m storm_signal_recon.cli \
  --year 2025 --states TEXAS,OKLAHOMA --historical-limit 100
```

Each timestamped directory under `data/runs/` contains raw JSON/CSV, one `*.fields.json` inventory per successful source, and a `manifest.json` with retrieval URLs, timestamps, record counts, SHA-256 hashes, and errors. A source failure produces a partial run without discarding successful evidence.

Run the offline test suite with:

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```

## Persist into Supabase

Apply the migrations, then provide backend-only credentials through the environment:

```bash
supabase link --project-ref efzezjfvhkywxukluowh
supabase db push
SUPABASE_URL=https://efzezjfvhkywxukluowh.supabase.co \
SUPABASE_SECRET_KEY=sb_secret_... \
PYTHONPATH=src python -m storm_signal_recon.ingest --source all
```

Never commit the secret key. The ingestor uses it only from the process environment and sends modern `sb_secret_...` credentials solely in the `apikey` header. Legacy `SUPABASE_SERVICE_ROLE_KEY` remains a temporary fallback. Every source collection creates an `ingestion_runs` row, versions raw records by canonical payload hash, and upserts the current normalized event by source identity.

Live ingestion is scheduled inside Supabase with `pg_cron` and `pg_net`: NWS runs every 5 minutes and SPC runs every 10 minutes. The migration stores the project URL in Vault and expects an encrypted Vault secret named `storm_signal_cron_secret`; the same value must be configured as the `INGEST_CRON_SECRET` Edge Function secret. Requests without the matching `x-storm-signal-cron` header are rejected. Deploy the function with:

```bash
supabase functions deploy storm_signal_ingestor --no-verify-jwt
supabase db push
```

The Edge Function accepts only `POST` requests with `{"source":"nws"}` or `{"source":"spc"}`. It records every attempt in `ingestion_runs`, versions raw source evidence, and idempotently updates normalized events. Check recent automation health with:

```sql
select source, status, started_at, completed_at,
       records_received, records_created, records_updated, error_message,
       geographic_status, geographic_events_processed,
       geographic_associations, geographic_error_message
from public.ingestion_runs
order by started_at desc
limit 20;
```

Every live NWS/SPC upsert now sends the exact created or updated event IDs through the versioned Census/PostGIS enrichment phase. Weather ingestion and derived geography have independent outcomes: a geographic failure is recorded in the same run without discarding successfully persisted source evidence.

Every MCP tool response also includes `data_health`: national source freshness and ingestion outcomes, plus commercial event and geographic coverage for Texas, Florida, Louisiana, Georgia, and North Carolina over the latest 14 days. It also exposes Census vintage, method version, processing counts, queue health, and actionable alerts. This prevents an empty result from being presented as proof that no severe weather occurred when a source is stale, outside the controlled territory, or still awaiting geographic processing. Audited territorial counts are persisted in `geographic_coverage_summary` so MCP calls do not recalculate thousands of polygon intersections.

`search_tropical_cyclones` exposes versioned NHC Atlantic advisories as a separate forecast domain. It searches analyzed centers, forecast track points, operational cones, coastal watches/warnings, and 34/50/64-kt wind fields only when their derived Census geography intersects the five-state controlled demo. `data_health.nhc` reports poll freshness, active systems, latest advisories, received product types, and geographic-processing gaps even when no NHC feature currently intersects the demo territory.

Supabase `pg_cron` is the sole operational ingestion scheduler: NWS runs every 5 minutes, SPC every 10 minutes, and NHC every 5 minutes. `.github/workflows/ingest.yml` has no schedule and is retained only for explicitly dispatched NWS/SPC recovery. The obsolete weekly Texas/Oklahoma historical import was removed. Manual recovery requires repository secrets named `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

## Run the MCP server

Apply the latest migration and start the Streamable HTTP server with backend-only credentials:

```bash
supabase db push
SUPABASE_URL=https://efzezjfvhkywxukluowh.supabase.co \
SUPABASE_SECRET_KEY=sb_secret_... \
storm-mcp
```

The endpoints are `POST /mcp` for JSON-RPC and `GET /health` for infrastructure health. `GET /mcp` deliberately returns 405 because this implementation does not open an SSE stream. The initialize response returns `Mcp-Session-Id`; CORS exposes that header for Claude's connector. Set `MCP_ALLOWED_ORIGINS` to a comma-separated production allowlist when the deployment's expected browser origins are known.

The canonical customer-facing MCP URL is `https://mcp.vectoros.co/mcp`. A minimal Cloudflare Worker in `cloudflare/storm-signal-mcp-gateway.js` proxies `/mcp` and `/health` to the Supabase Edge Function without storing credentials or changing MCP response headers. The native Supabase URL remains available as the backend and operational fallback.

The MCP initialization metadata advertises the Storm Signal logo through `serverInfo.icons`. Cloudflare serves the same PNG at `/favicon.png` and `/favicon.ico`, keeping the icon on the same origin as required by cautious MCP clients.

The server is stateless even though it issues session identifiers, so Cloud Run can safely use more than one instance. Each tool response includes a trace identifier, structured evidence, and explicit limitations. The versioned location score is deterministic across hail, wind, tornado, warnings, recency, proximity and source health; it keeps NHC forecasts outside the score and never claims that a property was hit or damaged.

`rank_markets` compares two to five explicitly located candidates using 70 points of multihazard evidence support, 20 points of straight-line operating-base proximity, 10 points of geographic readiness, and disclosed missing-input penalties. Its outputs are investigation priorities—`prioritize`, `monitor`, or `insufficient_evidence`—not leads or confirmed opportunities.

`build_field_plan` turns eligible ranked markets into an explicit crew-capacity preview: ranked sequence, round-robin assignments, working-window fit, verification questions, and continue/change/stop conditions. It does not claim route optimization, travel time, permission, or available work.

`prepare_field_brief` produces an auditable structured preview plus Markdown and priority-area CSV. The public MCP deliberately reports PDF, tenant persistence, and revocable sharing as unavailable until an authenticated artifact layer exists.

`search_storm_events` accepts the persisted source fields plus derived Census/PostGIS filters: `county` matches either the source county or the derived county (with or without the `County`/`Parish` suffix), `place` matches the official Census place name, and `zcta` matches a five-digit Census ZCTA. Search results include their derived states, counties, places, ZCTAs, Census vintage, and method version. ZCTAs are approximate ZIP areas, not USPS delivery boundaries.

Build locally with:

```bash
docker build -t storm-signal-mcp .
docker run --rm -p 8080:8080 \
  -e SUPABASE_URL -e SUPABASE_SECRET_KEY storm-signal-mcp
```

## What each source actually contributes

| Source | Payload | Useful identifiers and fields | Recommended collection | Important limitation |
|---|---|---|---|---|
| NWS active alerts | GeoJSON FeatureCollection | top-level feature `id`; `properties.id`, `sent`, `effective`, `onset`, `expires`, `status`, `messageType`, `event`, `severity`, `certainty`, `urgency`, `areaDesc`, `geocode`, `parameters`; feature `geometry` | Every 5 minutes (comfortably above NWS's published 30-second request floor) | Active endpoint is not a durable history. Geometry may be null; affected zones then carry location evidence. A warning is not proof of hail at a property. |
| SPC preliminary storm reports | Hail, wind, and tornado CSVs for today and yesterday | Common location/time fields plus hail `Size` (hundredths of an inch), wind `Speed` (mph or `UNK`), and tornado `F_Scale` (often `UNK`) | Every 10 minutes; use the convective-cycle date published by SPC and refetch both days because reports are preliminary | No official stable row ID. Report points are not complete storm footprints; unknown speed/scale must not be inferred. |
| NCEI Storm Events details | annual gzip-compressed CSV | `EVENT_ID` (record key), `EPISODE_ID`, date/time and timezone fields, `EVENT_TYPE`, `MAGNITUDE`, state/county, damage fields, narratives, source, begin/end coordinates | Import selected annual files; periodically check revision filename | Official historical evidence is delayed and revised. Coordinates can be absent or approximate; damage strings need parsing; local timestamps require `CZ_TIMEZONE` interpretation. |

Source identifiers should be used as follows:

- NWS: upsert the current normalized event by alert `properties.id`; retain each distinct payload hash in `source_records` to preserve updates, cancellations, and corrections. Do not use `references` as the alert's own identity.
- SPC: construct a provisional fingerprint from report date + type + time + rounded coordinates + size, while retaining the entire raw daily file and allowing corrected rows to supersede earlier interpretations.
- NCEI: `EVENT_ID` is the individual event key and joins details to locations/fatalities; `EPISODE_ID` groups related events. Include the annual file revision in provenance.

## Geographic representation

- NWS returns a GeoJSON geometry on each feature when a polygon is supplied. When it is null, preserve `affectedZones`/UGC geocodes rather than inventing a polygon.
- SPC provides point latitude/longitude. Treat it as an observer report point only.
- Storm Events details provides begin/end coordinates; an event may be a point, an approximate line, or have no usable geometry. The separate locations file can add episode/event location rows later.

All normalized geometry should use PostGIS SRID 4326. Preserve source geometry unchanged in `source_records`; derived centroids and distance calculations must be marked as derived.

The versioned Census boundary and territorial enrichment layer is operational and documented in [`docs/geospatial-enrichment-plan.md`](docs/geospatial-enrichment-plan.md) and [`docs/geospatial-data-contract.md`](docs/geospatial-data-contract.md). The controlled demo retains state, county, Census place, and ZCTA polygons for TX, FL, LA, GA, and NC. National weather ingestion is intentionally broader than this commercial geography.

Run an explicitly scoped state import only when commercial coverage expansion has been approved (requires GDAL's `ogr2ogr` and the linked Supabase CLI). Use the two-digit Census FIPS code; do not rely on the importer's historical Montana default:

```bash
supabase db push
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. python3 scripts/import_census_geographies.py --state-fips 48 --apply  # Texas
```

The importer uses TIGER/Line 2025 archives for state, county, and place boundaries. For the national 529 MB ZCTA layer, it derives the selected state's envelope from its Census geometry and obtains complete intersecting ZCTA geometries through the official Census TIGERweb ACS 2025 layer instead of downloading the entire country.

## Proposed normalized model

[`schema.sql`](schema.sql) defines the three POC tables: immutable raw `source_records`, queryable `storm_events`, and operational `ingestion_runs`. Two details are intentional:

1. Raw records are versioned by `(source, source_record_id, payload_hash)`, while normalized events upsert on `(source, source_record_id)`.
2. Both full geometry and centroid have GiST indexes, supporting containment/intersection and radius searches without throwing away polygon evidence.

Normalization should remain source-specific. Do not force warning severity, hail size, and historical damage into one overloaded score. Store common facts in columns and source-specific evidence in the immutable raw payload.

## Honest product boundary

This data can support statements about warnings, nearby reported hail, historical events, relative severity, and areas worth investigating. It cannot establish that a particular property was hit, damaged, needs a roof, or represents a sales lead. Confidence must be computed deterministically from retrieved evidence and returned with its limitations; it must not be improvised by the language model.

## Official references

- [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- [NWS Alerts Web Service](https://www.weather.gov/documentation/services-web-alerts)
- [SPC daily storm reports](https://www.spc.noaa.gov/climo/reports/today.html)
- [NCEI Storm Events bulk downloads](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/)
- [Storm Data bulk CSV field format](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf)
