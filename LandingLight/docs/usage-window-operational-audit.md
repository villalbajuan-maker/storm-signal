# Five-hour usage window: operational audit

## Purpose

This tranche establishes the evidence required before moving the trial policy from `shadow` to `enforced`. It does not treat an absence of incidents as proof when there is no measured traffic.

## Audit surfaces

`usage_window_operational_audit` reconstructs each window with its fixed boundaries, percentage, runs, attempts, fallbacks, active reservations, reconciled cost, shadow would-block count and lifecycle state.

`run_usage_metering_audit()` performs an integrity pass and maintains durable, server-only findings for:

- stale reservations;
- window ledger mismatches;
- execution ledger mismatches;
- expired windows left active beyond the operational grace period;
- reconciled attempts without corresponding model telemetry.

Every finding has a stable fingerprint. A later clean audit resolves it without deleting its history. Customer roles cannot read the audit view, findings or raw economics.

## Current production snapshot

At the start of this tranche, production contained zero five-hour windows and zero metered attempts. The model-backed integration had only just been deployed. Therefore:

- no real cost distribution exists yet;
- no real normal or extended work cycle can be measured;
- the USD 0.27 window remains the tested provisional baseline;
- `shadow` must remain active.

## Readiness gate for enforcement

Before enabling enforcement, collect a small but representative controlled sample that includes:

1. at least five complete decision cycles and twenty model-backed operations;
2. a normal check → compare → decide arc;
3. at least one extended arc ending in a plan or brief;
4. at least one routed fallback or deliberately simulated equivalent;
5. zero open critical ledger alerts;
6. no routine arc that would have been blocked before delivering its promised result.

The sample can combine internal controlled QA with early real use, but exploratory noise must be labeled and excluded from product-cycle calibration.

## Activation decision

Tramo 7 may begin with controlled enforcement QA, but customer enforcement is approved only after the readiness gate is documented. Mode changes remain configuration-only and do not require rewriting the router or shell.
