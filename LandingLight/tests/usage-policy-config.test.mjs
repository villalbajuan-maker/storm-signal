import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720001000_add_five_hour_usage_policy_config.sql", import.meta.url), "utf8");

test("trial policy enters shadow mode with the frozen five-hour configuration", () => {
  assert.match(migration, /usage_window_mode = 'shadow'/);
  assert.match(migration, /usage_window_minutes = 300/);
  assert.match(migration, /usage_warning_percentage = 90/);
  assert.match(migration, /usage_window_budget_microusd = 270000/);
  assert.match(migration, /max_period_cost_microusd = 9310000/);
});

test("paid policies remain disabled and customer budgets use microdollar precision", () => {
  assert.match(migration, /usage_window_mode = 'disabled'/);
  assert.match(migration, /usage_window_budget_microusd bigint/);
  assert.doesNotMatch(migration, /usage_window_mode = 'enforced'/);
});
