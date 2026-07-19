# Storm Signal — Multihazard location support score V1

**Status:** IMPLEMENTED VERSIONED CONTRACT

**Effective date:** July 19, 2026

**Methodology ID:** `storm-signal-location-multihazard-v1`

## Purpose

`assess_location` answers how strongly the currently persisted severe-weather evidence supports investigating a covered location. It is a support score for field investigation, not a probability of damage, a property assessment, a lead score, or a revenue forecast.

The score applies only to Texas, Florida, Louisiana, Georgia, and North Carolina and only to the effective rolling 14-day severe-event window.

## Evidence included

- preliminary SPC hail reports;
- preliminary SPC wind reports;
- preliminary SPC tornado reports;
- active or retained NWS severe-thunderstorm warnings;
- active or retained NWS tornado warnings;
- historical hail evidence is returned as context but contributes only to evidence quality when no operational evidence exists.

NHC evidence remains a separate forecast domain. A track, cone, watch/warning, or wind-radius intersection contributes zero points to this score. It must be presented separately with its forecast semantics.

## Components

| Component | Maximum | Deterministic meaning |
|---|---:|---|
| Severity | 35 | Bounded contributions from maximum reported hail, maximum reported wind, tornado reports, and warning types. Multiple hazards may contribute, but the component is capped. |
| Evidence concentration | 20 | Number of nearby observed report records, with a small cross-hazard increment when at least two observed hazard families are present. It is evidence concentration, not a claim that reports are statistically independent. |
| Proximity | 15 | Distance to the nearest observed SPC report: `<=3`, `<=5`, `<=10`, or within the requested radius. Warning-centroid distance does not drive this component. |
| Recency | 15 | Age of the latest matching evidence: `<=6h`, `<=24h`, `<=72h`, `<=7d`, or older within the available window. |
| Evidence quality | 15 | Highest when preliminary observed reports and official warning evidence coexist; lower for reports only, warnings only, or historical context only. |

The unpenalized component total is `0..100`.

## Input-health penalties

- SPC ingestion not fresh: `-10`;
- NWS ingestion not fresh: `-5`;
- recent geographic-processing queue not empty: `-5`.

The final score is clamped to `0..100`. Every applied penalty appears in `methodology.penalty_points` and `missing_data`.

## Support language

| Score | Machine value | Customer meaning |
|---:|---|---|
| 70–100 | `strong` | Strong support for investigation; field verification remains required. |
| 40–69 | `moderate` | Moderate support; useful evidence exists, with meaningful uncertainty. |
| 15–39 | `limited` | Limited support; gather more evidence or widen/refine the investigation. |
| 0–14 | `insufficient` | Insufficient support for prioritization from the currently persisted evidence. |

## Required output

The tool returns the final score, support level, methodology ID, component scores and maxima, health penalties, missing-data explanations, per-hazard counts and maxima, underlying evidence, coverage, effective window, source health, and limitations.

The language model may explain or compare these outputs. It may not alter weights, invent missing values, convert the score into damage probability, or describe an investigation priority as a confirmed opportunity.
