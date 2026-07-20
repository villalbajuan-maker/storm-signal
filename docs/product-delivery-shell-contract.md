# Storm Signal — Product Delivery and Shell Contract

**Status:** ACTIVE PRODUCT AUTHORITY — SEVEN BLOCKS FROZEN
**Baseline date:** July 19, 2026
**Applies to:** commercial landing, authentication, workspace shell, conversational orchestration, MCP, backend services, ingestors, evidence model and generated artifacts

## Why this document exists

The shell is not merely the visual container around a chat. It is the product surface where Storm Signal's commercial promise is delivered, inspected, refined, preserved and shared.

The landing creates the expectation. The shell receives the work. The LLM organizes the conversation. The MCP and backend supply controlled capabilities. The ingestors and evidence model determine what can honestly be known. The artifact system preserves the result. These are not separate promises.

This document is the canonical contract joining those surfaces. It governs:

- what the customer is promised;
- how work is organized and experienced;
- what evidence and explanations must accompany a decision;
- what the technical system must support to fulfill the experience;
- what Storm Signal must never imply.

The shell is the table where the product is served: the conversation, evidence, decisions and deliverables must arrive there with consistent structure, provenance, language and limits.

## Product promise carried by the shell

Storm Signal helps roofing and restoration crews investigate severe-weather evidence, decide which markets are worth checking, organize the next field move and leave with a result the company can keep and share.

The initial commercial outcomes remain:

1. **Find the signal.**
2. **Rank the markets.**
3. **Build the field plan.**
4. **Share the brief.**

Customer-facing language should translate those internal outcomes into direct crew value:

- See where the evidence is strongest.
- Know which market to check first.
- Put the crew on a plan.
- Send everyone the same page.

Storm Signal does not promise property-level damage, available work, leads, contracts, insurance coverage, payments or revenue.

---

## Contract 01 — Purpose of the shell

### Definition

The shell is the workspace where a crew investigates markets, preserves the context of its decisions and turns a conversation into something it can execute.

It is not merely a chat window and it is not a weather dashboard.

> It is the crew's base of operations before the next drive.

### Primary job

The shell helps the user answer:

> Where should we look next—and why?

It must support the path from an open question to a better-supported next move: what to review, what to discard, what remains uncertain and what the crew should verify.

### Required capabilities of the experience

The user can:

- begin a new investigation;
- resume a previous investigation;
- work in natural language;
- keep each market or decision in its own context;
- inspect the results produced during the conversation;
- preserve plans and briefs for field use.

### Unit of work

A message is not the unit of work. A weather report is not the unit of work.

> One conversation represents one field investigation.

An investigation may begin with:

> Show me recent hail and wind reports in North Texas.

It may mature into:

> Build a field plan for Wichita and give me a brief I can send to the crew.

### Promise of the shell

> Start with where your crew is. Leave with a better-supported next move.

### Frozen principles

1. **Conversation first.** The principal way to work is to ask, clarify and decide through conversation.
2. **Every conversation keeps its context.** The crew should not repeat known constraints when resuming an investigation.
3. **Evidence stays connected to the decision.** Results remain attached to the conversation and evidence that produced them.
4. **Work survives the session.** Investigations, decisions and briefs can be resumed.
5. **The interface reduces uncertainty, not responsibility.** The final field decision remains with the user.

### Outside the purpose

The shell is not a CRM, claims platform, canvassing system, lead marketplace, property-damage confirmation system or general-purpose weather dashboard.

### Governing line

> A working conversation that helps your crew decide where the next mile is worth driving.

---

## Contract 02 — Anatomy of the shell

### Base structure

The authenticated workspace has three surfaces:

```text
┌──────────────┬──────────────────────────────────────┬───────────────┐
│ Workspace    │ Active conversation                  │ Context       │
│              │                                      │               │
│ New chat     │ Investigation header                 │ Market        │
│ Recent work  │ Messages and results                 │ Evidence      │
│ Field briefs │                                      │ Plan / Brief  │
│ Account      │ Composer                             │               │
└──────────────┴──────────────────────────────────────┴───────────────┘
```

The conversation owns the largest and highest-priority surface. Side panels orient and preserve the work without competing with it.

### Left navigation: workspace memory

The left navigation contains:

- Storm Signal symbol and wordmark;
- `New conversation`;
- recent conversations;
- `Field briefs`;
- company or crew identity;
- account and sign-out access.

