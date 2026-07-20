# Storm Signal — Shell Delivery Acceptance Matrix

**Status:** TRAMO 0 COMPLETE — IMPLEMENTATION GATE ACTIVE
**Baseline:** July 19, 2026
**Canonical contract:** [`product-delivery-shell-contract.md`](product-delivery-shell-contract.md)
**Current implementation audited:** `LandingLight/app/workspace`

## Purpose

This matrix translates the seven frozen product-delivery contracts into testable implementation requirements. It is the working gate for the shell delivery: a feature is not complete because it renders; it is complete when its customer promise, interaction, evidence boundary, mobile behavior and failure behavior satisfy this matrix.

This document also prevents prototype presentation from being confused with delivered capability.

## Status vocabulary

| Status | Meaning |
|---|---|
| `REAL` | Implemented end to end with the current product services. |
| `PARTIAL` | A useful implementation exists but does not yet satisfy the frozen contract. |
| `SIMULATED` | Intentionally represented with fixture data or local-only behavior and visibly treated as prototype behavior. |
| `PENDING` | Not implemented. The interface must not imply that it works. |
| `BLOCKED` | Cannot be completed until a named upstream contract or service exists. |

## Non-negotiable acceptance rules

1. No `SIMULATED`, `PENDING` or `BLOCKED` capability may be presented to customers as operational.
2. No shell output may imply confirmed property damage, available work, leads, insurance outcomes or revenue.
3. Facts, Storm Signal interpretation and operational recommendations remain distinguishable.
4. Missing or stale coverage is never interpreted as proof that no severe weather occurred.
5. Mobile acceptance is required for every primary workflow, not a later polish item.
6. A retry, reload, session expiry or connection failure must not silently duplicate work or destroy a draft.
7. The landing may promise only the experience that the production shell can deliver or clearly identify as upcoming.

## Current implementation snapshot

The current `/workspace` is a useful single-session prototype with a real OpenAI Responses API route and remote Storm Signal MCP connection when production variables are configured. It is not yet the contracted workspace shell.

### What is currently real

- Free-form text submission to the server route.
- OpenAI response generation when configured.
- Remote MCP availability to the model.
- Markdown and GFM rendering.
- Basic request-in-progress and recoverable-error presentation.
- Seven-day-trial copy.
- Single-column mobile conversation fallback.

### What is currently partial

- Conversation continuity exists only through an in-memory `previous_response_id`.
- Investigation activity is represented by one generic state.
- Evidence use is represented by one generic chip.
- Error handling is readable but has no retry/edit controls.
- Responsive CSS hides the sidebar but provides no mobile replacement.
- The current composer supports text but not growth, microphone, stop, drafts or offline recovery.

### What is currently misleading or structurally contrary to the frozen contract

- The sidebar uses `Find the signal`, `Rank the markets`, `Build the field plan` and `Share the brief` as workflow navigation. The anatomy contract explicitly reserves those as internal outcome names, not navigation.
- `New investigation` clears local state but does not create or persist an investigation.
- No login or tenant boundary precedes the workspace.
- `Signal workspace` is displayed without a real workspace entity.
- `7 days remaining` is static rather than account-derived.
- No right context surface exists.
- No conversations, artifacts or briefs persist.
- Automatic scroll always moves to the end and does not respect review position.

These elements may remain only during the local prototype and must be replaced before production acceptance.

---

## A. Purpose and commercial-promise matrix

| ID | Requirement | Current | Target acceptance | Owner surface |
|---|---|---:|---|---|
| P-01 | One conversation represents one field investigation. | `PARTIAL` | A persisted investigation has its own ID, title, context, messages and linked artifacts. | Shell + backend |
| P-02 | The shell answers “Where should we look next—and why?” | `PARTIAL` | A user can ask freely and receive evidence-grounded narrowing without choosing an internal workflow first. | Shell + LLM + MCP |
| P-03 | Work survives the session. | `PARTIAL` | Conversations and messages survive refresh and reauthentication; durable artifacts remain pending. | Backend + shell |
| P-04 | Evidence remains connected to the decision. | `PENDING` | Recommendations and artifacts retain source evidence, timestamps, criteria and limitations. | MCP + backend + shell |
| P-05 | The shell is not a weather dashboard or generic chat. | `PARTIAL` | The primary model is persistent investigations leading to decisions and artifacts. | Product + shell |
| P-06 | The four frozen outcomes are deliverable without internal jargon. | `PARTIAL` | The user can find evidence, compare markets, build a plan and share a brief through ordinary conversation. | Entire system |
| P-07 | Commercial limits remain honest. | `PARTIAL` | Property damage, work and revenue limitations appear near relevant decisions and in artifacts. | Landing + shell + artifacts |

