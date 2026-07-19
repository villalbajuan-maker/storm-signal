# Controlled Demo Coverage Contract v1

Status: approved and frozen on 2026-07-19.

## Commercial territory

Storm Signal's controlled demo provides commercial answers only for Texas, Florida, Louisiana, Georgia, and North Carolina. National NWS, SPC, and NHC ingestion continues unchanged; ingestion coverage is not the same as commercial answer coverage.

| State | Code | FIPS |
|---|---|---|
| Texas | TX | 48 |
| Florida | FL | 12 |
| Louisiana | LA | 22 |
| Georgia | GA | 13 |
| North Carolina | NC | 37 |

## Frozen rules

1. Every event exposed by an MCP tool must belong to the commercial territory.
2. A request without a location is automatically scoped to all five covered states.
3. An explicit unsupported state or coordinates outside the territory produce `out_of_coverage`, never an empty result presented as proof that no weather occurred.
4. The scope applies to search, event detail, location assessment, summaries, data health, and generated reports.
5. The operational evidence window is 14 days. A request for a longer period is clamped to the available window and must disclose the effective interval.

## Canonical out-of-coverage response

> This location is not yet part of Storm Signal's controlled demo coverage. We currently provide commercial analysis for Texas, Florida, Louisiana, Georgia, and North Carolina. Coverage for additional states is coming soon.

The MCP transport returns the same outcome structurally with `status: out_of_coverage`, the requested location, and the covered-state list. Friendly conversational wording is presentation; the SQL guard is authoritative.

## Enforcement layers

- Ingestion: national and unchanged.
- Persistence: national operational evidence may be retained within the rolling window.
- Census/PostGIS enrichment: five-state footprint.
- SQL/RPC: mandatory allowlist and 14-day clamp.
- MCP: structured coverage response and effective-window disclosure.
- Reports: generation permitted only for covered events and locations.

## Acceptance boundary

No MCP query may expose an event outside the allowlist, including unlocated searches and direct `event_id` lookups. Source-health observations may describe national ingestion, but event counts, summaries, evidence, and commercial conclusions are scoped to the controlled demo territory.
