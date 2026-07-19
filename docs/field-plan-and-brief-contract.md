# Field Plan and Brief Contract V1

Status: implemented for deterministic public-MCP previews on July 19, 2026.

## Purpose

This contract turns weather evidence into an operationally useful investigation sequence without turning evidence into a lead, a damage claim, or an authorization to enter property.

## `build_field_plan`

Required inputs are an objective, two to five explicitly located markets, one to ten named teams, an evidence window, and a working window. An operating base, minutes per market, and evidence radius are optional operational constraints.

The tool reuses `rank_markets` V1. Markets with `insufficient_evidence` are not assigned. Remaining markets stay in deterministic rank order and are assigned round-robin to teams. Each team receives consecutive fixed-duration slots beginning at the supplied working-window start. A slot extending beyond the window is retained but marked unscheduled.

The output records:

- the objective, evidence window, working window, and latest evidence time;
- the frozen ranking snapshot and methodology versions;
- sequence, team, timing, decision, score, rationale, hazards, and verification questions;
- selected, scheduled, and unscheduled capacity;
- continue, change, and stop signals;
- safety and evidence-review checklist;
- missing inputs and explicit limitations.

This is priority scheduling, not road routing, travel-time estimation, workforce tracking, permission, or proof of available work.

## `prepare_field_brief`

The tool accepts only a plan carrying the `storm-signal-field-plan-v1` methodology identifier. It produces:

- a structured artifact preview;
- a human-readable Markdown brief;
- a priority-areas CSV;
- a SHA-256 content hash over the canonical structured preview;
- source methodology, evidence-window, generation-time, timezone, and limitation fields.

The principal decision is the first scheduled assignment, or the first assignment when capacity did not fit. An empty assignment set is represented as insufficient evidence rather than being filled with invented priorities.

## Current delivery boundary

The public MCP has no authenticated tenant or workspace context. It therefore returns `not_persisted` for persistence, `not_available` for revocable sharing, and `not_available` for PDF rendering. Those capabilities require a tenant-scoped artifact service with authenticated storage, access control, retention, and a controlled rendering pipeline.

Until that layer exists, Markdown and CSV are preview content returned in the tool response; they are not durable customer artifacts.

## Acceptance conditions

- The same inputs and evidence produce the same rank, assignment order, and capacity outcome.
- Unsupported markets remain ineligible through the underlying ranking contract.
- Every scheduled item fits inside the supplied working window.
- Unscheduled capacity is disclosed, never silently dropped.
- The brief carries a content hash and the frozen methodology identifiers.
- No output calls a priority a lead or claims property damage, revenue, permission, or route optimization.
