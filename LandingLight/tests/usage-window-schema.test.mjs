import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720002000_create_usage_windows_and_reservations.sql", import.meta.url), "utf8");

test("usage-window schema persists windows, staged reservations and audit events", () => {
  assert.match(migration, /create table public\.usage_windows/);
  assert.match(migration, /create table public\.usage_reservations/);
  assert.match(migration, /create table public\.usage_window_events/);
  assert.match(migration, /where status in \('open', 'warning', 'exhausted'\)/);
  assert.match(migration, /unique \(execution_run_id, attempt_number\)/);
});

test("execution and model telemetry carry window and microdollar identities", () => {
  assert.match(migration, /add column if not exists usage_window_id uuid/);
  assert.match(migration, /reserved_cost_microusd bigint/);
  assert.match(migration, /estimated_cost_microusd bigint/);
  assert.match(migration, /usage_reservation_id uuid/);
});

test("economic tables are server-only", () => {
  for (const table of ["usage_windows", "usage_reservations", "usage_window_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(migration, /grant (select|insert|update|delete|all) on public\.(usage_windows|usage_reservations|usage_window_events) to authenticated/i);
});