## B. Anatomy matrix

| ID | Requirement | Current | Desktop acceptance | Mobile acceptance |
|---|---|---:|---|---|
| A-01 | Authenticated workspace precedes the shell. | `REAL` | Unauthenticated access redirects to login; success returns to intended workspace. | Same behavior without losing navigation intent. |
| A-02 | Left navigation represents workspace memory. | `PARTIAL` | Real recent searches and account are present; persisted briefs remain pending. | Available through an accessible drawer. |
| A-03 | Internal outcome modes are not primary navigation. | `REAL` | Workflow buttons are removed; capabilities are reached through conversation. | No mode tabs or hidden equivalent. |
| A-04 | Compact conversation header. | `PARTIAL` | Shows editable title, active market when available, update time and context control. | Shows title and essential controls without consuming conversation height. |
| A-05 | Conversation is the dominant surface. | `REAL` | Reading width is controlled; user and assistant hierarchy is clear; structured results fit naturally. | One-column reading with no horizontal dependency. |
| A-06 | New investigation is guided, not blank. | `REAL` | Uses frozen opening copy and several plain-language starting suggestions. | Suggestions remain tappable and do not crowd the composer. |
| A-07 | Composer is persistently accessible. | `PARTIAL` | Multiline growth, send, microphone, stop and saved draft; attachment remains absent until contracted. | Remains usable above the software keyboard and safe areas. |
| A-08 | Context panel is conditional. | `SIMULATED` | Closed when empty; opens for market, comparison, evidence, plan, brief or sources. | Opens as temporary panel or full-screen surface. |
| A-09 | Context and chat share one source of truth. | `SIMULATED` | Editing or regenerating an artifact updates every representation consistently. | Same artifact and version after opening/closing context. |
| A-10 | Brand is present but operationally quiet. | `REAL` | One workspace brand lockup; no repeated promotional header. | Symbol/title remain compact. |

## C. Conversational-cycle matrix

| ID | Requirement | Current | Acceptance signal |
|---|---|---:|---|
| C-01 | Ask in natural language. | `REAL` | Free-form requests are accepted without mandatory workflow selection. |
| C-02 | Reuse known context. | `PARTIAL` | Follow-up turns preserve explicit crew, distance, event and time constraints. |
| C-03 | Ask only for indispensable missing information. | `PARTIAL` | The assistant advances when responsible and asks one focused clarification otherwise. |
| C-04 | Communicate investigation activity in customer language. | `PARTIAL` | Activity identifies the kind of work without exposing tool names, payloads or hidden reasoning. |
| C-05 | First response narrows the search. | `PARTIAL` | Provides conclusion, supported options, primary rationale, uncertainty and a useful continuation. |
| C-06 | Refinement preserves context unless replaced. | `PARTIAL` | Changing one constraint does not silently reset unrelated constraints. |
| C-07 | Decision separates support, uncertainty and verification. | `PARTIAL` | Every recommendation explains why, confidence and what must be checked in the field. |
| C-08 | Decision can become an artifact. | `PENDING` | A user can turn supported analysis into a persisted plan or brief. |
| C-09 | Material objective change can create a new investigation. | `PENDING` | The user accepts or rejects the suggestion; content is never moved automatically. |
| C-10 | Every completed turn advances the work. | `PARTIAL` | The response narrows, improves a decision or produces a usable result. |

## D. State matrix

