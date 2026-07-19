# Storm Signal geospatial data contract v0.1

**Status:** implemented; operational scope amended July 19, 2026

**Original validation territory:** Montana

**Current commercial territory:** Texas, Florida, Louisiana, Georgia, and North Carolina

**Future expansion:** state-by-state only after explicit commercial and storage approval
**Boundary authority:** U.S. Census Bureau TIGER/Line, initial vintage 2025

## 1. Promise

Given a persisted weather event with valid geometry, Storm Signal will return the Census territories that contain or intersect that evidence, together with enough lineage to reproduce the result.

The contract supports:

- state and county or county equivalent;
- Census incorporated place or census-designated place, when applicable;
- five-digit ZIP Code Tabulation Area (ZCTA), when applicable;
- the Census vintage, GEOID, spatial relationship and derivation method.

It does not promise an exact USPS ZIP delivery boundary, a storm footprint, property impact, damage or a commercial lead.

## 2. Architecture decision

```text
Census TIGER/Line archives
        ↓
Python bulk importer and validator
        ↓
Supabase PostgreSQL + PostGIS
        ↓
idempotent spatial enrichment function
        ↓
existing Storm Signal MCP tools
```

- Python handles bulk download, archive extraction, coordinate conversion and validation. This is a bounded data-loading job, not the live request path.
- Supabase/PostGIS is the authoritative runtime store and performs containment/intersection queries.
- The live NWS/SPC Edge Function remains responsible for weather ingestion. After persistence it requests enrichment in batches; enrichment failure must not discard weather evidence.
- A scheduled retry processes unenriched events, so the flow is resumable.

## 3. Source contract

Use the official Census TIGER/Line distribution and preserve:

- Census vintage;
- original download URL;
- downloaded filename;
- retrieval timestamp;
- archive SHA-256;
- layer name;
- feature count;
- rejected-feature count and reason.

Initial layers:

| `area_type` | Census layer | Identity |
|---|---|---|
| `state` | State and equivalent | state GEOID/FIPS |
| `county` | County and equivalent | county GEOID |
| `place` | Incorporated place and CDP | place GEOID |
| `zcta` | Five-digit ZCTA | ZCTA5 GEOID |

ZCTA must be described to users as `ZCTA` or `approximate ZIP area`. It must never be described as an exact USPS ZIP boundary.

## 4. Persistence contract

### `geographic_import_runs`

```text
id uuid primary key
vintage integer
area_type text
scope text                  -- e.g. MT or US
source_url text
source_sha256 text
started_at timestamptz
completed_at timestamptz
status text                 -- running, complete, failed
records_received integer
records_loaded integer
records_rejected integer
error_message text
```

### `geographic_areas`

```text
id uuid primary key
vintage integer not null
area_type text not null     -- state, county, place, zcta
geoid text not null
name text
state_fips text
county_fips text
zcta5 text
geometry geometry(MultiPolygon, 4326) not null
source_url text not null
source_sha256 text not null
created_at timestamptz not null
```

Required invariants:

- unique `(vintage, area_type, geoid)`;
- geometry uses SRID 4326;
- geometry is valid and non-empty;
- GiST index on `geometry`;
- lookup indexes on type, GEOID, FIPS and ZCTA;
- five-digit codes remain text so leading zeros are preserved.

### `storm_event_areas`

```text
storm_event_id uuid references storm_events
geographic_area_id uuid references geographic_areas
relation text               -- covers_centroid, intersects_geometry
intersection_ratio numeric  -- null for points
derived_at timestamptz
method_version text
primary key (storm_event_id, geographic_area_id, relation, method_version)
```

`intersection_ratio` means:

```text
area(event geometry ∩ geographic area) / area(geographic area)
```

It describes how much of the territory is covered by a source polygon. It does not estimate how much of the territory experienced the phenomenon.

## 5. Spatial semantics

### Point events

