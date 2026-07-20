import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720005000_add_usage_operational_audit.sql", import.meta.url), "utf8");

test("operational audit reconstructs windows without multiplying reservations by events", () => {
  assert.match(migration, /create or replace view public\.usage_window_operational_audit/);
  assert.match(migration, /cross join lateral/);
  assert.match(migration, /fallback_attempt_count/);
  assert.match(migration, /shadow_would_block_count/);
  assert.doesNotMatch(migration, /left join public\.usage_reservations[\s\S]*left join public\.usage_window_events/);
});

test("audit detects economic and telemetry integrity failures", () => {
  for (const finding of ["stale_reservation", "window_ledger_mismatch", "run_ledger_mismatch", "expired_active_window", "missing_attempt_telemetry"]) {
    assert.match(migration, new RegExp(finding));
  }
  assert.match(migration, /on conflict \(fingerprint\) do update/);
  assert.match(migration, /resolved_at = now\(\)/);
});

test("operational audit remains server-only", () => {
  assert.match(migration, /revoke all on public\.usage_operational_alerts from anon, authenticated/);
  assert.match(migration, /revoke all on public\.usage_window_operational_audit from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.run_usage_metering_audit\(\) to service_role/);
});
