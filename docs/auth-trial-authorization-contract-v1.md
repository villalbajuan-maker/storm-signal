# Storm Signal — Authentication, Trial and Authorization Contract V1

**Status:** FROZEN V1 AUTHORITY
**Baseline date:** July 19, 2026
**Applies to:** LandingLight signup, sign-in, workspace creation, sessions, trial enforcement, usage controls, tenant isolation and subscription handoff

## Decision

Storm Signal V1 uses passwordless email authentication through Supabase Auth. A user enters a six-digit one-time code in the same browser flow. V1 does not require users to create or remember passwords.

The seven-day trial begins only after successful email verification and real workspace activation.

## Frozen customer flow

```text
Trial form
Email + company + primary market + crew size
              ↓
Send six-digit email code
              ↓
Check your email
Enter code / resend / change email
              ↓
Verify identity
              ↓
Create workspace + Owner membership + trial
              ↓
Open a new investigation
```

### Trial form

The current onboarding fields remain:

- work email;
- company;
- primary market;
- crew size.

Submitting this form does not start the trial. It creates a bounded pending-onboarding attempt and sends a verification code.

### Verification surface

Required content and actions:

- `Check your email.`
- masked or displayed destination email;
- six-digit code input;
- `Verify and open workspace`;
- `Send another code`;
- `Change email`.

The code expires after a short configured period. V1 targets 10–15 minutes rather than relying on a long default.

### Returning user

The same passwordless mechanism serves sign-in:

1. enter work email;
2. receive code;
3. verify;
4. return to the last authorized workspace and relevant conversation.

## Activation transaction

After successful verification, the server creates or resolves the following atomically:

- authenticated user;
- company workspace;
- `Owner` workspace membership;
- user profile;
- primary market;
- crew size;
- trial entitlement;
- first empty conversation when appropriate.

Repeated verification or callback delivery must be idempotent and must not create duplicate workspaces, memberships or trials.

## Trial clock

The trial begins at successful activation, not at landing visit, form completion or email delivery.

Canonical server fields:

```text
workspace_id
plan = trial
status = active
starts_at = verified activation timestamp in UTC
ends_at = starts_at + 7 days
```

The browser never determines entitlement time.

## Authentication and authorization boundary

Authentication establishes who the person is. Authorization determines which company workspace, conversations and artifacts that person may access.

Every tenant-owned operational record carries `workspace_id`, including:

- conversations;
- messages;
- artifacts and field briefs;
- usage events;
- entitlements and subscriptions;
- memberships;
- audit records where applicable.

Server-side authorization and Postgres Row Level Security verify workspace membership for every tenant-owned read and write. A client-supplied `workspace_id` is never sufficient authorization.

The initial roles are:

- `Owner`: account, plan, members and all operational work;
- `Member`: authorized conversations and artifacts.

V1 may commercially begin with one active member per trial workspace while preserving the multi-member authorization model.

## Trial limits

The authoritative V1 customer-facing allowance within the seven-day entitlement is the fixed five-hour, cost-governed window defined in the [Five-Hour Trial Usage Window Contract V1](trial-five-hour-usage-window-contract-v1.md). That contract supersedes the provisional daily investigation counter and next-UTC-day reset for trial workspaces.

Trial enforcement has three independent layers.

### Time entitlement

Every paid capability verifies on the server:

```text
starts_at <= now < ends_at
```

### Operational protection

V1 supports configurable controls for:

- maximum trial members;
- requests per minute;
- daily investigations;
- concurrent runs;
- total trial consumption;
- idempotent retries;
- user, workspace and IP abuse protection.

Only one execution may be active per conversation in V1.

### Economic protection

Each model execution records internally:

- workspace, user and conversation;
- model;
- input and output usage;
- MCP activity;
- duration and outcome;
- estimated provider cost;
- retry or idempotency identity.

Before execution, the server checks entitlement, rate limits, concurrency and remaining internal budget. It reserves the operation, records actual consumption and releases or finalizes the reservation.

Customers are not shown token terminology. Customer-facing limits use understandable product language such as investigations or usage.

## Limit configuration

Exact trial quantities are not frozen until representative end-to-end investigations have been measured. Limits must be configurable without schema or application-code changes:

```text
trial_days
max_members
max_requests_per_minute
max_daily_investigations
max_trial_cost_cents
max_concurrent_runs
```

The trial must permit a user to test the complete commercial arc:

1. find relevant evidence;
2. compare markets;
3. build at least one field plan;
4. generate at least one field brief.

A trial limit that blocks that arc before reasonable use violates this contract.

## Trial expiration

At expiration:

- the user can authenticate;
- existing conversations remain readable;
- existing briefs remain readable and downloadable according to retention policy;
- new paid investigations and generations are blocked;
- the user sees a clear plan-selection action;
- work is not deleted without prior notice.

The interface must explain expiration before a blocked action and must not use deceptive urgency.