| ID | State | Current | Acceptance criteria |
|---|---|---:|---|
| S-01 | Workspace loading | `REAL` | Structural skeleton represents navigation, conversation and composer. |
| S-02 | First-use workspace | `REAL` | Frozen opening question, supporting copy, suggestions and ready composer. |
| S-03 | New investigation | `REAL` | Temporary title, empty context, focused composer and no inherited investigation context. |
| S-04 | Persisted investigation | `PENDING` | Restores title, update time, messages, context and artifacts. |
| S-05 | User drafting | `PARTIAL` | Multiline input, local draft persistence and speech entry when supported. |
| S-06 | Request submitted | `REAL` | User message appears immediately and activity follows. |
| S-07 | Understanding | `PENDING` | Used only when perceptible and helpful. |
| S-08 | Investigating | `PARTIAL` | Compact, comprehensible progress; cancel available; no technical logs. |
| S-09 | Needs information | `PARTIAL` | One focused question, free-text reply and optional quick answers; not styled as error. |
| S-10 | Responding / streaming | `PENDING` | Progressive stable output, stop action and controlled scroll. |
| S-11 | Response complete | `PARTIAL` | Conclusion, evidence, uncertainty and contextual next actions are visually distinct. |
| S-12 | Structured result | `PENDING` | Ranking, comparison or plan has responsive semantics and context-panel support. |
| S-13 | Brief ready | `PENDING` | Persisted artifact card shows title, market, date and working actions only. |
| S-14 | Insufficient evidence | `PENDING` | Explains search, coverage, limits and responsible refinement options. |
| S-15 | Partial result | `PENDING` | Useful output remains available; missing capability/source is explicit. |
| S-16 | Recoverable error | `PARTIAL` | Plain-language error plus working retry, edit or continue-partial actions. |
| S-17 | Offline | `PENDING` | Loaded work and drafts remain; sending pauses and resumes safely. |
| S-18 | Response stopped | `PENDING` | Partial text stays marked incomplete and composer returns. |
| S-19 | Context divergence | `PENDING` | New-investigation suggestion requires user confirmation. |
| S-20 | Archived / deleted | `PENDING` | Archive is reversible; delete confirms scope and artifact effect. |
| S-21 | Session expired | `PARTIAL` | The current composer draft and safe workspace return survive reauthentication; durable conversation position awaits persisted conversations. |

## E. Artifact matrix

| ID | Artifact capability | Current | Acceptance criteria |
|---|---|---:|---|
| R-01 | Conversational result | `PARTIAL` | Markdown, lists and tables remain readable, attributable and responsive. |
| R-02 | Market ranking | `PENDING` | Market, relative priority, component rationale, recency, distance, confidence and decision-change factors. |
| R-03 | Market comparison | `PENDING` | Common criteria, meaningful differences, uncertainty, best-supported option and alternatives without forced winner. |
| R-04 | Field plan | `PENDING` | Objective, starting area, sequence, rationale, verification, continue/change/stop signals, risks and time. |
| R-05 | Field brief | `PENDING` | Persisted title, market, crew context, decision, evidence, priorities, verification, limits, sources and freshness. |
| R-06 | Chat artifact card | `PENDING` | Compact summary opens the one canonical artifact. |
| R-07 | Context artifact view | `PENDING` | Review and request changes without duplicating artifact state. |
| R-08 | Field briefs library | `PENDING` | Recover by title, market, date, source conversation and update time. |
| R-09 | Version and stale state | `PENDING` | Last update is recorded; corrected evidence marks affected artifacts stale rather than rewriting silently. |
| R-10 | Shareable web view | `PENDING` | Revocable, artifact-specific view excludes workspace-private conversation data. |
| R-11 | PDF export | `PENDING` | Controlled template preserves evidence snapshot, timestamps, version and limitations. |
| R-12 | No fake actions | `PARTIAL` | Download, share and regenerate controls appear only when end-to-end behavior exists. |

## F. Trust, evidence and traceability matrix

