# Storm Signal — Five-Hour Trial Usage Window Contract V1

**Status:** FROZEN V1 AUTHORITY
**Baseline date:** July 20, 2026
**Applies to:** seven-day trial usage, OpenAI execution metering, workspace limits, warning states, exhausted states and trial conversion surfaces

## Decision

Storm Signal replaces the trial's customer-facing daily allowance of 25 investigations with a cost-governed usage window lasting five hours.

The window begins with the first accepted model-backed operation. Its closing time is fixed at that moment and does not move when the user sends another message or exhausts the allowance.

The customer sees understandable usage and availability language. Tokens, provider pricing and internal model tiers remain operational details.

## Product intent

The allowance is an economic protection, not a prescribed way to use Storm Signal and not a mechanism for manufacturing scarcity.

Storm Signal is not designed for indefinite recreational chat. Its normal unit of use is a bounded work cycle in which a roofing or restoration crew:

1. checks recent evidence;
2. identifies areas that stand out;
3. compares or filters those areas;
4. decides what is worth checking next;
5. prepares a field plan or brief when needed.

One window must let a normal user complete this product promise comfortably and with reasonable room for follow-up questions. A policy that routinely interrupts this arc is incorrectly calibrated even if it satisfies an abstract cost formula.

For expected customers, usage should normally remain well below exhaustion. The limit exists to contain exceptional, automated, abusive or substantially out-of-pattern consumption while preserving the product's commercial margin.

## Canonical behavior

```text
First accepted operation at 7:50 PM
              ↓
Window opens: 7:50 PM–12:50 AM
              ↓
Usage is metered against the window budget
              ↓
90% consumed → warning, product remains available
              ↓
100% consumed → new model-backed operations are blocked
              ↓
12:50 AM → window closes and access may resume
              ↓
The next accepted operation opens a new five-hour window
```

If the allowance is exhausted at 9:15 PM, access still returns at 12:50 AM. Exhaustion never starts a new five-hour countdown.

If a window closes with unused allowance, the balance expires. It is not carried into the next window.

If the user does not return after a window closes, no new window exists and no allowance is consumed. The next window starts only with a new accepted operation.

An operation is accepted for window-start purposes only when the server has verified authorization, entitlement and available budget and has created a valid execution reservation. Login, workspace navigation, reading history, typing, attaching context or receiving a client-side validation error cannot start the clock.

If the first reserved operation fails without provider consumption and without delivering a useful result, the newly created empty window is voided. A failure attributable to Storm Signal must not consume the customer's five-hour opportunity.

## Independent clocks

The system maintains two separate clocks:

- **Trial clock:** seven days from verified workspace activation, as defined by the authentication and trial contract.
- **Usage-window clock:** five hours from the first accepted operation after no active window exists.

Opening a usage window does not extend, pause or restart the seven-day trial. A workspace whose trial entitlement has expired cannot open another usage window.

All canonical timestamps are calculated and enforced on the server in UTC. The interface renders the reopening time in the user's local timezone.

## Economic basis

The commercial reference price is USD 133 per month. Maximum OpenAI consumption is 30% of revenue:

```text
Monthly model budget:       133.00 × 30% = USD 39.90
Daily planning equivalent:   39.90 ÷ 30   = USD 1.33
Five-hour equivalent:         1.33 × 5/24 = USD 0.277...
Seven-day trial ceiling:      39.90 × 7/30 = USD 9.31
```

The planning target for a five-hour allowance is therefore approximately USD 0.28. With the current integer-cent accounting, V1 should use a conservative USD 0.27 baseline or introduce finer cost precision; it must not silently round every window upward in a way that can exceed the monthly economic ceiling.

This arithmetic is an economic baseline, not permission to break the product promise. Before production activation, representative end-to-end cycles must prove that the configured allowance comfortably supports evidence retrieval, comparison, follow-up and at least one plan or brief. If it does not, model routing, prompt/context reuse and provider cost must be optimized before lowering the customer experience below the promised arc.

