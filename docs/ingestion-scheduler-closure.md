# Ingestion Scheduler Closure

Status: hygiene tranche 2 completed July 19, 2026.

## Scheduler authority

Supabase `pg_cron` is the sole automatic ingestion scheduler. The active production jobs verified at closure are:

| Source | Job | Schedule | State |
|---|---|---|---|
| NWS alerts | `storm-signal-nws-every-5-minutes` | `*/5 * * * *` | active |
| SPC reports | `storm-signal-spc-every-10-minutes` | `3,13,23,33,43,53 * * * *` | active |
| NHC GIS | `storm-signal-nhc-every-5-minutes` | `1-59/5 * * * *` | active |

The retention job remains intentionally inactive and is not part of ingestion scheduling.

## GitHub Actions boundary

`.github/workflows/ingest.yml` is manual recovery only. It has no `schedule` trigger and can explicitly run NWS, SPC, or both. It must not become a second production clock.

The obsolete weekly NOAA historical hail import for Texas and Oklahoma was removed from its inputs, jobs, and commands. Historical imports now require a separately reviewed, explicitly scoped operation; they are not a recovery path for live ingestion.

## Production evidence at closure

Immediately before consolidation, production showed successful recent runs for all three live sources:

- NWS completed with received records and no error;
- SPC completed with received records and no error;
- NHC completed with received records and no error.

This verified that removing GitHub schedules did not remove the production scheduler of record.

## Operating rule

Use Supabase job and ingestion-run observability for routine monitoring. Invoke the GitHub workflow only for a deliberate recovery attempt, document why it was needed, and confirm that the equivalent Supabase job is not producing a conflicting run.