| ID | Requirement | Current | Acceptance criteria |
|---|---|---:|---|
| T-01 | Separate fact, interpretation and recommendation. | `PARTIAL` | Each layer has stable semantics in responses and artifacts. |
| T-02 | Preserve source provenance. | `PARTIAL` | Source, type, location, event/report/retrieval time, identifier and status are retained when available. |
| T-03 | Progressive source disclosure. | `PENDING` | Clean answer summary opens into exact evidence details. |
| T-04 | Distinguish temporal meanings. | `PENDING` | Event, report, retrieval and artifact times cannot be confused. |
| T-05 | Approved confidence language. | `PENDING` | Strong, Moderate, Limited or Insufficient support includes a reason; no uncalibrated percentages. |
| T-06 | Disclose contradictions. | `PENDING` | Conflicting values/sources and their effect on the decision are visible. |
| T-07 | Distinguish missing evidence from no event. | `PARTIAL` | Empty results incorporate data health and use approved language. |
| T-08 | Handle corrections. | `PENDING` | Material corrections notify the user, mark artifacts stale and allow regeneration. |
| T-09 | Preserve decision inputs. | `PENDING` | Crew, origin, distance, window, event, exclusions and generation time are inspectable. |
| T-10 | Preserve user refinements. | `PENDING` | Material changes are associated with the investigation and resulting artifact. |
| T-11 | Hide private technical reasoning. | `REAL` | UI does not display prompts, tokens, credentials, payloads or chain of thought. |
| T-12 | Auditable system record. | `PARTIAL` | Requests, parameters, sources, results, artifacts, incomplete data and errors gain durable trace IDs/records. |
| T-13 | Limits near decisions. | `PARTIAL` | Specific verification caveat appears with the relevant recommendation, not only in legal copy. |

## G. Operational-behavior matrix

| ID | Requirement | Current | Acceptance criteria |
|---|---|---:|---|
| O-01 | Login before workspace. | `REAL` | Protected route, returning-user OTP and safe workspace return are verified end to end. |
| O-02 | Company workspace entity. | `REAL` | Conversations, artifacts, plan and members belong to a durable tenant. |
| O-03 | Tenant isolation. | `PARTIAL` | Workspace and chat entry are server-authorized and tenant tables use RLS; conversation/artifact integration remains pending. |
| O-04 | Reasonable session persistence. | `PARTIAL` | Supabase cookie session survives navigation; expiry recovery remains pending. |
| O-05 | Persistent conversations. | `PARTIAL` | Conversations, messages and OpenAI continuation context save automatically; artifact persistence remains pending. |
| O-06 | Clean new conversation. | `PARTIAL` | Stable workspace preferences may persist; investigation-specific context never leaks. |
| O-07 | Generated and editable titles. | `PARTIAL` | The first user intent creates a durable short title; rename remains pending. |
| O-08 | Search, archive and delete. | `PENDING` | Search by title/market; reversible archive; confirmed deletion. |
| O-09 | Per-conversation drafts. | `PARTIAL` | The current workspace composer survives reload and authentication expiry on the device; conversation-scoped and cross-device drafts await persisted conversations. |
| O-10 | One active execution per conversation. | `REAL` | Duplicate sends are blocked locally and workspace execution concurrency is reserved atomically on the server. |
| O-11 | Background conversation status. | `PENDING` | Working, finished, waiting and error appear in navigation. |
| O-12 | Idempotent retry and recovery. | `PARTIAL` | Chat execution keys are idempotent and stale reservations recover automatically; artifact idempotency awaits artifact generation. |
| O-13 | Respect reading position. | `REAL` | The transcript owns scroll, follows only near the bottom and provides `Jump to latest` without moving the shell or sidebar. |
| O-14 | Seven-day trial from real access. | `PARTIAL` | Activation and server-derived seven-day access are real; remaining-time UX and paid transition remain pending. |
| O-15 | Understandable use limits. | `REAL` | Daily availability is visible in customer language and limit responses never expose token, provider or cost terminology. |
| O-16 | Owner and Member roles. | `PARTIAL` | Membership and role resolution are real; role-specific management actions remain pending. |
| O-17 | Internal attribution. | `PENDING` | Creator/updater and time appear on shared workspace artifacts. |
| O-18 | Revocable external artifact share. | `PENDING` | Share grants only artifact access and can be revoked. |
| O-19 | Accessibility. | `PARTIAL` | Keyboard, screen reader, zoom, contrast and reduced motion pass defined checks. |
| O-20 | Immediate perceived response. | `PARTIAL` | Local actions update immediately; remote work shows bounded activity. |

