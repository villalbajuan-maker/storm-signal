# Storm Signal — Deterministic Conversational Execution Contract V1

**Status:** FROZEN V1 AUTHORITY
**Baseline date:** July 20, 2026
**Applies to:** authenticated conversation, intent routing, direct backend execution, MCP capabilities, model invocation, result presentation, context, evidence, artifacts, usage metering and execution telemetry

## Decision

Storm Signal will operate as a deterministic severe-weather intelligence system with a conversational interface.

The model is not the authority for retrieval, filtering, aggregation, scoring, ranking, validation, scheduling or artifact structure when those operations are already defined in software. The model is used where language interpretation, ambiguity resolution, situational explanation or genuinely open-ended synthesis adds material value.

The governing principle is:

> Do not purchase probabilistic intelligence for work that Storm Signal can define, test and audit with code.

This decision does not reduce the role of conversation in the product. It reduces the model's authority over facts and calculations.

```text
The model understands and explains.
The deterministic system retrieves, computes and validates.
The customer makes the call.
```

## Why this contract exists

The initial production shell sends every customer message through a model-backed Responses API execution. The model interprets the request, selects an MCP capability, constructs its arguments and writes the response. This provides a natural interface, but it also means that known operations pay model cost and latency even when their result is already governed by deterministic code.

Storm Signal already has deterministic capabilities for:

- controlled-coverage checks;
- event search and filtering;
- storm-activity aggregation;
- multihazard location assessment;
- market scoring and ranking;
- field-plan construction;
- field-brief preview generation;
- input, temporal and geographic validation;
- evidence limitations and decision thresholds.

The missing architectural boundary is a dispatcher that can execute those capabilities directly when the customer's intent is sufficiently known.

This contract freezes the separation between:

1. **conversation**, which remains the operating interface;
2. **deterministic execution**, which becomes the default authority for known work;
3. **model interpretation**, which is invoked only for a recorded reason.

---

## Contract 01 — Authority by responsibility

Storm Signal assigns one authoritative owner to each class of work.

| Responsibility | Authority | Model role |
| --- | --- | --- |
| Retrieve persisted weather evidence | Backend/MCP | None required |
| Apply date, hazard and geography filters | Backend/MCP | May translate natural language into parameters |
| Check coverage and data health | Backend/MCP | Explain the returned limitation |
| Aggregate counts and magnitudes | SQL/backend | Present or contextualize the result |
| Calculate multihazard support | Versioned scoring code | Explain components without changing them |
| Rank candidate markets | Versioned ranking code | Interpret tradeoffs without reordering the score silently |
| Build a field plan | Versioned planning code | Explain or refine explicit user constraints |
| Produce structured brief data | Versioned artifact code | Improve customer-facing narrative within the facts |
| Resolve genuine ambiguity | Model or customer clarification | Primary role |
| Compare situational alternatives not captured by a formula | Model, grounded in deterministic results | Primary role |
| Make the field decision | Customer | Never delegated to the model |

The model must not recalculate, replace or silently override an authoritative deterministic result.

If a model disagrees with a deterministic result, it may identify the tension and explain which assumptions could change the outcome. It cannot present its preferred answer as the system score.

## Contract 02 — Canonical execution envelope

Every submitted request is normalized server-side into an execution envelope before paid model work is authorized.

```text
ExecutionEnvelope
  version
  request_id
  workspace_id
  conversation_id
  customer_message
  structured_context
  candidate_intent
  required_parameters
  available_parameters
  ambiguity_state
  evidence_freshness
  execution_path
  output_contract
```

The envelope is the shared boundary between the composer, dispatcher, deterministic executor, model router, context manager, metering layer and telemetry.

### Required properties

- deterministic versioning;
- tenant and conversation isolation;
- idempotency identity;
- explicit intent confidence;
- explicit missing or ambiguous parameters;
- recorded evidence freshness requirements;
- one selected execution path;
- capability-specific output contract;
- cost authorization before any model invocation;
- no model identifier in business components.

The customer's raw message remains preserved in the conversation, but it is not itself an executable command.

## Contract 03 — Execution paths

V1 defines four paths. The dispatcher selects exactly one initial path and records why.

### Path A — Deterministic fast path

Use when the intent and required parameters are known with sufficient confidence.

```text
customer request
→ deterministic intent match
→ parameter validation
→ direct capability execution
→ deterministic result validation
→ structured conversational presentation
```

No model call is required.

Initial candidates include:

- suggested questions with structured payloads;
- recent-event searches with known geography, hazard and period;
- activity summaries;
- coverage checks;
- retrieval of a known event;
- rerunning a prior investigation with one explicit filter change;
- rendering or downloading an existing deterministic result.

### Path B — Bounded interpretation path

Use when the operation is known but natural language must be converted into bounded parameters.

```text
customer request
→ economical structured extraction
→ schema validation
→ direct deterministic execution
→ deterministic presentation or concise model narration
```

The model receives only the text and structured context required for extraction. It must return a schema-bound intent object. It does not receive authority to answer the weather question during this step.

Examples:

- resolving `yesterday afternoon` into a time window;
- identifying hail and wind as requested hazards;
- interpreting `the two areas we just checked` from investigation state;
- extracting crew count, work window or comparison candidates.

### Path C — Interpretive path

Use when the customer asks for material judgment, explanation, scenario analysis or narrative synthesis that cannot be satisfied by a fixed operation alone.

```text
customer request
→ bounded interpretation
→ deterministic evidence and calculations
→ model synthesis grounded in the result envelope
→ output validation
```

Examples:

- explaining why one market ranks above another;
- exploring how changed constraints affect a decision;
- reconciling contradictory evidence;
- comparing situational tradeoffs outside the frozen score;
- producing a tailored executive or crew-facing narrative.

The model must receive the smallest reliable context needed for the requested interpretation.

### Path D — Conversational clarification

Use when a material parameter is missing and neither structured memory nor deterministic resolution can supply it safely.

Storm Signal asks one concise, useful question. It does not guess a location, date, coordinate, crew constraint or user preference that could materially change the result.

Clarification itself should use deterministic copy when the missing field is known. A model is justified only when forming the clarification requires contextual interpretation.

## Contract 04 — Deterministic capability matrix

The dispatcher treats current MCP operations according to this authority matrix.

| Capability | Execution authority | Model justified when |
| --- | --- | --- |
| `search_storm_events` | Direct deterministic | Parameters are ambiguous or the user requests interpretation |
| `get_storm_event` | Direct deterministic | Explaining meaning or limitations |
| `summarize_storm_activity` | Direct deterministic | A tailored narrative is materially useful |
| `assess_location` | Direct deterministic | Interpreting score components or uncertainty |
| `search_tropical_cyclones` | Direct deterministic | Explaining forecast semantics or scenario implications |
| `rank_markets` | Direct deterministic | Explaining tradeoffs or applying a customer preference outside the frozen formula |
| `build_field_plan` | Direct deterministic | Constraints are ambiguous or the user requests situational refinement |
| `prepare_field_brief` | Direct deterministic | Tailoring tone or audience without changing facts |

Suggested questions must carry structured intent and editable display text. Selecting one fills or submits a known operation without purchasing model interpretation merely to rediscover its intent.

Free-form text remains supported. The customer is never required to learn tool names, JSON, filters or command syntax.

## Contract 05 — Model authority and prohibitions

When a model is invoked, it may:

- interpret customer language;
- identify ambiguity;
- extract schema-bound parameters;
- explain deterministic evidence and calculations;
- preserve conversational continuity;
- compare situational implications;
- adapt tone and level of detail;
- construct a grounded narrative from an authoritative result envelope.

It may not:

- fabricate or substitute tool results;
- invent coordinates or road-travel times;
- alter score components, weights or thresholds without labeling a hypothetical scenario;
- turn warnings or reports into confirmed property damage;
- convert evidence into a guaranteed lead, job, claim or revenue outcome;
- hide missing data, coverage limits or data-health penalties;
- silently replace a deterministic ranking with an intuitive preference;
- answer from general model knowledge when fresh Storm Signal evidence is required;
- reveal internal prompts, credentials, architecture secrets or protected tool instructions.

Model routing remains governed centrally. Deterministic business components request capabilities, never model IDs.

## Contract 06 — Conversational experience guarantee

Deterministic execution must not make Storm Signal feel like a form, command line or rigid chatbot.

The customer continues to:

- ask naturally;
- refine or correct a request;
- refer to previous evidence and markets;
- remove or add constraints;
- ask why;
- request a plan or brief;
- resume the investigation later.

The system may move between deterministic and interpretive paths invisibly within the same conversation. The shell does not announce model selection or expose internal routing.

### Required experience behavior