It must not expose internal capability names such as Find the Signal or Rank the Market as navigation. The user reaches those capabilities by conversing.

### Conversation header

The compact, persistent header contains:

- editable investigation title;
- active market or location when one exists;
- last-updated time;
- context-panel control;
- secondary actions.

It does not repeat promotional navigation or the primary brand lockup.

### Conversation surface

The main surface contains:

- complete investigation history;
- crew questions;
- Storm Signal responses;
- structured results inside the flow;
- a controlled reading width and generous spacing.

User prompts may use a lightly differentiated surface. Storm Signal responses remain open and readable rather than turning every answer into a card.

### Empty and new-investigation anatomy

The workspace never opens as an unexplained blank box.

Primary copy:

> Where should we look first?

Supporting copy:

> Tell us what kind of storm work you're looking for. We'll check the recent weather, show you which areas stand out, and help you plan what to check next.

Suggested starts may include:

- Show me recent hail and wind reports in my primary market.
- Which areas have the strongest evidence from the last 48 hours?
- Help me compare two areas I'm considering.
- Continue a previous plan when saved context exists.

Suggestions assist entry; they do not constrain free-form input. They remain visually secondary, adapt only from verified workspace context and supported capabilities, and fill the composer for editing rather than submitting automatically.

### Composer

The composer remains accessible at the bottom and includes:

- multiline text input;
- send action;
- microphone;
- stop action while responding;
- attachments only after supported file contracts are defined.

In the empty state, the composer is the visual center of the workspace. After the first message, the welcome surface disappears, the transcript becomes the primary surface and the composer remains anchored at the bottom.

Placeholder:

> Ask about a storm, an area, or what to check next…

Persistent note:

> You make the call. Verify final conditions in the field.

### Right context panel

The right panel is conditional and never appears as an empty dashboard. It may hold:

- active market;
- market comparison;
- relevant evidence;
- field plan;
- generated brief;
- consulted sources.

It is a second view of the same work, not an independent source of truth.

### Responsive contract

Mobile is a primary surface:

- conversation occupies the screen;
- workspace navigation opens as a drawer;
- context opens as a temporary panel or full-screen surface;
- composer remains accessible above the keyboard;
- structured results become vertical;
- conversation content never depends on a two-column layout.

### Governing line

> One workspace. One active conversation. Context appears only when it helps the next decision.

---

## Contract 03 — Conversational cycle

The cycle defines how a question becomes a useful decision without prescribing specific MCP tools.

```text
Ask
  ↓
Understand
  ↓
Investigate
  ↓
Narrow the options
  ↓
Refine
  ↓
Decide
  ↓
Build something usable
  ↓
Continue or start a new investigation
```

### Ask

The user begins a new investigation or resumes an existing one in natural language.

### Understand

Storm Signal identifies available context such as crew location, travel limit, event type, time window and objective. It asks only for information required to make the next useful move. If it can advance responsibly, it advances.

### Investigate

The system uses available capabilities and communicates activity in human language:

- Checking recent severe-weather reports…
- Comparing markets inside your drive limit…
- Looking for stronger and more recent evidence…

It does not expose tool names, payloads, tokens, system instructions or private reasoning.

### Narrow

The first useful response reduces the search space. It should contain a concise conclusion, the strongest options, the principal reason for each, relevant uncertainty and a concrete continuation.

### Refine

The user can change distance, time window, event type, exclusions, priorities and comparison criteria. Existing context persists unless explicitly replaced.

### Decide

Storm Signal distinguishes the best-supported option, why it is supported, what uncertainty remains and what must be verified. A recommendation is never presented as confirmation of damage or available work.

### Build

The user can turn the decision into a market comparison, field plan, checklist, route sequence or shareable brief, limited by implemented capabilities.

### Continue

The investigation remains open for adjustment, new evidence or another version. A materially different objective may be moved into a new conversation only with user control.

### Frozen rules

1. Do not ask for context already known.
2. Do not interrogate when useful progress is possible.
3. Do not deliver data without explaining its relevance.
4. Do not present inference as fact.
5. Keep evidence, decision and result connected.
6. End with a useful continuation rather than a dead end.
7. Let the user correct or redirect the work at any time.

### Governing line

> Every turn should narrow the search, improve the decision, or produce something the crew can use.

