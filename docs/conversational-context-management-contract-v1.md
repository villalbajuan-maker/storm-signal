# Storm Signal — Conversational Context Management Contract V1

**Status:** FROZEN V1 AUTHORITY
**Baseline date:** July 20, 2026
**Applies to:** authenticated conversations, OpenAI requests, MCP evidence, conversation memory, summaries, field plans, briefs, usage metering and model routing

## Decision

Storm Signal will preserve the full investigation for the customer without sending the full investigation back to the model on every turn.

The model receives only the smallest reliable working context required to continue the current task:

```text
product instructions
+ durable workspace facts
+ structured investigation memory
+ compact operational summary
+ recent conversational turns
+ evidence required for this request
+ current user message
```

Conversation persistence and model context are separate concerns:

- **Persistence** keeps the complete, human-readable record.
- **Context assembly** selects what the model needs now.

The product must not treat an indefinitely growing provider conversation chain as its memory architecture.

## Why this contract exists

Storm Signal's operating system is conversation. Continuity is part of the product promise: the user should not have to restate where the crew is, what market is under review, what evidence was found or what decision is pending.

Continuity, however, does not require replaying every prior word. Replaying full answers, tables and MCP results makes later questions progressively more expensive and can turn a simple clarification into one of the most costly operations in the investigation.

The first customer-like production session demonstrated this failure mode:

- six conversational responses accumulated from 2,213 to 25,561 input tokens per turn;
- prompt-cache reuse was zero;
- repeated long answers hit the response ceiling and created avoidable `continue` turns;
- the final short clarification inherited the cost of the entire prior chain;
- transcription and context growth together pushed a short work cycle above the intended economic envelope.

This contract treats context as a governed product resource, not an incidental provider behavior.

## Product intent

Context management must simultaneously preserve:

1. **Continuity:** Storm Signal remembers the facts and decisions that matter.
2. **Grounding:** recommendations remain connected to evidence.
3. **Economy:** old text is not repeatedly purchased without current value.
4. **Responsiveness:** short follow-ups remain short, fast operations.
5. **Auditability:** the complete original conversation remains available even after compaction.
6. **Honesty:** summarization never manufactures evidence, certainty or decisions.

The governing product principle is:

> Remember the work, not every repeated word.

---

## Contract 01 — Units of memory

Storm Signal maintains four distinct memory layers.

### A. Durable workspace memory

Facts that remain useful across investigations:

- company and crew profile;
- primary market;
- crew count and operational capacity;
- service type;
- ordinary operating geography;
- user-confirmed travel or deployment constraints;
- stable preferences for output and field planning.

Durable memory is explicit, structured and editable. The system must not promote a casual statement into durable memory when it is ambiguous, temporary or sensitive.

### B. Investigation memory

Facts that belong to one conversation:

- investigation objective;
- named geography and time window;
- hazards requested;
- areas considered;
- ranking criteria;
- evidence-backed findings;
- areas rejected and why;
- decisions already made;
- unresolved uncertainties;
- next intended action;
- artifacts generated.

Investigation memory survives sign-out and conversation resumption. It does not leak into unrelated conversations.

### C. Recent dialogue window

The most recent user and assistant turns preserve tone, references and immediate conversational continuity. This window is deliberately bounded. Old turns leave the active prompt after their meaning has been captured in structured memory or the operational summary.

### D. Evidence ledger

MCP results are retained as evidence references rather than repeatedly embedded as full prose or raw payloads. Each retained evidence item must carry enough identity to be retrieved or revalidated:

```text
source/tool
query or parameters
geography
observation window
retrieved_at
evidence identifiers
compact factual extract
coverage limitations
```

The evidence ledger is not a second narrative transcript. It is the traceable factual substrate supporting the investigation.

---

## Contract 02 — Canonical context package

Every model-backed request is assembled server-side into a canonical package. Business components request a capability; they do not construct arbitrary conversation history.

```text
ContextPackage
  product_contract
  current_time_and_market
  workspace_memory
  investigation_state
  operational_summary
  recent_turns
  relevant_evidence
  current_request
  output_contract
```

### Required properties

- deterministic ordering;
- explicit version;
- token estimate before provider invocation;
- source identifiers for every memory and evidence block;
- no duplicated content across blocks;
- no raw secrets, internal prompts or unrelated conversations;
- capability-specific output instructions;
- a recorded reason for every block included.

The complete database transcript is never the default context package.

## Contract 03 — Context budgets

V1 uses configurable budgets, not hardcoded values inside chat components.