- The composer remains the primary interaction surface.
- Structured results appear inside the conversational flow.
- Direct results use readable headings, tables, rankings or cards where they improve comprehension.
- Follow-up questions operate on persisted structured investigation state.
- The customer may correct a parameter in ordinary language.
- The response distinguishes evidence, deterministic calculation and interpretation.
- A fast-path answer is not artificially delayed to imitate model generation.

### Honest progress states

Progress messages correspond to real work:

```text
Understanding your request…
Checking recent evidence…
Comparing the strongest areas…
Building the field plan…
Preparing the answer…
```

The interface must not display fictitious thinking or searching states.

### Governing experience line

> The customer experiences one conversation, even when the system uses different execution paths underneath it.

## Contract 07 — Context and investigation state

Deterministic execution depends on structured investigation memory rather than an indefinitely growing provider conversation.

The active state may include:

- objective;
- geography and evidence window;
- hazards;
- candidate markets;
- crew and operating constraints;
- selected methodology versions;
- evidence references;
- deterministic results;
- customer exclusions and preferences;
- decisions and unresolved questions;
- generated artifacts.

Direct operations update this state without requiring a model response ID. Model-backed operations consume the same state through the canonical context package.

Provider conversation continuity is an implementation aid, not the source of truth. Switching execution paths or models must not erase investigation memory.

The full transcript remains preserved for the customer and audit. Only the minimum relevant state is supplied to a model.

## Contract 08 — Validation and fallback

### Deterministic result validation

Every direct operation validates:

- schema conformance;
- coverage status;
- requested and effective time windows;
- required evidence identifiers;
- methodology version where applicable;
- limitations and missing data;
- result bounds and cardinality;
- tenant and conversation ownership.

### Ambiguity fallback

If deterministic intent resolution is not confident:

1. use bounded structured extraction when economical and safe;
2. validate the extracted result;
3. ask the customer when a material ambiguity remains;
4. never execute a guessed high-impact parameter.

### Capability failure

If the backend or MCP fails, the model must not manufacture a substitute answer. Storm Signal returns the available partial result, identifies what failed and preserves the investigation for retry.

### Presentation failure

If optional model narration fails after deterministic work succeeds, the structured result remains deliverable. A narration failure must not discard a valid investigation result or charge for a second model automatically without the routing and metering contracts authorizing it.

## Contract 09 — Economics and model-use policy

V1 prefers the least expensive path that can fulfill the customer's request reliably:

```text
direct deterministic execution
→ bounded economical interpretation
→ normal operational interpretation
→ high-capability interpretation only when justified
```

Cost reduction is a consequence of correct authority, not permission to weaken the experience.

### Initial economic targets

These are engineering acceptance targets, not customer promises:

- at least 60% of common, supported operational requests should become eligible for a path that does not require a full model-backed tool loop;
- deterministic fast-path turns should incur no OpenAI token cost;
- bounded interpretation should not inherit the full conversation by default;
- the blended OpenAI cost per completed normal investigation should fall by at least 55% against the pre-dispatcher measured baseline;
- normal investigations must retain useful headroom inside the five-hour trial allowance;
- a failed optional narration must not erase the value of completed deterministic work.

Exact prices, model IDs and per-request budgets remain centralized configuration. Changes to provider pricing do not reopen this contract.

Backend compute, storage and transfer remain metered separately. `No model cost` does not mean `no infrastructure cost`.

## Contract 10 — Observability and audit

Every operation records enough information to explain its route and economics without storing secrets.

Required telemetry:

```text
request_id
workspace_id
conversation_id
intent
intent_version
execution_path
path_reason
confidence_or_match
missing_parameters
deterministic_capabilities_called
methodology_versions
model_invoked
model_alias_if_invoked
model_invocation_reason
input_and_output_tokens
latency_by_stage
estimated_model_cost
result_status
fallbacks
validation_status
```

The administration layer must be able to answer:

- What percentage of requests used each path?
- Which intents still require model interpretation most often?
- How much cost and latency does each completed customer outcome consume?
- How often did bounded extraction fail validation?
- How often was a model invoked after deterministic work already succeeded?
- Did direct and model-presented versions preserve the same facts and rankings?
- Which requests created customer corrections or negative feedback?

The customer does not see internal model IDs, token counts, dollar cost, confidence thresholds or routing reasons.

## Contract 11 — Safety, confidentiality and tenant isolation

- Direct executors run server-side with tenant-scoped authorization.
- The browser cannot choose privileged tools or bypass coverage controls.
- Structured intent is validated again on the server even when generated by a model.
- Model output is never trusted as executable input without schema and authorization checks.
- Internal prompts, credentials, service-role keys and protected architecture details remain outside model-visible customer output.
- Conversation state, evidence and artifacts never cross workspaces.
- Idempotency prevents duplicate paid or deterministic execution.
- Existing confidentiality, evidence and responsible-use contracts remain in force on every path.