---

## Contract 04 — Shell states

The shell must always make clear whether Storm Signal is ready, working, waiting, finished or unable to continue.

### Required state families

| State | Required behavior |
|---|---|
| Workspace loading | Show the workspace skeleton, not a blank screen or isolated spinner. |
| First use | Present the guided starting question and an active composer. |
| New investigation | Use a temporary title, no empty context panel and a focused composer. |
| Persisted investigation | Restore title, messages, context, artifacts and last-updated information. |
| User drafting | Grow the composer, preserve the draft and support multiline input and speech. |
| Request submitted | Place the user message immediately and show that Storm Signal received it. |
| Understanding | Briefly indicate interpretation only when this phase is meaningful. |
| Investigating | Show human-readable activity without technical logs. |
| Needs information | Ask one concrete question when possible; do not present it as an error. |
| Responding | Stream legibly, avoid layout jumps and allow stop. |
| Complete | Separate conclusion, evidence, uncertainty and next actions. |
| Structured result | Render rankings, comparisons, plans or briefs in chat and optionally context. |
| Brief ready | Show title, market, date and only actions that really work. |
| Insufficient evidence | Explain what was checked, why the conclusion is weak and how to refine. |
| Partial result | Preserve useful output and identify the missing source or capability. |
| Recoverable error | Explain what failed in plain language and offer retry, edit or partial continuation. |
| Offline | Keep loaded work and drafts visible; suspend sending until reconnected. |
| Stopped response | Preserve partial output, label it incomplete and restore the composer. |
| Context divergence | Suggest a new investigation without moving content automatically. |
| Archived / deleted | Archive reversibly; confirm deletion and explain artifact impact. |

### State language

The interface may say what it is doing—checking reports, comparing markets, preparing a brief—but must not expose provider errors, stack traces, MCP payloads or hidden reasoning.

### Governing line

> The user should always know whether Storm Signal is ready, working, waiting, finished, or unable to continue—and what they can do next.

---

## Contract 05 — Artifacts and work results

The conversation is where the user investigates and refines. An artifact is a stable expression of a result worth preserving.

> A response helps the crew think. An artifact leaves the work organized for later use.

### Result classes

**Conversational results** remain in the thread: short lists, summaries, preliminary rankings, quick comparisons, explanations and suggested continuations.

**Persistent artifacts** have a name, date, context and independent presence in the workspace:

- market ranking;
- market comparison;
- field plan;
- field brief.

### Market ranking

A ranking includes market, relative position, principal rationale, evidence recency, relevant event type and intensity, travel distance or time when applicable, confidence and factors that could change the order. It must explain the ranking rather than expose an opaque score.

### Market comparison

A comparison applies consistent dimensions across options: recency, severity, evidence concentration, distance, crew fit, evidence quality, uncertainty and operational risk. It should identify the best-supported option, strong alternatives and what could change the call. It must not manufacture a winner when evidence is effectively tied.

### Field plan

A field plan may include objective, starting area, suggested sequence, rationale, field-verification questions, continue/change/stop signals, risks, uncertainty, crew checklist and generation time. It organizes an investigation; it does not guarantee work.

### Field brief

The field brief is the primary preserved and shareable deliverable. It should answer:

- Where are we going?
- Why are we checking it?
- What should we verify?
- What would make us change course?

Its structure includes title, market and date, crew context, principal decision, supporting evidence, field priorities, verification items, decision-change factors, limits, sources and update time.

### Artifact surfaces

Artifacts first appear as compact cards in the conversation. They can open in the context panel or a full view. Chat, context and full view represent the same artifact and version.

The `Field briefs` library offers simple recovery by title, market, date, source conversation and last update. It is not initially a complex document-management system.

### Export and sharing

Priority formats are a shareable web view and PDF. Other formats appear only when implemented. A shared artifact does not expose the complete conversation, private reasoning, credentials or workspace-private content.

### Temporal contract

Every artifact states when it was generated, the latest evidence time it includes and whether it has been updated or made stale by new evidence.

### Confidence language

Approved labels are:

- `Strong support`
- `Moderate support`
- `Limited evidence`
- `Insufficient evidence`

They describe support for the conclusion, not probability of damage or revenue.

### Governing line

> Every saved artifact must preserve the evidence, explain the decision, and help the crew act without overstating what Storm Signal knows.

---