Initial operating targets:

| Envelope | Target | V1 hard boundary |
| --- | ---: | ---: |
| Carried context before fresh MCP output | 6,000 tokens | 10,000 tokens |
| New MCP evidence supplied to the model | 4,000 tokens | 8,000 tokens |
| Total input for a normal conversational turn | 10,000 tokens | 16,000 tokens |
| Recent dialogue retained verbatim | 4 turns | 8 turns |

These are initial engineering boundaries subject to measured QA. They are not customer-facing quotas.

Crossing a target triggers compaction. Crossing a hard boundary prevents an unbounded request: the assembler must compact, retrieve less evidence, narrow the task or return a controlled error before invoking the provider.

A high-capacity model context window is not permission to consume it. Model capacity defines what is possible; the Storm Signal context budget defines what is economically and operationally appropriate.

## Contract 04 — Progressive compaction

Compaction happens incrementally, not only when the conversation is already oversized.

### Triggers

The system compacts when any of the following occurs:

- carried context exceeds its target;
- more than the recent-turn allowance would be sent;
- a completed evidence search produces a large payload;
- a market comparison or decision closes a subproblem;
- a field plan or brief is generated;
- the conversation changes geography, time window or objective;
- a model switch makes the existing provider chain unsuitable;
- a request is a short continuation whose inherited context is disproportionate.

### Compaction output

Compaction produces structured state, not a freeform replacement transcript:

```text
objective
crew_and_constraints
current_scope
confirmed_evidence
inferences
decisions
discarded_options
uncertainties
open_questions
next_action
evidence_references
```

### Invariants

Compaction must never:

- convert an inference into observed evidence;
- remove a material limitation;
- invent a location, time, severity or source;
- silently change a user constraint;
- erase an unresolved disagreement;
- delete the original transcript;
- make a generated artifact unauditable.

Each compaction records its source-message boundary, version, token counts and validation status.

## Contract 05 — Evidence selection and MCP behavior

Fresh MCP work is invoked only when the current request requires new or updated evidence.

### Reuse without a fresh MCP call

Examples:

- `Compare those two areas.`
- `Why did you rank Haskell first?`
- `Turn this into a field plan.`
- `Continue the answer.`
- `What did you mean by that limitation?`

These requests operate on established evidence unless the user explicitly asks for an update or the evidence is stale for the requested decision.

### Fresh evidence required

Examples:

- `Check what has happened since this morning.`
- `Refresh Haskell County.`
- `Find new hail reports in Texas.`
- `Now check Louisiana.`
- `Use the latest 24 hours instead.`

### Evidence payload control

The system should prefer bounded MCP responses, filtered fields and server-side normalization. Raw tool payloads are not repeatedly carried forward. If a tool cannot return a bounded result, Storm Signal stores the full payload server-side and supplies a factual extract plus references to the model.

## Contract 06 — Continuations, clarifications and incomplete responses

A continuation is not a new investigation.

For inputs such as `continue`, `what happened?`, `finish that`, or a clarification about the immediately preceding answer, the system must:

1. reuse the pending response state;
2. avoid a fresh MCP call unless required by missing evidence;
3. include only the unfinished portion and its minimum supporting context;
4. avoid restating the complete prior answer;
5. preserve the same evidence and uncertainty labels.

The product must distinguish:

- a response that concluded naturally;
- a response stopped by the user;
- a response truncated by an output boundary;
- a provider or tool failure;
- an allowance block.

If Storm Signal truncates its own response, it must say so and offer a deterministic continuation. It must not make the user infer that the investigation or allowance ended.

## Contract 07 — Model routing interaction

The context layer and model router are independent but coordinated.

- Context management decides **what information is required**.
- Model routing decides **which enabled model can reliably perform the capability**.
- Usage metering decides **whether the selected attempt may be economically authorized**.

Switching models does not reset product memory. It does reset or rebase provider-specific continuation state when necessary.

No model receives a larger context merely because it supports a larger window. Escalation to a stronger model must be justified by task complexity or quality risk, not by avoidable context accumulation.

## Contract 08 — Usage and economic accounting

Context-management operations must be visible in telemetry and included in economic evaluation.

If compaction uses a model, its provider cost is metered. Deterministic extraction and database updates are preferred when reliable. A compacting model should be the least expensive tier that passes structural validation.

For each operation, Storm Signal records:

```text
context_tokens_total
context_tokens_by_layer
new_evidence_tokens
recent_turn_tokens
summary_tokens
durable_memory_tokens
cached_input_tokens
tokens_removed_by_compaction
compaction_reason
provider_model
input_tokens
output_tokens
estimated_cost
```