### Authentication steps 5–6 completion record

On July 19, 2026, protected workspace entry and returning-user login were verified against the linked Storm Signal Supabase project:

- unauthenticated `/workspace` requests redirect to `/login` with a bounded same-origin return target;
- `/api/chat` rejects requests without an authenticated member and active entitlement;
- authenticated workspace rendering resolves the real company, primary market, membership role and trial period through RLS;
- sign-out clears the Supabase session and returning login sends a new OTP with `shouldCreateUser: false`;
- successful returning verification reopens the existing workspace without executing `activate_trial`;
- the end-to-end reentry test retained exactly one workspace, one membership, one entitlement and one initial conversation.

### Authentication step 7 completion record

On July 19, 2026, the authentication and trial recovery layer was completed for the current prototype boundary:

- expired or invalid OTP attempts remain on the verification surface with a plain-language recovery path and working resend action;
- a partially completed activation can resume from an already verified Supabase session instead of forcing a second verification;
- login return targets are restricted to same-origin application paths;
- authenticated users who lack a workspace return to `/start` with an explicit recovery notice;
- expired entitlements are enforced server-side and route to the dedicated trial-expired surface;
- a device-local composer draft is restored after reload or authentication expiry, then cleared after a successful submission or a deliberate new investigation;
- migration `20260719263000_prevent_duplicate_trials.sql` adds an immutable per-user trial claim and transaction locking, preventing repeated activation from creating another free trial, workspace or starter conversation.

This step does not claim durable conversation recovery: persisted messages, scroll position and cross-device drafts remain part of the conversation-persistence tranche.

---

## Desktop acceptance suite

The desktop shell is accepted only when a reviewer can complete this scenario without hidden setup knowledge:

1. Log in and enter the correct company workspace.
2. Understand the first-use invitation without seeing internal workflow terminology.
3. Start a free-form investigation from crew location and travel limit.
4. See the sent message immediately and understand what Storm Signal is doing.
5. Receive a response that distinguishes conclusion, evidence, uncertainty and next move.
6. Refine one constraint without losing unrelated context.
7. Open evidence details and verify source and time semantics.
8. Turn a supported option into a field plan.
9. Create and open a persisted field brief.
10. Change conversations and return without losing messages, artifacts, scroll position or draft.
11. Open the conditional context panel and confirm it represents the same artifact.
12. Trigger insufficient-evidence and recoverable-error cases and continue successfully.
13. Archive and restore a conversation.
14. Sign out and sign back in; confirm workspace isolation and persistence.

## Mobile acceptance suite

The mobile shell is accepted only when the same primary work can be completed at a phone viewport:

1. Log in and reach the workspace without horizontal overflow.
2. Open recent investigations through a drawer and return to the active conversation.
3. Start an investigation using free text or microphone.
4. Use the composer while the software keyboard is open.
5. Read streamed and completed responses without forced horizontal tables.
6. Review earlier content while a response completes without being dragged downward.
7. Use `Jump to latest` to return to the active turn.
8. Open ranking, comparison, plan and brief as vertical surfaces.
9. Open and close context without losing conversation position.
10. Switch conversations and recover each draft.
11. Stop, retry and recover from offline state without duplicate messages.
12. Complete every touch action with adequate target size and visible focus/feedback.

## Prototype-data policy

During visual development, fixtures are allowed for conversations, rankings, plans, evidence and briefs only when:

- the data lives in a clearly named prototype fixture layer;
- the scenario is realistic and consistent across surfaces;
- no fixture is silently returned by the production API;
- the preview is identified internally as simulated;
- acceptance distinguishes visual completion from end-to-end completion.

The final integration removes or isolates every fixture before a capability becomes `REAL`.

## Tramo gates

