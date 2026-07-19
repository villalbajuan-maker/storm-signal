# Storm Signal — Conversational Operating Model

**Status:** FROZEN PRODUCT AND ARCHITECTURE DECISION  
**Decision date:** July 19, 2026

## Product doctrine

> **Storm Signal is a weather-intelligence system whose operating system is the conversation. The user investigates, filters, compares, decides, plans, and generates deliverables through natural language; the LLM coordinates verifiable MCP capabilities without replacing human judgment.**

The conversational interface is not a chat feature placed on top of the software. It is the primary operating surface of the product. Supporting visual components, context panels, maps, tables, plans, and artifacts exist to make the conversation easier to understand and act on; they do not become a separate dashboard workflow.

## Guiding question

> **¿A dónde vale la pena ir hoy, dadas las señales meteorológicas, nuestra ubicación, la cuadrilla y el tiempo disponible?**

The question is a guide, not the only supported use case. A user may begin broadly, focus on a hazard or event, compare markets, change operational constraints, divide a crew, inspect evidence, or request a deliverable while preserving conversational context.

## Responsibility model

| Layer | Responsibility |
|---|---|
| User | Supplies intent, constraints, corrections, preferences, and the final decision. |
| Conversational workspace | Maintains the investigation, shows evidence and structured results, and lets the user refine the decision. |
| LLM | Interprets intent, asks only for material missing information, selects capabilities, explains results, and carries context forward. |
| MCP | Exposes bounded, typed, auditable operations for retrieval, comparison, scoring, planning, and artifact preparation. |
| Supabase services | Persist source evidence and product state, perform deterministic geographic/data operations, schedule ingestion, and generate durable artifacts. |
| Official sources | Supply observations, reports, warnings, forecasts, and historical evidence with preserved provenance. |

The LLM may infer how to organize an investigation, but it must not invent source evidence, deterministic scores, route times, persisted state, or generated artifacts.

## Core conversational loop

```text
Ask or refine
      -> retrieve evidence
      -> filter and compare
      -> explain and prioritize
      -> user adjusts constraints
      -> build the field plan
      -> preview and generate the brief
```

The loop must support follow-ups such as:

- What is new?
- Show only hail, wind, tornado, or this cyclone.
- Which of these markets is closer, stronger, or more recent?
- Why did this market rank above the other?
- What changes if the crew splits into two teams?
- Focus on this event and show its time, source, geography, and limitations.
- Build the day around the selected markets.
- Prepare the brief with the final decision.

## Frozen product outcomes

1. **Find the signal.** Retrieve and progressively narrow relevant evidence.
2. **Rank the markets.** Compare candidate areas using explicit evidence and operational constraints.
3. **Build the field plan.** Turn the user's selected priorities into an actionable crew plan.
4. **Share the brief.** Generate a durable, evidence-linked decision artifact.

## Interaction rules

1. Preserve conversational context until the user starts a new investigation.
2. Ask a follow-up only when the missing answer materially changes the result.
3. Prefer progressive refinement over forcing the user to complete a large form.
4. Expose tool evidence and methodology when helpful without making the user operate the tools directly.
5. Allow the user to filter, reorder, exclude, compare, and revisit candidates conversationally.
6. Distinguish evidence, inference, recommendation, and user decision.
7. Use concise responsible-use language; do not turn every recommendation into a legal disclaimer.
8. Never claim that a preview is persisted, a straight-line distance is a drive time, or an investigation priority is a guaranteed outcome.

## Ordered advancement plan

### Phase 1 — Conversational investigation state

- Define the investigation object: origin, crew, time, hazards, evidence window, candidates, selected markets, plan, and artifact references.
- Persist conversations and investigation state by authenticated workspace.
- Let every MCP result update structured context without losing the natural-language exchange.

**Exit condition:** a user can leave and return to the same investigation with its evidence, choices, and rationale intact.

### Phase 2 — Location and reachable-market discovery

- Resolve a covered ZIP/ZCTA into a disclosed starting point.
- Integrate road travel time and reachable-area calculation.
- Discover candidate markets from recent evidence instead of requiring every candidate coordinate in advance.
- Add a typed MCP capability for reachable-market discovery.

**Exit condition:** the system can answer the guiding question with evidence-backed markets that fit the declared travel constraint.

### Phase 3 — Conversational comparison and refinement

- Support closest, strongest, newest, hazard-specific, state-specific, and event-specific comparisons.
- Carry selected and excluded markets across follow-ups.
- Recalculate recommendations when the user changes crew, time, return, hazard, or market preferences.
- Present evidence and methodology in the workspace context surface.

**Exit condition:** the user can reach a final market decision through follow-up questions without restarting or manually operating filters.

### Phase 4 — Operational field planning

- Extend field planning with route time, crew size, team splits, working windows, verification time, and regrouping scenarios.
- Distinguish automatically recommended assignments from user-approved assignments.
- Rebuild the plan when constraints or selected markets change.

**Exit condition:** the approved market decision becomes a feasible, explainable daily crew plan.

### Phase 5 — Durable reports and sharing

- Persist a versioned evidence snapshot and approved plan.
- Generate Field Brief PDF, Deployment Plan PDF, and Priority Areas CSV/Excel through a controlled Supabase artifact service.
- Add tenant-scoped access, retention, content hashes, and revocable sharing.
- Allow conversational revision followed by explicit regeneration.

**Exit condition:** the user can preview, approve, generate, reopen, and securely share the final brief.

### Phase 6 — Product-truth alignment and acceptance

- Make the landing demonstration reproducible from supported capabilities and coverage.
- Align prompts, workspace context, MCP descriptions, artifacts, and responsible-use language.
- Test the entire promise from signup through guiding question, refinement, plan, and brief.

**Exit condition:** every material claim shown in acquisition can be completed in the authenticated product.

## Architecture acceptance rule

New capabilities belong in the V1 path only when they strengthen at least one frozen outcome and remain naturally operable through conversation. A feature that requires the user to abandon the investigation and reconstruct context in a separate dashboard must justify why it cannot be expressed as a conversational capability or a supporting visual surface.
