# Storm Signal — NHC tropical cyclone data contract v0.1

**Status:** FROZEN — approved July 19, 2026  
**Contract date:** July 19, 2026  
**Initial operational scope:** Atlantic basin, including the Gulf and Atlantic coasts  
**Authority:** NOAA National Hurricane Center (NHC)

**Implementation status:** Phase 1 persistence schema and archived-advisory replay completed in Supabase on July 19, 2026. Hurricane Irma `AL112017` advisory 20 persists 32 unique typed features from three checksummed official artifacts; repeated replay creates no duplicates. Live NHC ingestion remains intentionally inactive pending geographic enrichment and the live-ingestion tranche.

## 1. Promise

Given an active NHC tropical cyclone or potential tropical cyclone, Storm Signal will preserve each official advisory and make its forecast track, operational cone, coastal watches/warnings and wind fields geographically queryable, with source lineage and issue/valid times.

The contract supports commercial investigation of territories that may warrant monitoring. It does not claim that:

- the cyclone center will follow the forecast track;
- every location inside the cone will experience hazardous weather;
- the cone is a storm-size or impact footprint;
- the maximum wind radius applies uniformly inside its polygon;
- forecast exposure proves property impact, damage, a lead or a claim.

## 2. Evidence classes must remain separate

| `evidence_class` | Meaning | Initial NHC products |
|---|---|---|
| `analysis` | NHC's analyzed cyclone state at the advisory issue time | center position, classification, maximum sustained wind, pressure and movement |
| `forecast` | Future official forecast, valid at a stated forecast hour | forecast track points, intensity and 34/50/64 kt wind radii |
| `uncertainty` | Uncertainty around the forecast center track | operational cone of uncertainty |
| `watch_warning` | Official coastal watch or warning segment | tropical storm and hurricane watches/warnings |
| `probability` | Modeled probability for a threshold and horizon | cumulative 34/50/64 kt wind-speed probabilities |
| `preliminary_observation` | Operational, preliminary cyclone history | NHC preliminary best track |
| `final_historical` | Post-season authoritative best track | HURDAT2; explicitly deferred from the live slice |

No row may change evidence class merely because it is old. An expired forecast remains a forecast; it does not become an observation.

## 3. Official source and discovery contract

### Discovery

Poll the official NHC GIS RSS feeds and treat RSS `guid` plus `pubDate` as product-discovery and update signals, not as the cyclone identity. NHC documents separate Atlantic and Eastern Pacific feeds and product-specific GUID formats.

Initial feed:

- Atlantic GIS RSS: `https://www.nhc.noaa.gov/gis-at.xml`

Future basin feeds may be enabled without changing the storage contract.

### Phase 1 products

For every active Atlantic system, ingest:

1. advisory summary metadata;
2. advisory forecast shapefile bundle: analyzed/forecast track and operational cone;
3. advisory watches/warnings;
4. advisory wind-field shapefile: initial and forecast 34/50/64 kt radii.

Official references:

- [NHC GIS products](https://www.nhc.noaa.gov/gis/)
- [NHC GIS RSS contract](https://www.nhc.noaa.gov/gis/rss.php)
- [NHC cone interpretation](https://www.nhc.noaa.gov/cone_usage.php)

### Phase 2 products

- cumulative 120-hour wind-speed probabilities at 34, 50 and 64 kt;
- arrival-time products;
- storm-surge watch/warning and probabilistic/inundation products under a separate surge extension to this contract.

Experimental products, including the 2026 experimental cone, must use a distinct `product_status = 'experimental'` and must never replace the operational product in place.

## 4. Stable identity and revision rules

### Cyclone identity

Use the ATCF identifier as the stable source identity:

```text
basin + cyclone number + season year
example: AL012026
```

Storm name and classification are mutable attributes, never primary keys. Renaming or transition between potential tropical cyclone, depression, storm, hurricane, post-tropical or remnant low must not create a new cyclone.

### Advisory identity

Use:

```text
(atcf_id, advisory_number, advisory_kind, issued_at)
```

`advisory_kind` is `full`, `intermediate`, `special` or `unknown`. Preserve advisory labels such as `4`, `4A` and source product identifiers exactly as published.

### Product identity

Use:

```text
(advisory_id, product_type, source_feature_id, valid_at, threshold_kt, product_status)
```

If a file is republished with different bytes, retain the new raw payload version by SHA-256 and rebuild the normalized features for that product revision. Never overwrite raw evidence.

## 5. Persistence contract

The existing immutable `source_records` pattern remains the raw-evidence authority and is extended to accept `nhc_gis`. Binary ZIP/shapefile payloads may be stored in Supabase Storage; `source_records.payload_json` then stores the manifest, checksum, object path, HTTP metadata and parsed inventory rather than embedding binary bytes.

### `tropical_cyclones`

```text
id uuid primary key
source text not null                 -- nhc
atcf_id text unique not null         -- AL012026
basin text not null                  -- AL initially
cyclone_number text not null
season_year integer not null
current_name text
current_classification text
first_advisory_at timestamptz
last_advisory_at timestamptz
active boolean not null
created_at timestamptz not null
updated_at timestamptz not null
```

### `cyclone_advisories`

```text
id uuid primary key
cyclone_id uuid references tropical_cyclones
advisory_label text not null         -- preserve 4A, etc.
advisory_number numeric
advisory_kind text not null
issued_at timestamptz not null
status text not null                 -- issued, superseded, corrected
classification text
storm_name text
center geometry(Point, 4326)
maximum_wind_kt integer
minimum_pressure_mb integer
movement_direction_degrees integer
movement_speed_kt numeric
headline text
source_record_id uuid references source_records
created_at timestamptz not null
unique (cyclone_id, advisory_label, advisory_kind, issued_at)
```

### `cyclone_features`

```text
id uuid primary key
advisory_id uuid references cyclone_advisories
product_type text not null
evidence_class text not null
product_status text not null         -- operational, experimental
source_feature_id text not null
forecast_hour integer                -- 0 for analysis, >0 for forecast
valid_at timestamptz
threshold_kt integer                 -- 34, 50 or 64 when applicable
probability_percent numeric
watch_warning_type text
geometry geometry(Geometry, 4326) not null
source_record_id uuid references source_records
attributes jsonb not null
created_at timestamptz not null
```

Required indexes and constraints:

- GiST indexes on advisory center and feature geometry;
- B-tree indexes on ATCF ID, issue time, valid time, product type and threshold;
- valid SRID 4326, non-empty geometry and `ST_IsValid`;
- wind thresholds limited to `34`, `50`, `64` when present;
- probability limited to `0..100`;
- forecast hour non-negative;
- uniqueness on the product identity defined above.

### Why this is not stored only in `storm_events`

An advisory is a versioned forecast package containing multiple geometries and future valid times. Flattening it into one `storm_events` row would either discard revisions or confuse track, cone, warning and wind-field semantics. Existing `storm_events` remains the severe-weather evidence store; cyclone tables become the authoritative NHC forecast domain and may expose a unified MCP presentation layer.

## 6. Geometry semantics

### Center and track

- An advisory center is an `analysis` point at `issued_at`.
- A forecast track point is a `forecast` point at `valid_at` and `forecast_hour`.
- A line joining forecast points is derived visualization only; it is not an impact corridor.

### Operational cone

- Store the source polygon unchanged as `uncertainty`.
- The cone concerns probable center-track uncertainty, not storm size or impact.
- A territory intersection means only that its geometry intersects the published cone.
- Store operational and experimental 2026 cones independently.

### Wind radii

- Preserve quadrant-specific source values and generated/source polygons.
- A 34/50/64 kt radius is the maximum possible extent in a quadrant, not uniform wind coverage.
- Keep analyzed radii (`forecast_hour = 0`) separate from forecast radii.

### Watches and warnings

- Preserve the official type, coastline/breakpoint lineage and geometry.
- An intersected inland Census area is a derived geographic association, not an expansion of the official coastal segment.

## 7. Geographic enrichment

Reuse Census/PostGIS version `2025` and method family `census-postgis-v1`.

Each NHC feature may be associated with `state`, `county`, `place` and `zcta` through `ST_Intersects`. Store:

```text
cyclone_feature_id
geographic_area_id
relation = intersects_geometry
intersection_ratio
derived_at
method_version
```

`intersection_ratio` measures geometry overlap only. It is not wind probability, expected damage or population exposure. Offshore-only features may correctly have no Census association.

## 8. Ingestion and supersession lifecycle

1. Poll Atlantic RSS every 5 minutes with conditional HTTP requests where supported.
2. Discover product GUIDs and download only new or changed assets.
3. Hash and retain the source payload/manifest before normalization.
4. Upsert the cyclone by ATCF ID.
5. Insert the advisory revision and its typed features transactionally.
6. Mark the previous advisory as `superseded`; do not delete it.
7. Enrich new geometries against Census/PostGIS.
8. Record per-product counts, rejection reasons, latency and geographic status in `ingestion_runs` or a linked product-run table.
9. Retry incomplete product downloads independently; one missing product must not erase or invalidate the other products in the advisory.

An inactive RSS season is a successful empty poll, not an ingestion failure.

## 9. MCP contract

The initial MCP extension should add one read-only tool rather than overloading severe-storm event types:

### `search_tropical_cyclones`

Inputs:

```text
active_only boolean default true
atcf_id text
issued_after / issued_before timestamptz
product_types text[]
evidence_classes text[]
state text
county text
place text
zcta text
valid_at timestamptz
limit integer
```

Each result must include:

- cyclone identity, name and classification;
- advisory label, issue time and supersession status;
- product/evidence class and operational/experimental status;
- forecast hour and valid time;
- threshold/probability where applicable;
- source URL, retrieval time and raw-record lineage;
- derived Census geographies and method version;
- product-specific interpretation and limitations.

Conversational language must say “forecast to”, “within the cone”, “under a watch/warning” or “probability of at least X-kt wind”, never “was hit”, unless a separate observed source supports that claim.

## 10. Data health and acceptance criteria

`data_health` must report:

- last successful RSS poll and minutes since poll;
- active cyclones discovered;
- latest advisory per cyclone;
- expected versus received product types;
- incomplete/failed product downloads;
- normalization rejections;
- unenriched features;
- oldest active advisory age;
- current source state: `active`, `seasonally_empty`, `degraded` or `failed`.

The Atlantic Phase 1 slice is accepted when:

1. A historical archived advisory can be replayed deterministically.
2. Replaying the same files creates no duplicate cyclones, advisories or features.
3. A corrected/reissued asset retains both raw hashes and one explicit current revision.
4. Track, cone, watch/warning and wind radii remain distinguishable in storage and MCP output.
5. Issue time, valid time and forecast hour survive normalization exactly.
6. Census enrichment is reproducible and honest for land and offshore geometries.
7. A product-level failure produces `partial`, preserves successful products and is visible in `data_health`.
8. Automated tests cover intermediate advisories, unknown/missing fields, operational versus experimental cone, quadrant radii and empty RSS periods.

## 11. Explicitly deferred

- NHC/CPHC basin expansion beyond Atlantic;
- tropical weather outlook disturbance probabilities before advisory issuance;
- HURDAT2 final historical reconciliation;
- probabilistic wind and arrival-time implementation;
- storm-surge rasters and depth interpretation;
- rainfall, river flooding, flash flooding and National Water Model products;
- population, parcel, building, roof, damage, lead and revenue inference;
- automated market ranking based solely on cone intersection.

## 12. Freeze decisions

The following four decisions were approved and frozen on July 19, 2026:

1. Initial basin: `Atlantic (AL)`, covering the Gulf and Atlantic commercial corridor.
2. Phase 1 products: `summary + track + operational cone + watches/warnings + 34/50/64 kt wind fields`.
3. Persistence: dedicated versioned cyclone/advisory/feature tables linked to immutable `source_records`.
4. Public semantics: forecasts, uncertainty, watches/warnings and observations remain explicitly separate.

Changes to these four decisions require a contract revision.