The operational dashboard must make it possible to answer:

- Which conversations are growing fastest?
- Which tools return oversized payloads?
- Which turns paid again for unchanged evidence?
- Which clarifications were disproportionately expensive?
- Did compaction reduce cost without reducing answer quality?

## Contract 09 — Customer experience

Context management is normally invisible. The customer experiences continuity, not a memory-management interface.

The shell must:

- preserve the complete readable transcript;
- allow old messages to be copied and reviewed;
- resume investigations with their material context;
- avoid asking for facts already confirmed;
- allow the user to correct remembered constraints;
- distinguish `New conversation` from continuing the current investigation.

When a meaningful assumption comes from earlier memory, Storm Signal may state it briefly:

> Using Fort Worth as your base and four hours as your current travel limit…

This gives the user a natural opportunity to correct stale context without exposing implementation details.

## Contract 10 — Failure and recovery

If context assembly or compaction fails:

1. do not silently send the unbounded full transcript;
2. do not discard original messages;
3. do not issue a fresh MCP search merely to reconstruct known state;
4. retry with a deterministic smaller package when safe;
5. otherwise return a controlled recoverable error and preserve the draft.

If a summary fails validation, the previous valid memory version remains authoritative.

Provider response IDs are optimization handles, not the sole source of conversational memory. Losing or changing a response ID must not destroy the investigation.

## Contract 11 — Privacy and isolation

- Memory is scoped to workspace and conversation.
- Cross-workspace retrieval is prohibited.
- Durable memory promotion is auditable.
- Deleted conversations cannot remain active context sources.
- Context packages exclude secrets, authentication material and internal security instructions.
- Administrative audits may inspect token and routing metadata without requiring routine exposure of full customer content.

## Contract 12 — Acceptance criteria

Context management is ready for production enforcement only when automated and controlled QA proves:

1. a representative six-to-eight-turn investigation remains below the configured context boundary;
2. later clarifications do not grow linearly with the entire transcript;
3. established constraints survive compaction;
4. observed evidence, inference and uncertainty remain distinct;
5. contextual follow-ups do not invoke unnecessary MCP calls;
6. a new geography or fresh-time request does invoke the required MCP work;
7. model switching preserves product memory;
8. the full transcript remains readable after compaction;
9. incomplete responses continue without replaying the full investigation;
10. token and cost telemetry reconcile for every layer and operation;
11. an equivalent customer-like cycle costs materially less than the July 20 baseline without a material quality regression;
12. adversarial or malformed memory cannot cross workspace boundaries or override product instructions.

### Initial economic success measure

Using the audited Fort Worth–Haskell conversation as a replay fixture, the implementation must demonstrate:

- at least a 50% reduction in total conversational provider cost;
- no turn above the V1 normal hard context boundary unless explicitly classified as an exception;
- no avoidable `continue` turn caused by Storm Signal truncation;
- no loss of the crew profile, four-hour constraint, ranked market or evidence limitations.

This target measures the combined effect of model choice, compact context, evidence reuse and response control. A cheaper model alone does not satisfy the contract.

## Outside V1

This contract does not introduce:

- semantic search across every company conversation;
- autonomous long-term customer profiling;
- cross-customer learning;
- a customer-editable knowledge graph;
- unlimited context justified by a larger model window;
- deletion or rewriting of the original transcript;
- fabricated continuity when evidence is unavailable.

## Implementation boundary

The implementation should introduce one server-side context orchestration layer used by every conversational model call. UI components, API routes and MCP adapters must not independently assemble history.

The expected sequence is:

1. persist and version the structured memory schema;
2. build the deterministic context assembler and token estimator;
3. add progressive compaction and validation;
4. normalize and reference MCP evidence;
5. handle continuation and truncation states explicitly;
6. add context telemetry and administrative audit;
7. replay the Fort Worth–Haskell fixture with GPT-4.1;
8. compare cost, continuity, evidence fidelity and latency;
9. recalibrate the five-hour allowance only after this evidence exists.

## Change control

Material changes to memory scope, context boundaries, compaction invariants, evidence retention or cross-conversation reuse require an explicit contract revision.

Provider model names, token prices and numeric operating targets remain centralized configuration. Updating them does not change the product contract as long as continuity, evidence fidelity, isolation and economic acceptance criteria remain satisfied.

## Governing line

> The customer keeps the whole investigation. The model receives only what it needs to move the investigation forward.
