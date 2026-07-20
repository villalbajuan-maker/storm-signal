# Usage-window transaction authority

Migrations `20260720003000` through `20260720003400` implement the server-only transactional authority for the five-hour window, including application authorization and terminal cleanup.

## Reserve one attempt

`reserve_usage_attempt_for_user` executes under one workspace advisory lock. It:

1. verifies membership, entitlement and active policy;
2. expires abandoned reservations;
3. closes a window whose fixed end time passed;
4. opens a new window only for an accepted first operation;
5. resolves idempotent duplicate requests;
6. checks per-attempt, window and entitlement-period budgets;
7. creates the execution on the first attempt;
8. creates exactly one reservation for the selected attempt;
9. snapshots a `would_block` outcome in shadow mode.

Fallbacks reuse the execution ID with a higher `attempt_number`. They reserve only when selected for execution.

In `enforced` mode, an unavailable reservation returns before creating provider work. In `shadow` mode, it returns `shadow_reserved` and records the reason while allowing later integration code to continue.

## Reconcile one attempt

`reconcile_usage_attempt_for_user`:

- releases the reserved amount;
- adds actual provider cost in microdollars;
- updates execution totals;
- transitions the window to `warning` or `exhausted`;
- records lifecycle and reservation events;
- safely accepts duplicate reconciliation;
- voids a newly opened empty window when its first operation fails without billable use or a useful result.

The function returns an internal JSON snapshot. Only the service role can execute it.

When a complete fallback chain terminates without any measured provider cost, `void_empty_usage_window_for_run` closes the otherwise empty window. This terminal cleanup is separately locked and refuses to void any window that contains used, reserved or billable usage.

## Concurrency and accounting

All window and reservation decisions serialize on a workspace advisory transaction lock. Active capacity is `used_microusd + reserved_microusd`. Actual cost is never discarded when it exceeds an estimate.

Expired reservations reduce both window and execution reserved balances before new capacity is evaluated. A fixed window never moves because of later activity or exhaustion.

## Validation

`supabase/tests/usage_window_transaction_smoke.sql` runs against the linked schema inside `BEGIN … ROLLBACK`. It proves:

- first-attempt window creation;
- exact 18,000-second duration;
- reservation and reconciliation balances;
- incremental fallback reservation;
- shadow-mode `would_block` recording;
- release of a canceled fallback;
- voiding after a non-billable first failure;
- terminal voiding after a multi-attempt, zero-cost fallback chain;
- lifecycle event creation;
- complete rollback with no retained QA rows.
