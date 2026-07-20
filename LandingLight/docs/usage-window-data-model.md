# Usage-window data model

Migration `20260720002000_create_usage_windows_and_reservations.sql` provides the persistent foundation for the five-hour trial contract. It does not calculate, open or enforce windows by itself.

## Topology

```text
workspace + entitlement + active usage policy
                    │
                    ▼
              usage_windows
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
   execution_runs  usage_reservations  usage_window_events
          │         │
          └────┬────┘
               ▼
       model_operation_logs
```

## `usage_windows`

One row snapshots the policy governing a fixed window:

- workspace, entitlement, policy and opening user;
- `started_at` and immutable intended `ends_at`;
- budget, used and currently reserved microdollars;
- warning threshold and pricing version;
- lifecycle state and transition timestamps.

At most one `open`, `warning` or `exhausted` row may exist for a workspace. Expired rows are explicitly closed by the future transactional metering function before a new row is created.

`used_microusd` may exceed the nominal budget during reconciliation so the ledger never hides actual provider cost. Enforcement prevents new reservations once capacity is unavailable.

## `usage_reservations`

Each row represents one selected model attempt, not an entire theoretical fallback ladder. Its unique identity is:

```text
execution_run_id + attempt_number
```

It records capability, selected alias/model, reserved cost, actual reconciled cost, expiration and terminal status. A fallback receives the next attempt number and must obtain a separate reservation.

States are:

- `reserved`;
- `reconciled`;
- `released`;
- `expired`.

## `usage_window_events`

The internal audit stream records:

- window opening, warning, exhaustion, closing and voiding;
- reservation creation, reconciliation, release and expiration.

Event details are internal JSON metadata. Customer usage surfaces never read this table directly.

## Existing table extensions

`execution_runs` now supports:

- `usage_window_id`;
- `reserved_cost_microusd`;
- `estimated_cost_microusd`.

`model_operation_logs` now supports:

- `usage_window_id`;
- `usage_reservation_id`;
- `estimated_cost_microusd`.

Legacy rows retain null window identities and zero microdollar fields. Existing cent fields remain available during migration parity.

## Tenant and access boundary

Window, reservation and event records carry `workspace_id`. Composite foreign keys enforce workspace consistency for staged reservations. The three economic tables have RLS enabled and grant no browser access to anonymous or authenticated roles.

Only server-owned functions and the service role may mutate or inspect raw economic records. A later customer summary RPC returns percentage, status and localized-time inputs without exposing cost, tokens or model identity.

## Implemented transaction authority

Server-only functions now provide transactional opening, fixed-time closing, staged reservations, reconciliation, expiration during subsequent reservation activity and shadow `would_block` calculation. See [usage-window transaction authority](usage-window-transaction-authority.md).

## Not yet integrated

- automatic expiration without subsequent activity;
- customer usage API;
- sidebar modal;
- enforcement.

Those behaviors build on this schema in subsequent tranches.