SPC reports and point-like historical events use the event centroid and `ST_Covers`:

- associate every containing state, county, place and ZCTA;
- allow no place/ZCTA result when the coordinate is outside those layers;
- never buffer a point and call the result a storm footprint.

### Polygon events

NWS warning polygons and future forecast polygons use `ST_Intersects`:

- return all intersected territories;
- calculate `intersection_ratio` using area-safe PostGIS geography/projected calculations;
- preserve the difference between warning, forecast and observation;
- do not infer that the full intersected territory experienced hail, wind or tornado.

### Missing geometry

- Preserve source-provided state, county, UGC zones and area descriptions.
- Return `geospatial_status: "insufficient_geometry"`.
- Do not fabricate geometry from a textual location.

## 6. Enrichment lifecycle

1. Persist the weather event and raw payload.
2. Add or select the event for enrichment.
3. Run an idempotent PostGIS enrichment function for the active Census vintage.
4. Upsert territorial associations.
5. Mark the event `complete`, `partial`, `insufficient_geometry` or `failed` for geographic enrichment.
6. Retry incomplete/failed work in bounded batches.

Reprocessing the same event and vintage must produce no duplicate associations.

## 7. MCP output contract

The four existing tools remain the public interface.

Every returned event may include:

```json
{
  "geospatial_status": "complete",
  "geographies": {
    "state": [{"geoid": "48", "name": "Texas", "vintage": 2025}],
    "county": [{"geoid": "...", "name": "Floyd County", "vintage": 2025}],
    "place": [],
    "zcta": [{"geoid": "...", "zcta5": "...", "vintage": 2025}]
  },
  "derivation": {
    "relation": "covers_centroid",
    "method_version": "census-postgis-v1"
  }
}
```

Tool extensions:

- `search_storm_events`: filters for `county_geoid`, `place_geoid` and `zcta5`.
- `get_storm_event`: returns every association and derivation detail.
- `assess_location`: returns containing territories for the supplied coordinate.
- `summarize_storm_activity`: supports `group_by` values `county`, `place` and `zcta` using derived associations.

An empty territorial result must disclose Census coverage/vintage and `geospatial_status`; it must not be presented as proof that the event belongs to no ZIP code or community.

## 8. Historical pilot acceptance criteria

The Montana slice is accepted only when:

1. County, place and ZCTA layers load with zero silently rejected geometries.
2. Every loaded feature has valid MultiPolygon geometry in SRID 4326.
3. Known urban, rural, boundary and no-ZCTA coordinates have expected deterministic results.
4. Existing Montana SPC events receive reproducible county/place/ZCTA associations.
5. A repeated import and enrichment creates zero duplicates.
6. The MCP can search, retrieve, assess and summarize using the derived territories.
7. Responses expose vintage, GEOID, relation and method version.
8. Automated tests cover point-on-boundary, missing geometry and polygon intersection behavior.

The Montana pilot proved the importer and schema. The later 12-state import was reduced to the approved five-state controlled demo because of storage constraints. Expansion is no longer automatic or nationwide-by-default.

## 9. Explicitly deferred

- exact USPS ZIP products;
- census tracts and block groups;
- demographic variables;
- roads and addresses;
- parcels, buildings, owners and roof attributes;
- customer territories and CRM routing;
- forecast polygons, which will reuse this geographic foundation in the next integration.

## 10. Original freeze decision and current amendment

Before implementation, confirm these four decisions:

1. Initial Census vintage: `2025`.
2. Pilot territory: `Montana`.
3. Initial layers: `state + county + place + ZCTA`.
4. User-facing terminology: `ZCTA (approximate ZIP area)`.

These four decisions describe the completed original pilot. The July 19, 2026 amendment preserves the 2025 vintage, layers, and terminology while replacing the operational territory with TX, FL, LA, GA, and NC. The authoritative response guard is [`controlled-demo-coverage-contract.md`](controlled-demo-coverage-contract.md).
