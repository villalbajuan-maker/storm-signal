# Usage-window configuration

Storm Signal stores customer-plan usage policy in `public.usage_policies`. Business routes and UI components must not define window durations, percentages or economic limits directly.

Migration `20260720001000_add_five_hour_usage_policy_config.sql` adds the V1 configuration boundary.

## Modes

- `disabled`: legacy controls remain authoritative; no window calculation or enforcement.
- `shadow`: calculate and audit the five-hour policy without blocking customer operations.
- `enforced`: the five-hour policy becomes the authoritative operational limit.

Only the trial policy is initially set to `shadow`. Quarterly and annual policies remain `disabled` until their own usage contract is approved.

## Trial configuration

| Field | Initial value | Meaning |
| --- | ---: | --- |
| `usage_window_mode` | `shadow` | Observe without customer blocking |
| `usage_window_minutes` | `300` | Fixed five-hour window |
| `usage_warning_percentage` | `90` | Customer warning threshold |
| `usage_window_budget_microusd` | `270000` | Provisional USD 0.27 window baseline |
| `max_period_cost_microusd` | `9310000` | Silent USD 9.31 seven-day backstop |
| `max_operation_cost_microusd` | `250000` | Per-operation reservation ceiling |
| `reservation_expiration_seconds` | `600` | Abandoned reservation lifetime |
| `usage_pricing_version` | `operational-estimate-v1` | Cost-rate configuration identity |

One cent equals 10,000 microdollars. Microdollar values prevent per-operation rounding from becoming the dominant cost at the small V1 window size.

## Configuration authority

The active policy row selected from the workspace entitlement is authoritative. Environment variables may configure provider-model prices used to calculate cost, but they do not define the customer allowance.

The legacy fields `max_daily_investigations` and `max_period_cost_cents` remain temporarily available because production still uses the legacy reservation RPC. They are not the V1 five-hour contract and must be removed from the authorization decision only after shadow-mode parity is proven.

Changing `shadow` to `enforced` is a controlled operational release. It requires passing the contract acceptance suite and must never happen implicitly during migration deployment.

## Required consumers

Future implementation tranches use this same policy row for:

- atomic model-cost reservation;
- window creation and reconciliation;
- chat, transcription, validation and fallback control;
- server usage-summary API;
- sidebar usage state and modal;
- administrative audit and calibration.

No browser component receives raw provider cost, pricing version or model identity.
