# Storm Signal — Product and Commercial Roadmap

**Status:** ACTIVE PRODUCT AUTHORITY — ORDER FROZEN
**Baseline date:** July 19, 2026  
**Commercial scope:** V1 FROZEN

This document keeps product promise, technical delivery, geographic expansion and hazard expansion on one front. Implementation work must strengthen one of the four frozen commercial outcomes; otherwise it belongs in the post-V1 backlog.

## Commercial promise

> Storm Signal helps roofing and restoration companies decide where to investigate, why it matters, and what to do next after severe weather.

Storm Signal converts recent severe-weather evidence into an explainable, shareable, field-ready plan through a conversational experience.

It does not promise property damage, leads, contracts or revenue.

## Frozen V1 outcomes

### 1. Find the signal

Identify relevant severe-weather events and territories through natural-language investigation. Distinguish observations, preliminary reports, warnings, forecasts, historical records and inference.

### 2. Rank the markets

Compare areas using explicit and auditable criteria such as severity, evidence concentration, recency, proximity, confidence and operational relevance. Every ranking must explain the factors that raised or lowered priority.

### 3. Build the field plan

Turn prioritized territories into an investigation plan: selected areas, team assignments, sequence, timing, rationale, field-validation questions, risks and limitations.

### 4. Share the brief

Create persistent deliverables that retain evidence, sources, timestamps, methodology, priority rationale and limitations. Initial formats are Field Brief PDF, Deployment Plan PDF, and Priority Areas Excel or CSV.

## Product operating model

```text
Weather evidence
      -> geographic exposure
      -> market prioritization
      -> field plan
      -> persistent brief
```

The LLM manages conversation, refinement and explanation. Deterministic services own evidence retrieval, geographic intersections, scores and document validation.

## Current capability baseline

### Operational now

- Persistent Supabase ingestion with source payload retention and ingestion health.
- Observed SPC hail, wind and tornado reports.
- NWS severe-thunderstorm and tornado warning evidence.
- Historical NOAA Storm Events hail evidence.
- Six read-only MCP tools: `search_storm_events`, `get_storm_event`, `assess_location`, `summarize_storm_activity`, `search_tropical_cyclones`, and `rank_markets`.
- Census/PostGIS state, county, place and ZCTA enrichment.
- Audited Census/PostGIS coverage for the controlled demo: Texas, Florida, Louisiana, Georgia, and North Carolina.
- National NWS/SPC ingestion with commercial MCP answers limited to those five states and the latest 14 days.
- `get_storm_event` returns geographic lineage and identifies ZCTA as an approximate ZIP area, not a USPS delivery boundary.
- `assess_location` applies the versioned [`multihazard-location-score-contract.md`](multihazard-location-score-contract.md) across hail, wind, tornado and warning evidence, with explicit health penalties and NHC forecasts excluded from scoring.

### Partially delivered

- **Find the signal:** operational for current severe-event types and versioned NHC tropical-cyclone evidence within the five-state controlled-demo geography.
- **Rank the markets:** operational through the versioned [`market-ranking-contract.md`](market-ranking-contract.md), with explicit candidate coordinates, multihazard support, operating-base proximity and `prioritize`/`monitor`/`insufficient_evidence` outputs.
- **Build the field plan:** conversational design is defined; structured plan entities and generation are not yet implemented.
- **Share the brief:** templates and output requirements are defined; production document generation and workspace persistence are not yet implemented.

## One ordered delivery plan

### Stage 1 — Complete the evidence and territory foundation

1. Historical Census/PostGIS import sequence (completed, then reduced for the controlled demo):
   - Montana — complete pilot.
   - Texas — geography imported, audited and applied to existing events.
   - Florida — geography imported, audited and applied to existing events.
   - Louisiana — geography imported and audited; no persisted Louisiana events currently await enrichment.
   - Georgia — geography imported and audited; no persisted Georgia events currently await enrichment.
   - North Carolina — geography imported, audited and applied to existing events.
   - Oklahoma — geography imported, audited and applied to existing events.
   - Colorado — geography imported and audited; no persisted Colorado events currently await enrichment.
   - Kansas — geography imported and audited; no persisted Kansas events currently await enrichment.
   - Nebraska — geography imported and audited; no persisted Nebraska events currently await enrichment.
   - Missouri — geography imported, audited and applied to existing events.
   - South Carolina — geography imported and audited; no persisted South Carolina events currently await enrichment.

   The 12-state import sequence was technically completed. On July 19, 2026, storage was deliberately reduced to TX, FL, LA, GA, and NC. The other seven state datasets were backed up and removed; they are not current commercial coverage.