| Tramo | Gate to close |
|---|---|
| 0 — Matrix | Every frozen contract is represented by a status, target and acceptance test. |
| 1 — Workspace skeleton | A-02 through A-10 meet visual and responsive acceptance using honest fixtures. |
| 2 — Entry and orientation | A-01, A-06 and S-01 through S-04 meet the contract. |
| 3 — Workspace memory | P-01, P-03 and O-02 through O-09 meet prototype or real persistence acceptance as declared. |
| 4 — Conversation | C-01 through C-10 and S-05 through S-11 meet visual interaction acceptance. |
| 5 — States and recovery | S-12 through S-21 and O-10 through O-13 meet failure/recovery acceptance. |
| 6 — Structured results | R-01 through R-04 and T-01 through T-07 meet evidence-aware responsive acceptance. |
| 7 — Plans and briefs | R-05 through R-12 and T-08 through T-13 meet persistence and artifact acceptance. |
| 8 — Responsive refinement | The complete mobile acceptance suite passes; accessibility is no longer partial. |
| 9 — Real integration | Auth, tenancy, persistence, MCP, deterministic services and artifact generation replace fixtures; promised capabilities are `REAL`. |

## Tramo 1 completion record

The workspace skeleton was implemented in `LandingLight/app/workspace` on July 19, 2026:

- internal outcome workflows were removed from navigation;
- workspace-memory navigation replaced them;
- recent investigations and Field briefs are visibly marked prototype fixtures and cannot masquerade as persisted data;
- conversation became the dominant surface;
- the header now carries investigation title, update context and conditional context access;
- the frozen first-use question and plain-language starters were applied;
- the composer supports multiline growth and a real stop action;
- a conditional context panel was introduced from the same active conversation state;
- mobile now has working navigation and context overlays instead of simply hiding both surfaces;
- reduced-motion behavior is preserved.

Persistence, editable saved titles, artifact state and real workspace identity remain assigned to their later tramos. Tramo 1 closes the structural and responsive skeleton without representing those later capabilities as delivered.

## Tramo 2 completion record

Entry and orientation were implemented on July 19, 2026:

- `/login` now precedes returning-user workspace entry from the commercial landing;
- the login surface speaks in workspace and crew language rather than technical authentication language;
- prototype access is explicitly disclosed and does not claim that an account or secure session has been created;
- trial onboarding continues through `/start` and carries company and primary-market orientation into the local workspace;
- the first-use workspace uses the frozen opening question and adapts starter prompts to the selected primary market when available;
- a structural workspace-loading state covers navigation, conversation and composer on desktop and mobile;
- new-conversation reset clears investigation-specific state and leaves the context panel closed;
- the production requirement for protected routing and server-authenticated tenancy remains `PENDING` for Tramo 9.

Tramo 2 therefore closes the visual and copy contract for entry and orientation while keeping authentication status honestly classified as `SIMULATED`.

## Authorization wireframe and schema record

On July 19, 2026, the frozen V1 authorization contract was translated into implementation artifacts without claiming real authentication:

- `/start` creates a local pending onboarding intent and continues to `/verify`;
- `/verify` provides the six-digit code, resend timer, change-email path and activation transition as a functional local wireframe;
- `/workspace/expired` demonstrates retained work, blocked creation and plan selection after trial expiration;
- `supabase/migrations/20260719262000_create_workspace_trial_authorization.sql` defines the intended tenant, entitlement, metering and persistence boundary, including RLS and atomic trial activation.

These browser surfaces remain `SIMULATED`. The migration was applied to the linked Storm Signal Supabase project on July 19, 2026, but the production requirements under O-01 through O-14 remain pending or simulated exactly as listed in the matrix. Auth/SMTP integration and adversarial RLS tests with real authenticated users are required before the end-to-end authorization capability can be relabeled `REAL`.

## Tramo 0 completion record

Tramo 0 is complete when this document:

- maps all seven frozen contracts;
- identifies the current implementation truth;
- names misleading prototype elements that must be replaced;
- defines desktop and mobile end-to-end acceptance;
- separates real, partial, simulated, pending and blocked capability;
- provides a gate for each remaining delivery tramo.

Those conditions are satisfied as of the baseline above. Implementation may proceed to Tramo 1 without reopening any frozen contract.
