# Five-hour usage window: controlled enforcement

## Result

The controlled test changes the trial policy to `enforced` only inside a database transaction and rolls the entire test back. It proves the real database behavior without altering customer production mode or invoking OpenAI.

The test covers:

- an exact 90% warning state;
- continued authorization below exhaustion;
- reconciliation above 100% and customer-safe clamping;
- rejection before provider work when the next reservation cannot fit;
- a retry time anchored to the original window end;
- automatic closure and a fresh window after the fixed five-hour boundary.

## Readiness gate

`evaluate_trial_usage_enforcement_readiness()` runs the operational audit and reports mechanical evidence. Its thresholds live in the server-only `usage_rollout_settings` table. The compact initial QA requires five measured windows, twelve attempts, one window with at least three operations, complete attempt telemetry and zero critical alerts.

Controlled runs live in workspaces explicitly marked `controlled_qa`. They remain distinguishable from customer evidence and their memberships are removed after execution so they never replace the operator's normal workspace.

`activate_trial_usage_enforcement()` is service-role only and refuses to change configuration when the mechanical gate is unmet. A passing mechanical gate still returns `requires_human_review: true`: the operator must confirm that representative product arcs completed before approving the mode change.

There is no force flag and no customer-accessible activation path.

## Current decision

The initial allowance is calibrated at **27¢ per five-hour window**. Eight isolated QA windows, thirty provider attempts, five complete cycles, 100% telemetry and zero audit alerts satisfy the mechanical readiness gate. A final compact brief arc completed in three successful Mini attempts with no fallback at an estimated cost of **$0.266996**.

Production remains in `shadow` pending the explicit human activation action. This is now a rollout choice, not a missing engineering or calibration step.
