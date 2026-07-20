# Storm Signal — Five-Hour Usage Baseline QA

**Status:** TRAMO 8 CALIBRATION CLOSED
**Date:** July 20, 2026
**Method:** deterministic simulation plus isolated controlled QA with real OpenAI and MCP calls

## Why synthetic QA is authoritative for this stage

Existing production conversations are QA, adversarial-security and exploratory sessions. They do not represent normal customer behavior and cannot establish a behavioral baseline. The database audit remains useful for validating available telemetry, but its conversation totals are excluded from allowance calibration.

The executable baseline is `LandingLight/scripts/simulate-five-hour-window.mjs`. It uses the production model router, configured tier prices, prompt-cache assumptions and representative token envelopes without calling OpenAI.

## Scenarios

### Normal

1. check recent evidence;
2. compare areas;
3. build a field plan.

### Extended

1. check recent evidence;
2. compare areas;
3. clarify one area;
4. build a field plan;
5. prepare a field brief.

### Excessive

The complete extended arc followed by repeated additional checks.

These are cost simulations, not fixed product scripts. Real users remain free to use natural language and choose a different order.

## Result at the 27-cent planning baseline

| Scenario | Completed work | Estimated use | Window use | Outcome |
| --- | --- | ---: | ---: | --- |
| Normal | Evidence, comparison and field plan | 11¢ | 40.7% | Completes without warning |
| Extended | Normal arc, clarification and field brief | 18¢ | 66.7% | Completes with room for follow-up |
| Excessive | Extended arc plus repeated checks | 27¢ maximum | 100% | Additional work is blocked |

The behavioral baseline therefore supports the contract's intent: normal work has meaningful headroom, an extended full arc completes, and only additional out-of-pattern work reaches the economic boundary.

## Critical implementation finding

The current router reserves the cumulative planned cost of every eligible fallback before the first provider attempt. Reusing that reservation directly as the five-hour-window reservation would create false exhaustion:

- the normal scenario would stop before the field plan;
- only 7¢, or 25.9% of the actual window allowance, would have been consumed;
- the customer would never see the intended 90% warning.

The application now uses staged, per-attempt reservation rather than withholding the cumulative theoretical cost of every fallback.

The implementation must use staged safe reservation:

1. reserve the bounded cost of the primary attempt;
2. reconcile its actual usage;
3. if escalation or fallback is required, atomically reserve the next attempt before invoking it;
4. stop escalation when the incremental reservation cannot be obtained.

This preserves strict economic control without withholding the theoretical cost of attempts that may never run. Capability-specific reservation envelopes must be validated against later production telemetry.

## Five-hour timing assertion

The automated QA also proves that exhaustion does not move the closing time. A window opened at 7:50 PM closes at 12:50 AM even if it is exhausted 47 minutes after opening. The next window can begin only with an accepted operation at or after that fixed closing time.

## Real controlled QA

The first five-cycle cohort exposed two avoidable escalation causes: contextual follow-ups were being treated as fresh MCP searches, and field plans were not classified explicitly. After correcting both, a focused comparison reduced the extended field-plan cycle from **$0.317134 with five attempts** to **$0.28 with three attempts**.

The final complete product arc ran as three operations: evidence search, prioritization and compact field brief. It produced:

| Metric | Result |
| --- | ---: |
| Provider attempts | 3 |
| Successful attempts | 3 |
| Fallbacks | 0 |
| Model tier | Mini |
| Input tokens | 128,258 |
| Cached input tokens | 44,509 |
| Output tokens | 1,300 |
| Latency | 22.527 s |
| Estimated provider cost | **$0.266996** |
| Five-hour allowance used | **98.89%** |
| Operational audit alerts | **0** |

The run also revealed that a 3,500-token reservation envelope was excessive for compact field outputs. Field briefs and field plans now use a 900-token output envelope and an API output cap. The final real answer used fewer than half of that allowance. Deterministic QA confirms that the adjusted per-attempt reservation admits both normal and extended product arcs while still rejecting excess work before another provider call.

## Calibration decision

- Approve **27¢ per rolling five-hour window** as the initial calibrated trial allowance.
- Keep the 90% warning and the reopening time anchored to the original window start.
- Keep staged atomic reservation for every provider attempt.
- Route compact field plans and briefs to Mini first, with stronger models available only as fallbacks or explicit highest-quality work.
- Preserve the seven-day aggregate ceiling as a silent economic backstop.
- Re-run the same three scenarios when model prices, routing policy or prompt structure changes.
- Production enforcement remains in `shadow` until the separate human activation action; the mechanical readiness gate is green with 100% telemetry and zero critical alerts.

## Automated evidence

`LandingLight/tests/usage-window-baseline.test.mjs` verifies:

1. the normal arc completes below warning;
2. the extended arc completes with room for follow-up;
3. excessive follow-up is blocked only after the complete extended arc;
4. per-attempt reservation admits valid work and guards excess;
5. the five-hour closing timestamp remains fixed after exhaustion.
