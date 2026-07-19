# Geospatial enrichment plan

The implementation-facing mini-contract is [`geospatial-data-contract.md`](geospatial-data-contract.md).

## Product outcome

Turn persisted weather evidence into auditable territories that a commercial team can investigate:

`weather event -> point or polygon -> county -> Census place -> ZCTA -> prioritized territory`

This enrichment identifies geographic opportunity areas. It does not establish property impact, damage, homeowner identity, or sales qualification.

## Terminology and source of truth

- **PostGIS** is the spatial engine already enabled in Supabase. It stores points and polygons and performs containment, intersection, distance, and area calculations.
- **TIGER/Line** is the U.S. Census Bureau boundary source. Load geometries together with stable geographic identifiers (`GEOID`).
- **ZCTA** (ZIP Code Tabulation Area) is the Census Bureau's approximate areal representation of prevalent USPS ZIP Codes. A ZCTA is not a live USPS delivery ZIP boundary, and some ZIP Codes have no ZCTA. Product language must say `ZCTA` or `approximate ZIP area`, not `exact ZIP boundary`.
- Keep every imported boundary's Census vintage and source URL. Boundaries change over time.

Official references:

- [Census TIGER/Line shapefiles](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html)
- [Census ZCTA guidance](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html)
- [Census geographic mapping files](https://www.census.gov/programs-surveys/geography/geographies/mapping-files.html)

## Initial boundary layers

Load the latest stable nationwide Census vintage in this order:

1. States and state equivalents.
2. Counties and county equivalents.
3. Census places: incorporated places and census-designated places.
4. Five-digit ZCTAs.

Defer census tracts, block groups, roads, parcels, USPS products, and demographic enrichment until the first four layers are verified. County and ZCTA boundaries are the commercial minimum; places improve human-readable answers.

## Database design

Create a versioned `geographic_areas` table with:

```text
id
vintage
area_type          -- state, county, place, zcta
geoid
name
state_fips
county_fips
zcta5
geometry           -- MultiPolygon, SRID 4326
source_url
created_at
```

Constraints and indexes:

- Unique `(vintage, area_type, geoid)`.
- GiST index on `geometry`.
- B-tree indexes on `area_type`, `geoid`, `state_fips`, `county_fips`, and `zcta5`.
- Validate and normalize geometries during import; never silently discard invalid features.

Prefer a separate derived association table rather than permanently copying every current place name into `storm_events`:

```text
storm_event_areas
storm_event_id
geographic_area_id
relation           -- contains_centroid, intersects_geometry
intersection_ratio -- only meaningful for polygon events
derived_at
method_version
```

This preserves lineage and allows boundary vintages or spatial methods to be recomputed.

## Spatial rules

### Point evidence

For SPC reports and point-like historical events:

- Use `ST_Covers(area.geometry, event.centroid)` so boundary points are not accidentally excluded.
- Associate the point with its containing county, place when available, and ZCTA.
- Do not turn a point into a hail footprint.

### Polygon evidence

For NWS warning polygons:

- Use `ST_Intersects(area.geometry, event.geometry)` to find affected areas.
- Calculate intersection area using a suitable projected calculation or geography, not raw longitude/latitude degrees.
- Return both the list of intersected territories and the percentage of each territory covered.
- Describe these as warned/intersected areas, not observed hail areas.

### Events without geometry

- Preserve source county, state, UGC zone, or area description.
- Mark the geographic resolution and derivation method.
- Never fabricate a point or polygon from a county name alone.

## Delivery phases

### Phase 1 — Census boundary foundation

- Build a repeatable downloader/importer for the selected Census vintage.
- Load counties, places, and ZCTAs into staging tables.
- Validate row counts, geometry types, SRID, invalid geometries, and nationwide state coverage.
- Promote verified data into `geographic_areas`.

### Phase 2 — Event enrichment

- Backfill `storm_event_areas` for the existing events.
- Enrich every new event after ingestion.
- Make the process idempotent and resumable by layer, state, vintage, and event batch.
- Track each enrichment run operationally, like source ingestion.

### Phase 3 — MCP geographic experience

Keep the four-tool contract and extend their inputs/results:

- `search_storm_events`: filter and return county GEOID, place and ZCTA.
- `get_storm_event`: return all derived geographic associations and derivation metadata.
- `assess_location`: return the containing territories plus nearby evidence.
- `summarize_storm_activity`: group by ZCTA, place, county, or state and rank territories.

Example supported question:

> Which ZCTAs in Montana had the strongest observed hail signals in the last 48 hours, and what evidence supports each one?

### Phase 4 — Commercial prioritization

Add a deterministic territory signal based only on defensible weather evidence:

- recency;
- maximum reported hail magnitude;
- count and concentration of distinct observations;
- distance between reports;
- warning intersection as supporting context;
- source freshness and geographic coverage.

Return `prioritize`, `monitor`, or `insufficient_evidence`, with score components and limitations. Do not call these records leads.

### Phase 5 — Reports and maps

- Generate a conversation-grounded executive report with territory tables, event IDs, sources, freshness, coverage, and limitations.
- Return GeoJSON suitable for a map artifact.
- Add printable/exportable output only after the territory results are reproducible.

## Acceptance criteria for the first geographic release

1. A known coordinate resolves reproducibly to the expected county, Census place when applicable, and ZCTA.
2. A warning polygon returns every intersected county/ZCTA with defensible intersection metrics.
3. A point on a boundary is handled deterministically.
4. Every association exposes Census vintage, GEOID, relation, and method version.
5. Reprocessing produces no duplicate associations.
6. Empty answers disclose source freshness and geographic coverage.
7. MCP answers use `ZCTA`/`approximate ZIP area` accurately.
8. Tests include urban, rural, border, water, missing-geometry, and multi-state polygon cases.

## Recommended next implementation session

Start with one thin vertical slice before nationwide loading:

1. Create the versioned tables and indexes.
2. Import counties, Census places, and ZCTAs for Montana, where current SPC evidence already exists.
3. Backfill the four Montana hail reports.
4. Extend `get_storm_event` and `summarize_storm_activity` to return the derived territories.
5. Verify the conversational flow through Claude.
6. Once correct, scale the same importer nationwide in bounded, resumable batches.

Montana is a validation territory, not a permanent product limitation. This sequence lets us prove point-to-territory enrichment against live data before paying the operational cost of a nationwide import.