Pricing inputs and allowance values remain configuration, not business-logic constants. They must be recalibrated against observed production usage and the actual provider rate card.

The provisional 27-cent baseline and its normal, extended and excessive synthetic scenarios are recorded in the [Five-Hour Usage Baseline QA](trial-usage-window-baseline-qa.md). That baseline is executable and must be rerun after material routing or pricing changes.

## Trial-total backstop

The seven-day trial also carries an internal aggregate cost ceiling, initially planned at approximately USD 9.31. This is a defense-in-depth control for rounding, reconciliation errors, concurrency, future paid operations and pricing changes.

The aggregate ceiling is not a second customer-facing quota. Normal five-hour windows are proportioned so that legitimate continuous use should not reach it before the trial ends. The interface therefore presents only the current usage window; it does not show a competing weekly percentage or create the impression of two simultaneous countdowns.

If the aggregate backstop is reached unexpectedly, administration must be alerted and the event audited as a calibration or abuse signal. It must not be silently presented as ordinary five-hour exhaustion.

## What consumes allowance

The allowance is cost-based, not message-count based. Every OpenAI-backed attempt contributes its estimated provider cost, including:

- input and output tokens;
- cached input and cache writes when priced differently;
- model escalation and fallback attempts;
- validation or classification calls when they invoke a model;
- transcription;
- other future OpenAI operations performed for the workspace.

Deterministic database operations that do not invoke a paid provider do not consume this allowance.

Because queries vary in context, model tier and reasoning effort, two customers may send different numbers of messages before reaching the same economic allowance. The product must not promise a fixed message count.

## Enforcement hierarchy

The five-hour window does not replace the other economic and operational guards. An execution must satisfy all of them:

1. active seven-day entitlement;
2. active five-hour window with remaining allowance;
3. total seven-day trial ceiling;
4. per-operation maximum cost;
5. rate, concurrency and abuse controls;
6. valid workspace authorization.

The server reserves a safe bounded cost for the next model attempt before invoking OpenAI. It must not withhold the cumulative theoretical cost of every possible fallback when those attempts have not been selected for execution. If validation requires escalation or a provider failure requires fallback, the server atomically obtains an incremental reservation before starting that next attempt. An attempt that cannot be safely reserved is not invoked. Each completed attempt is reconciled with actual measured consumption.

The dynamic model router remains responsible for choosing the least expensive reliable model. The allowance system governs how much may be spent; it must not select model identifiers itself.

## Window state

The authoritative server state must expose at least:

```text
window_started_at
window_ends_at
window_budget_cost
window_used_cost
window_reserved_cost
window_remaining_cost
usage_percentage
warning_threshold = 90%
status = available | warning | exhausted
```

For enforcement, `used + active reservations` counts against the window. Percentage and remaining values must be clamped for display while preserving exact internal accounting.

Concurrent requests must not be able to reserve the same remaining allowance. Window creation and reservation therefore require an atomic database transaction or equivalent locking boundary.

## Customer experience

### Persistent usage access

The authenticated shell must provide a persistent, secondary `Usage` control in the sidebar. It gives the customer access to their current allowance without competing with the conversation composer or becoming the primary product experience.

Its compact state uses this pattern:

```text
Usage · 72%
```

When no active window exists, it may display:

```text
Usage · Available
```

The control reflects authoritative server data. It cannot calculate allowance, percentages or reopening time independently in the browser.

Selecting `Usage` opens a modal containing:

- `Current usage window`;
- a visual consumption bar;
- the percentage used;
- localized window start time;
- localized reopening time;
- status: `Available`, `Almost used` or `Limit reached`;
- the explanatory note: `Usage varies depending on the complexity of each request.`

The modal must not expose provider tokens, dollar amounts, internal model aliases, model identifiers, routing decisions or raw UTC timestamps.

On desktop, the control remains accessible in the sidebar account/plan area. On mobile, it lives inside the collapsible sidebar and opens the same content in a modal adapted to the available viewport. Closing the modal returns focus to the control that opened it.