## Contract 06 — Trust, evidence and traceability

Trust comes from making the basis and limits of a decision inspectable, not from sounding certain.

### Three information layers

Storm Signal must distinguish:

1. **Reported fact:** information retrieved from a source, retaining source, place and time.
2. **Interpretation:** a Storm Signal analysis constructed from facts.
3. **Operational recommendation:** a proposed next move based on evidence and crew constraints.

An inference or recommendation must never be styled as a reported fact.

### Evidence provenance

Relevant evidence preserves, when available:

- source and report type;
- location;
- event time and report time;
- retrieval time;
- original unit or measurement;
- reference identifier or link;
- preliminary, corrected or confirmed status;
- presentation transformations.

The response remains readable; complete provenance opens progressively through evidence details.

### Recency

The product distinguishes event time, report time, retrieval time and artifact-generation time. Old results must not look real-time.

### Confidence

Confidence describes evidence support and may consider independent reports, consistency, geographic precision, recency, intensity, report quality, coverage and missing-data penalties. Percentages are prohibited until a calibrated model supports them.

### Contradictions and missing evidence

Conflicting sources must be disclosed with their effect on the conclusion. The system must distinguish:

- evidence of absence;
- absence of evidence;
- incomplete coverage;
- unavailable source.

Approved language:

> I didn't find enough recent evidence to support that conclusion.

Prohibited implication:

> Nothing happened there.

### Corrections

Material source corrections trigger a visible notice, stale status for affected artifacts and an option to regenerate. Previous results are not rewritten silently.

### Decision trace

A persisted result preserves inputs such as crew, starting point, travel limit, time window, event type, exclusions and generation time. User refinements remain traceable without turning the chat into a technical log.

### Transparency boundary

The user can inspect evidence, sources, timestamps, criteria and limitations. The product does not expose system instructions, private chain of thought, credentials, tool payloads or infrastructure logs.

### Auditability

Within the applicable privacy policy, the system records the request, applied parameters, consulted sources, received results, delivered response, generated artifacts, incomplete data, errors and material changes.

### Governing line

> Show the evidence, separate fact from interpretation, make uncertainty visible, and preserve how the decision was reached.

---

## Contract 07 — Operational behavior

### Identity and workspace

Authentication precedes the shell. The primary ownership boundary is the company workspace, not the browser or individual conversation. Architecture must permit multiple authorized members even if the first release begins with one user per company.

Workspaces are strictly isolated. Manipulating a URL or identifier must never expose another company's conversations, artifacts or configuration.

### Session and recovery

Sessions should persist reasonably on trusted devices. Expiration, refresh, navigation, disconnection or browser closure must not silently destroy loaded work or composer drafts. After reauthentication, the user returns to the relevant point.

### Conversation persistence

Conversations save automatically and preserve title, creation time, update time, messages, investigation context, artifacts and archive status. The user does not depend on a manual Save action.

A new conversation starts a clean investigation. It may inherit stable workspace preferences but not the market, window, ranking or decision from a previous investigation.

### Titles and recovery

The system proposes short titles after understanding the initial objective. Users can rename, search, archive and delete conversations. Archive is reversible. Delete requires confirmation and explains artifact consequences.

### Drafts and concurrency

Each conversation preserves its own unsent draft. The first release permits one active execution per conversation. Duplicate submissions and duplicate retry results must be prevented.

Users may move between conversations while work continues when supported. Navigation indicates working, finished, waiting or error states.

### Interruption and retry

After interruption, the shell recovers the known request state and result when possible. Retry preserves the original request, explains whether all or part of the investigation is repeated and avoids silent duplication.

### Mobile operations

Mobile preserves the full work model: conversation-first layout, navigation drawer, temporary context surface, keyboard-safe composer, retained drafts, vertical results, sufficient touch targets and stable reading position.

### Scroll behavior

Existing conversations open at the last relevant point. New output does not force the user to the bottom while reviewing history; `Jump to latest` restores the live position.

### Trial and plan behavior

The seven-day trial begins when the customer receives real workspace access. It must demonstrate the complete primary promise rather than a simulation. Remaining time and the effect of trial expiration are stated clearly. Conversations and briefs are not destroyed without notice.

Commercial limits are expressed in customer language, never as token or provider quotas.

### Roles and sharing

