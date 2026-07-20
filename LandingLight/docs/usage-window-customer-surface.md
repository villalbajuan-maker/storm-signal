# Five-hour usage window: customer surface

The workspace now replaces the legacy `checks left today` counter with the customer-safe five-hour usage state.

## Sidebar

The persistent control reads `Usage · Available` before a window starts and `Usage · N%` while a window is active. It remains secondary to the conversation and opens the same modal on desktop and mobile.

## Modal

The modal presents the current percentage, status, localized start time and localized reopening time. It intentionally omits provider costs, token counts, model aliases, model identifiers, UTC values and routing decisions.

The client receives all allowance calculations from `get_workspace_usage_summary`. It only formats authoritative timestamps in the browser's locale.

## Warning and exhaustion

When enforcement is enabled by policy:

- `almost_used` keeps the composer active and explains when more access returns;
- `limit_reached` keeps history and navigation available while disabling new paid operations;
- the client refreshes after chat and transcription operations, every minute during an active window, and at the fixed reopening boundary.

While the policy remains in `shadow`, the Usage control can report observed percentage, but warning and blocking behavior remain inactive. Moving to enforcement is a configuration change rather than a UI rewrite.

## Security

The summary function requires an authenticated workspace member. Its return signature contains no raw economic or model-routing fields. The `/api/usage` response is private and non-cacheable.
