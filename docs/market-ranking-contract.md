# Storm Signal — Market ranking V1

**Status:** IMPLEMENTED VERSIONED CONTRACT

**Effective date:** July 19, 2026

**Methodology ID:** `storm-signal-market-ranking-v1`

## Purpose

`rank_markets` compares two to five explicitly located candidate markets and identifies their relative investigation priority. A market is represented in V1 by a customer-facing name, a coordinate, and a common investigation radius.

The output is not a lead score, damage probability, route plan, revenue prediction, or autonomous deployment decision.

## Inputs

- two to five named markets with latitude and longitude;
- evidence start and end times, clamped by the existing 14-day contract;
- common search radius, default `10 miles`;
- optional operating base with name and coordinate.

Coordinates are explicit inputs. The tool does not geocode names or silently invent market centroids.

## Components

| Component | Maximum | Meaning |
|---|---:|---|
| Multihazard evidence | 70 | Seventy percent of the versioned `storm-signal-location-multihazard-v1` score. |
| Operating proximity | 20 | Straight-line distance from the supplied operating base: `<=50`, `<=100`, `<=200`, `<=300`, `<=500`, or more than `500 miles`. This is not driving distance or travel time. |
| Geographic readiness | 10 | Ten points when the geographic queue is healthy; five when current processing is degraded. |
| Missing operating base | −5 | Applied when no operating base is supplied. The market remains rankable, but operational fit is explicitly incomplete. |

Final scores are clamped to `0..100`. Covered candidates are sorted by final score descending and then by name for deterministic ties. Out-of-coverage candidates remain visible but receive no score or rank.

## Decisions

| Condition | Output |
|---|---|
| Final score `>=65` with more than insufficient evidence support | `prioritize` |
| Final score `>=30` with more than insufficient evidence support | `monitor` |
| Location support is insufficient or final score `<30` | `insufficient_evidence` |

These labels describe investigation priority only. Field verification remains required.

## Evidence boundaries

- Hail, wind, tornado, warning, recency, proximity and health semantics come from the multihazard location contract.
- NHC tracks, cones and wind fields remain forecast context and contribute zero ranking points.
- Evidence concentration does not prove independent reports or property impact.
- A missing or stale source lowers confidence and is disclosed; it is not evidence that no weather occurred.
- Travel constraints use straight-line distance only until a contracted routing or road-distance provider exists.

## Required output

Every result includes the methodology ID, component maxima, decision thresholds, operating base, ordered candidates, eligibility, rank, decision, final and source scores, component rationale, hazards, missing data, coverage, health and limitations.