## Email delivery

Production uses a custom SMTP provider rather than Supabase's demonstration email service. Provider choice may be Resend, Postmark or an equivalent production service.

Authentication email purpose is singular and operational.

Suggested subject:

> Your Storm Signal code

Suggested body:

> You're one step away from your workspace. Enter this code to start your 7-day trial.

Email link tracking must not rewrite authentication links if links are later introduced.

## Subscription handoff

Stripe or the selected billing provider is introduced at plan selection. Billing does not control authorization directly; verified webhook state updates the server-owned entitlement record.

The customer may subscribe during or after the trial. A successful subscription preserves the workspace, conversations and artifacts.

## Security and abuse requirements

- Secret credentials remain server-side.
- Verification resend is rate-limited.
- Authentication responses do not reveal whether an unrelated account exists.
- Workspace access is enforced by server authorization and RLS.
- Activation and billing webhooks are idempotent.
- Usage reservations prevent duplicated or parallel cost leakage.
- Trial identity cannot be extended by changing browser time or local storage.
- Logging excludes OTP values, session tokens and provider secrets.

## Explicitly rejected for V1

- Mandatory passwords.
- Starting the trial on landing visit or unverified form submission.
- Client-side-only trial enforcement.
- Treating possession of a workspace identifier as authorization.
- Displaying raw token quotas to customers.
- Immediately deleting work at trial expiration.
- Unlimited trial usage.
- A trial so restricted that the four-outcome product arc cannot be tested.

## Implementation order

1. Data model for workspace, membership, onboarding attempt, entitlement and usage ledger.
2. RLS and server authorization tests.
3. Supabase Auth email OTP and production SMTP.
4. Verification and callback surfaces.
5. Atomic activation transaction.
6. Protected workspace routing and session recovery.
7. Trial enforcement and read-only expiration state.
8. Usage reservation, metering and configurable budgets.
9. Billing handoff and webhook-driven entitlement updates.

## Implementation artifacts — July 19, 2026

The first executable translation of this contract now exists in two deliberately separate layers:

- `supabase/migrations/20260719262000_create_workspace_trial_authorization.sql` defines onboarding intents, workspaces, memberships, configurable usage policies, entitlements, conversations, execution runs, messages, artifacts, tenant-aware RLS and the atomic `activate_trial` transaction;
- `LandingLight/app/start`, `LandingLight/app/verify` and `LandingLight/app/workspace/expired` provide functional wireframes for signup, code verification and the read-only expired-trial state.

The browser wireframes use `sessionStorage` and accept any six-digit verification code. This is intentional prototype behavior and must never be represented as authentication. They do not send email, create a Supabase user, enforce a server session, charge a plan or write to the migration schema.

The migration was applied to the linked Storm Signal Supabase project on July 19, 2026. Post-apply verification confirmed nine tenant tables with RLS enabled, eleven authorization policies, four authorization/activation functions and migration version `20260719262000`. Its seeded usage-policy amounts are configurable operating defaults, not a frozen commercial promise; they must be calibrated from measured end-to-end investigations before production activation.

Supabase Auth email OTP, custom SMTP, protected routing, server-owned intent creation, trial enforcement, rate limiting, atomic usage reservation and execution metering are now integrated in the linked Storm Signal project. Billing webhooks and adversarial RLS tests with multiple real authenticated users remain required before paid production launch.

### Step 8 completion record — usage controls

On July 19, 2026, migrations `20260719264000_add_usage_reservation_metering.sql`, `20260719265000_expose_customer_usage_summary.sql` and `20260719266000_lock_usage_metering_to_server.sql` were applied to the linked project:

- every chat request must carry an idempotency key and reserve workspace capacity before OpenAI or MCP work begins;
- the atomic reservation checks active entitlement, membership, per-minute requests, daily investigations, concurrent executions and period budget;
- duplicate request keys cannot create a second execution;
- completed executions record input/output tokens, MCP calls and estimated cost, while failed or canceled work releases its reserved cost;
- stale reservations are failed automatically after ten minutes so interrupted work cannot lock the workspace indefinitely;
- policies remain configurable by plan in `usage_policies` and inaccessible to browser mutation;
- reservation and finalization functions are executable only by the server service role; authenticated browser clients cannot forge or erase metering records;
- the workspace exposes only the customer-facing daily allowance, never provider tokens or internal budget details;
- limit responses use plain operational language and appropriate HTTP status codes.

The seeded limits are operating safeguards for calibration, not immutable commercial terms. Exact model-cost metering can be supplied through server environment rates without a schema change.

## Acceptance statement

Storm Signal V1 authentication and trial are accepted only when a verified user can enter the correct isolated workspace, receive seven server-measured days to exercise the full product promise, retain their work after expiration and never gain access or consumption through client-side manipulation.

## Official implementation references

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Passwordless email login](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [JavaScript `signInWithOtp`](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [Email templates and OTP verification](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
