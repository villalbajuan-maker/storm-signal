import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720003000_add_usage_window_transaction_authority.sql", import.meta.url), "utf8");
const reconciliationFix = readFileSync(new URL("../../supabase/migrations/20260720003100_fix_usage_reconciliation_result.sql", import.meta.url), "utf8");
const authorizationWrapper = readFileSync(new URL("../../supabase/migrations/20260720003200_add_usage_execution_authorization_wrapper.sql", import.meta.url), "utf8");
const finalizationFix = readFileSync(new URL("../../supabase/migrations/20260720003300_preserve_billable_failed_attempt_cost.sql", import.meta.url), "utf8");
const terminalVoid = readFileSync(new URL("../../supabase/migrations/20260720003400_void_empty_terminal_usage_window.sql", import.meta.url), "utf8");

test("transaction authority opens one window and reserves one selected attempt", () => {
  assert.match(migration, /create or replace function public\.reserve_usage_attempt_for_user/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /insert into public\.usage_windows/);
  assert.match(migration, /insert into public\.usage_reservations/);
  assert.match(migration, /attempt_number/);
});

test("shadow mode records a would-block result while enforced mode returns before provider work", () => {
  assert.match(migration, /is_shadow := policy\.usage_window_mode = 'shadow'/);
  assert.match(migration, /block_reason is not null and not is_shadow/);
  assert.match(migration, /'shadow_reserved'/);
  assert.match(migration, /'would_block', block_reason is not null/);
});

test("reconciliation releases reservation and accounts actual cost", () => {
  assert.match(reconciliationFix, /create function public\.reconcile_usage_attempt_for_user/);
  assert.match(reconciliationFix, /returns jsonb/);
  assert.match(reconciliationFix, /target_window\.reserved_microusd - reservation\.reserved_microusd/);
  assert.match(reconciliationFix, /target_window\.used_microusd \+ p_actual_microusd/);
  assert.match(reconciliationFix, /first_operation_failed_nonbillable/);
  assert.match(reconciliationFix, /warning_reached/);
  assert.match(reconciliationFix, /exhausted/);
});

test("transaction functions remain service-role only", () => {
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

test("application wrapper preserves operational guards during shadow rollout", () => {
  assert.match(authorizationWrapper, /max_requests_per_minute/);
  assert.match(authorizationWrapper, /max_concurrent_runs/);
  assert.match(authorizationWrapper, /usage_window_mode = 'shadow'/);
  assert.match(authorizationWrapper, /max_daily_investigations/);
  assert.match(authorizationWrapper, /reserve_usage_attempt_for_user/);
});

test("terminal execution state retains billable failed-attempt cost", () => {
  assert.match(finalizationFix, /estimated_cost_cents = greatest\(0, p_estimated_cost_cents\)/);
  assert.doesNotMatch(finalizationFix, /case when p_status = 'succeeded'/);
});

test("a zero-cost failed fallback chain voids the empty window atomically", () => {
  assert.match(terminalVoid, /create or replace function public\.void_empty_usage_window_for_run/);
  assert.match(terminalVoid, /pg_advisory_xact_lock/);
  assert.match(terminalVoid, /target_window\.used_microusd <> 0/);
  assert.match(terminalVoid, /reservation\.actual_microusd > 0/);
  assert.match(terminalVoid, /terminal_operation_failed_without_billable_usage/);
  assert.match(terminalVoid, /to service_role/);
});
