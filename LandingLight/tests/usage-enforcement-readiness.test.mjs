import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720006000_add_enforcement_readiness_gate.sql", import.meta.url), "utf8");
const qaScope = readFileSync(new URL("../../supabase/migrations/20260720006100_add_controlled_qa_rollout_scope.sql", import.meta.url), "utf8");
const smoke = readFileSync(new URL("../../supabase/tests/usage_enforcement_controlled_smoke.sql", import.meta.url), "utf8");

test("enforcement requires measured windows, attempts, completed arcs and full telemetry", () => {
  assert.match(qaScope, /minimum_windows, minimum_attempts/);
  assert.match(qaScope, /values \('trial', 5, 12, 1, 100\)/);
  assert.match(qaScope, /workspace_type = 'controlled_qa'/);
  assert.match(qaScope, /telemetry_percentage >= settings\.required_telemetry_percentage/);
  assert.match(qaScope, /critical_alerts/);
  assert.match(qaScope, /requires_human_review/);
});

test("activation is server-only and refuses an unmet gate", () => {
  assert.match(migration, /raise exception 'Trial usage enforcement readiness gate is not satisfied'/);
  assert.match(migration, /set usage_window_mode = 'enforced'/);
  assert.match(migration, /grant execute on function public\.activate_trial_usage_enforcement\(\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

test("controlled QA covers warning, exhaustion, rejection and fixed reopening", () => {
  assert.match(smoke, /usage_status <> 'almost_used'/);
  assert.match(smoke, /usage_status <> 'limit_reached'/);
  assert.match(smoke, /result_code from qa_blocked_attempt\) <> 'window_limit'/);
  assert.match(smoke, /qa_reopened_attempt/);
  assert.match(smoke, /rollback;/);
});
