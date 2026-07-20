# Five-hour usage window: OpenAI integration

This tranche connects model routing to the authoritative five-hour metering system. It remains in `shadow` mode: requests continue, while the database records whether the same attempt would be admitted or blocked under enforcement.

## Execution sequence

Every OpenAI operation requests a capability from the model router. Immediately before each selected provider attempt, the router asks the usage authority to reserve that attempt's estimated microdollar cost. It does not reserve the entire fallback chain in advance.

After the provider attempt:

- successful and quality-rejected attempts reconcile measured token cost;
- retryable failures reconcile before the next model is selected;
- the fallback requests a new, incremental reservation;
- terminal zero-cost failures release their reservation;
- a complete zero-cost failure chain voids a newly opened empty window.

The chat and voice-transcription routes use the same lifecycle interface. Business components request a capability; they do not select a model or implement budget arithmetic.

## Recorded evidence

The integration records the execution, window and reservation identities, selected alias and provider model, routing reason, input/output/cache tokens, latency, attempts, retry count and estimated cost in both cents and microdollars.

The provider response is never started in enforced mode unless its selected attempt has a valid reservation. Idempotency, entitlement, minute and concurrency guards execute before provider work. Legacy daily limits remain active only while the new policy is in shadow mode.

## Failure guarantees

- A fallback cannot silently consume unreserved budget.
- Billable failed attempts remain counted.
- A window with any measured or reserved cost cannot be voided by terminal cleanup.
- Reconciliation is idempotent.
- Database economic tables and functions remain service-role only.

## Rollout

1. Keep `trial` policy in `shadow`.
2. Compare observed and would-block behavior using the audit tables.
3. Validate warning and exhausted surfaces in the next tranche.
4. Change only the policy mode to `enforced`; no route rewrite is required.