2. Backfill every event without a geographic-processing status and enrich every new or updated event automatically — completed July 19, 2026 with zero pending at closure.
3. Allow MCP searches by derived county, place and ZCTA — completed July 19, 2026 and validated through the public MCP endpoint.
4. Expose geographic coverage and gaps in `data_health` — completed July 19, 2026 with public queue and coverage validation.

Commercial outcome strengthened: **Find the signal**.

### Stage 2 — Gulf Coast hazard expansion

Integrate hazards in an evidence-aware sequence:

The NHC persistence and evidence contract is frozen in [`nhc-data-contract.md`](nhc-data-contract.md); its four architecture decisions were approved on July 19, 2026. Supabase persistence, archived replay, Census/PostGIS enrichment, five-minute live Atlantic ingestion, MCP search, and NHC observability were completed on the same date.

1. Active NHC cyclone advisories, tracks, cones, watches and warnings.
2. NHC 34-, 50- and 64-knot wind fields and wind-speed probabilities.
3. NHC storm-surge watches, warnings, probabilities and potential flooding products.
4. NOAA National Water Prediction Service river observations, forecasts and flood categories.
5. National Water Model rapid-onset and high-flow forecast products.
6. NHC HURDAT2 best-track history.
7. FEMA flood-hazard layers as baseline risk context, never as proof of an event.

Primary official sources:

- [NHC GIS data and feeds](https://www.nhc.noaa.gov/gis/rss.php)
- [NHC tropical cyclone archive and HURDAT2](https://www.nhc.noaa.gov/data/)
- [NOAA National Water Prediction Service APIs](https://water.noaa.gov/about/api)
- [NOAA water data and web-services catalog](https://water.noaa.gov/about/data-and-web-services-catalog)

Commercial outcomes strengthened: **Find the signal** and **Rank the markets**.

### Stage 3 — Market ranking V1 — completed July 19, 2026

The versioned and deterministic market-priority contract is implemented. Its initial components are:

- event severity;
- concentration of independent evidence;
- recency;
- evidence quality and certainty;
- geographic coverage;
- proximity to the customer's operating base;
- Census housing or market-density context when validated;
- explicit missing-data penalties.

Outputs must be `prioritize`, `monitor`, or `insufficient_evidence`, with component scores and rationale. The product must call these investigation priorities, not leads or confirmed opportunities.

Commercial outcome delivered: **Rank the markets**.

### Stage 4 — Field planning V1

Introduce structured organization inputs: operating base, travel limit, available teams, working window and selected territories. Generate a validated plan with assignments, sequence, timing, rationale and field checks. Advanced route optimization remains outside V1.

Commercial outcome delivered: **Build the field plan**.

### Stage 5 — Deliverables V1

Persist an evidence snapshot and generate controlled templates for:

- Field Brief PDF;
- Deployment Plan PDF;
- Priority Areas Excel or CSV.

The user previews the structured content before generation. Every artifact records its source evidence, generated time, timezone, methodology version and limitations.

Commercial outcome delivered: **Share the brief**.

## Evidence classes

Every stored and presented record must be classified as one of:

- `observed`: a report or measurement;
- `warning`: an official warning for an area;
- `forecast`: a predicted track, field, probability, stage or flow;
- `historical`: a post-event or archival record;
- `baseline_risk`: a standing hazard layer such as FEMA flood zones;
- `derived`: a reproducible geographic intersection, score or other system inference.

The interface and generated reports must never collapse these classes into a single claim of impact.

## Guardrails

- A forecast cone is not an impact footprint.
- A wind field or probability is not proof of property-level wind.
- A warning is not an observation.
- A flood-hazard zone is not proof that flooding occurred.
- A nearby report is not confirmation of property damage.
- Preliminary reports remain labeled preliminary.
- Missing coverage is disclosed and must not be interpreted as proof that no event occurred.
- Commercial recommendations require field verification.

## Outside frozen V1

- CRM replacement and claims management.
- Owner-contact or lead-purchasing databases.
- Automated canvassing or outbound email, SMS and calling.
- Contracting, invoicing and payments.
- Full route optimization and workforce time tracking.
- Autonomous deployment decisions.
- Guaranteed damage, lead or revenue predictions.
- General-purpose weather-dashboard functionality unrelated to the four outcomes.

## Decision control

A proposed feature enters V1 only when it directly strengthens **Find the signal**, **Rank the markets**, **Build the field plan**, or **Share the brief**. A scope change must identify the outcome affected, new commercial value, complexity and risk, and any existing commitment to defer.

This roadmap is the implementation authority. The frozen commercial source is `WebChat/COMMERCIAL_SCOPE_V1.md`; the geospatial details remain governed by `docs/geospatial-data-contract.md` and `docs/geospatial-enrichment-plan.md`.