## Contract 12 — Acceptance criteria

This contract is implemented only when automated and representative QA proves all of the following.

### Routing

- Known suggested questions reach the correct deterministic capability without a model call.
- Supported free-text requests with unambiguous parameters can reach the deterministic fast path.
- Ambiguous requests use bounded extraction or ask a useful clarification.
- Open-ended interpretive requests still receive a grounded conversational response.
- Business components do not contain provider model IDs.

### Authority

- Direct and narrated results preserve identical facts, scores, ranks, methodology versions and limitations.
- The model cannot override a deterministic result silently.
- Missing MCP data cannot be replaced by model knowledge.
- Coordinates, dates and customer constraints are never fabricated.

### Experience

- The same composer supports every execution path.
- The customer can correct, refine and resume direct results naturally.
- Structured results remain readable on desktop and mobile.
- Progress states correspond to actual stages.
- A valid deterministic result remains available when optional narration fails.

### Economics and performance

- Per-stage latency and cost are recorded.
- Fast-path turns record zero model tokens.
- Blended normal-investigation cost meets the initial reduction target on representative QA.
- A common direct request is materially faster than its prior model-tool loop.
- Usage metering charges only actual model-backed work under the existing economic contract.

### Persistence and audit

- Direct operations update structured investigation state.
- The human-readable transcript preserves the complete interaction.
- Every result remains connected to evidence and methodology.
- Resuming a conversation does not require replaying the full provider chain.

## Current implementation truth at freeze

The deterministic backend foundation is substantially operational:

- MCP search, aggregation, coverage, assessment, ranking, planning and brief-preview capabilities exist;
- scoring and planning methodologies are versioned and explicit;
- model routing, usage metering and model-attempt telemetry exist;
- the shell preserves authenticated conversations and streamed responses.

The contract is **not yet implemented end to end** because:

- every submitted workspace message still invokes the OpenAI Responses API;
- the model currently selects and calls the MCP capability;
- no application dispatcher calls known deterministic capabilities directly;
- direct result presenters and structured investigation-state updates are not yet the default execution surface;
- telemetry does not yet classify all four execution paths.

This disclosure prevents the target architecture from being mistaken for current production behavior.

## Relationship to existing authority

This contract complements, and does not replace:

- [`product-delivery-shell-contract.md`](product-delivery-shell-contract.md) for the customer experience and product promise;
- [`conversational-context-management-contract-v1.md`](conversational-context-management-contract-v1.md) for memory and context budgets;
- [`market-ranking-contract.md`](market-ranking-contract.md) for deterministic market-priority authority;
- [`field-plan-and-brief-contract.md`](field-plan-and-brief-contract.md) for plans and artifacts;
- [`controlled-demo-coverage-contract.md`](controlled-demo-coverage-contract.md) for supported geography;
- [`trial-five-hour-usage-window-contract-v1.md`](trial-five-hour-usage-window-contract-v1.md) for customer-facing economic limits;
- [`LandingLight/docs/model-routing.md`](../LandingLight/docs/model-routing.md) for centralized provider-model configuration.

If a conflict arises:

- evidence-specific contracts govern factual semantics;
- this contract governs execution-path authority;
- the shell contract governs customer-facing delivery;
- context and metering contracts govern model context and economic authorization.

## Non-goals

This contract does not introduce:

- road routing or travel-time estimation;
- property-level damage confirmation;
- lead generation or sales qualification;
- a general-purpose weather dashboard;
- customer-authored executable code or raw MCP access;
- a requirement that every answer avoid models;
- a replacement for the conversation interface;
- new paid allowance products;
- automatic changes to scoring or ranking methodologies.

## Change control

The authority split, execution paths, conversational guarantee, fallback behavior and acceptance criteria are frozen for V1.

A material change requires an explicit contract revision when it would:

- give the model authority over deterministic facts or calculations;
- require customers to use structured commands instead of natural language;
- permit silent model substitution after backend failure;
- weaken evidence, coverage, confidentiality or tenant boundaries;
- change the four execution paths or their economic authority;
- remove the requirement to preserve valid deterministic work after narration failure.

Implementation thresholds, model pricing and routing aliases may be recalibrated from production evidence without reopening the product decision, provided that the governing authority and experience guarantees remain intact.