The architecture supports at least `Owner` and `Member`. Workspace members may access authorized internal work. External sharing is artifact-specific, revocable and never grants access to the entire workspace or conversation by default.

### Privacy and accessibility

The shell asks only for necessary information and warns against unnecessary customer, claim, credential, financial or other sensitive data. Attachments remain disabled until file, retention and privacy contracts exist.

Keyboard operation, screen-reader semantics, zoom, contrast and reduced-motion preferences are mandatory. Meaning cannot depend only on color.

### Initial operational scope

The first operational release includes:

- login;
- one company workspace;
- persistent conversations;
- one active execution per conversation;
- recent history and search;
- editable titles;
- preserved drafts;
- linked artifacts;
- archive and confirmed deletion;
- primary mobile experience;
- basic error recovery;
- seven-day trial;
- understandable use limits.

Deferred until justified:

- granular permissions;
- external notifications;
- complete artifact version history;
- folders and tags;
- CRM integrations;
- simultaneous real-time collaboration;
- advanced attachments.

### Governing line

> The workspace should preserve the crew's work, recover gracefully from interruptions, and make every important action understandable and reversible.

---

## Cross-system fulfillment matrix

This matrix converts the experience contract into obligations across the product.

| Surface | Must deliver | Must not do |
|---|---|---|
| Commercial landing | Promise the four outcomes in crew language; explain the seven-day trial; set honest limits. | Sell technology, imply property damage, jobs or revenue, or demonstrate capabilities the product cannot deliver. |
| Authentication and workspace | Protect company boundaries; restore the correct workspace and work state. | Expose another tenant, destroy drafts on session expiry or drop the user into an unexplained blank chat. |
| Shell | Organize persistent investigations, show activity and uncertainty, preserve context, expose artifacts and recovery actions. | Become a weather dashboard, technical console or generic stateless chat box. |
| LLM orchestration | Understand intent, request only necessary context, select capabilities, explain results and preserve the fact/interpretation/recommendation boundary. | Invent evidence, improvise deterministic scores, expose private reasoning or overstate conclusions. |
| MCP | Provide explicit, bounded, structured capabilities with provenance, timestamps, limitations, data health and stable schemas. | Return ambiguous claims, conceal missing coverage or treat absence of results as absence of weather. |
| Backend services | Own deterministic ranking inputs, workspace isolation, persistence, permissions, artifact state and reproducible operations. | Delegate security, tenancy, scoring or validation to prompt behavior alone. |
| Ingestors and evidence model | Preserve raw provenance, source identity, corrections, evidence class, event/report/retrieval times, geographic lineage and health. | Collapse warnings, observations, forecasts, historical records and derived inference into one impact claim. |
| Artifact generation | Produce controlled, timestamped, source-linked, versioned and shareable results with limitations. | Produce a polished document whose certainty exceeds its evidence or expose workspace-private conversation data. |

## Acceptance test for any proposed feature

Before entering the initial product, a feature must answer:

1. Which frozen outcome does it strengthen?
2. Which shell contract block requires it?
3. What customer decision or preserved result improves?
4. What deterministic data or backend capability supports it?
5. How are evidence, recency, confidence and limitations represented?
6. What happens on mobile, interruption, retry and insufficient evidence?
7. Does the landing promise it? If so, can the delivered product prove it now?

If those questions cannot be answered, the feature remains outside the frozen initial scope.

## Authority and change control

The seven contract blocks in this document are frozen. A change must explicitly identify:

- the block being reopened;
- the customer value gained;
- the commercial copy affected;
- the shell and artifact behavior affected;
- the MCP, backend, ingestion or evidence obligations introduced;
- the new risk of overstating what Storm Signal knows.

This document governs the delivery experience. The ordered implementation roadmap remains in [`product-commercial-roadmap.md`](product-commercial-roadmap.md). Evidence and geographic details remain governed by the geospatial contracts. Where implementation is incomplete, the interface and landing must communicate the current truth rather than silently weakening this contract.

Implementation status and acceptance are tracked in the companion [`Shell Delivery Acceptance Matrix`](shell-delivery-acceptance-matrix.md). That matrix may change as work is delivered; the seven frozen blocks in this document do not change with implementation status.

V1 identity, passwordless activation, tenant authorization, seven-day entitlement and usage-control decisions are frozen in the [`Authentication, Trial and Authorization Contract V1`](auth-trial-authorization-contract-v1.md).