The usage surface must remain accessible while the allowance is exhausted so the customer can confirm when access returns.

Under expected use, this control is a transparency surface rather than a recurring warning. The product must not use visual urgency before the 90% threshold or encourage the customer to conserve normal investigative work.

### Available

The composer remains active. The product may show a quiet usage indicator but should not make internal cost the center of the experience.

### Warning at 90%

At 90% or greater and below exhaustion, the composer remains active and the interface shows:

> You're close to your current usage limit. More access at 12:50 AM.

The time is dynamic and localized. The warning must remain visible enough to prevent surprise without interrupting the current completed response.

### Exhausted at 100%

At exhaustion, no new paid operation is accepted. Existing completed conversation history remains readable, conversations remain navigable and non-paid account actions remain available.

The interface shows:

> You've reached your current usage limit. You can continue at 12:50 AM.

The system must not say `tomorrow` unless the localized reopening time is actually on the following calendar day. It must not expose tokens, cents, UTC boundaries or model names.

### Reopening

When the fixed end time arrives, the exhausted state clears without requiring sign-out. The next submitted paid operation opens a fresh five-hour window.

## Conversion boundary

V1 uses the exhausted surface as a deliberate but honest conversion moment. The immediate promise is when free access returns. A future paid extension or additional-usage purchase may be added later, but it is outside this contract and must not be implied before it exists.

The usage restriction must never delete or hide the customer's existing work.

## Failure behavior

- Provider failures that produce no billable usage do not consume customer allowance.
- A newly opened window with no billable usage and no useful delivered result is voided.
- Billable failed attempts and routed fallbacks consume their actual measured cost.
- Duplicate submissions with the same idempotency identity cannot consume allowance twice.
- A stale or abandoned reservation must expire and release its unused amount.
- If exact provider usage is temporarily unavailable, the conservative reservation remains until reconciliation.
- Clock calculations never depend on browser time.

## Required auditability

Administration must be able to reconstruct:

- who opened the window and when;
- the fixed reopening time;
- every reservation and reconciliation;
- which operation, route and model attempt generated the cost;
- warning and exhaustion transitions;
- rejected operations and their reason;
- trial-total and window-total consumption.

Customer-facing telemetry and internal model-operation telemetry must reference the same execution identity.

## Acceptance criteria

The contract is satisfied when automated tests prove that:

1. the first accepted operation creates exactly one five-hour window;
2. later messages do not move `window_ends_at`;
3. exhaustion does not move `window_ends_at`;
4. the warning begins at 90%;
5. a request exceeding the remaining allowance is blocked before OpenAI execution;
6. access becomes eligible again at the fixed closing time;
7. unused allowance does not roll over;
8. concurrent reservations cannot overspend the window;
9. retries and fallbacks are reconciled correctly;
10. trial expiration overrides an otherwise available window;
11. the localized interface displays the correct reopening time;
12. conversation history remains available while execution is blocked;
13. the sidebar control and modal reflect the same authoritative window state;
14. the modal remains available in warning and exhausted states;
15. desktop and mobile surfaces are keyboard accessible and restore focus after closing;
16. no customer-facing usage surface exposes tokens, provider cost or model identity;
17. login, reading and client-side validation cannot start a window;
18. an empty window created by a non-billable failed first operation is voided;
19. a representative normal user can complete the full decision cycle within one window with reasonable follow-up margin;
20. the seven-day aggregate ceiling remains an internal backstop and does not appear as a competing customer-facing quota;
21. fallback capacity is reserved incrementally and cannot falsely block a normal cycle by withholding the cost of unexecuted attempts.

## Superseded behavior

For seven-day trial workspaces, this contract supersedes:

- the customer-facing `25 checks left today` counter;
- reset-at-next-UTC-day language;
- the `Today's investigation allowance has been reached. It resets tomorrow.` state.

Legacy daily-count fields may remain temporarily for migration compatibility, but they cannot be the authoritative trial-access decision after this contract is implemented.
