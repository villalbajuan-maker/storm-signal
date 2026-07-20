import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260720004000_expose_five_hour_usage_summary.sql", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/workspace/WorkspaceClient.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/usage/route.ts", import.meta.url), "utf8");

test("customer usage summary exposes window state without internal economics", () => {
  assert.match(migration, /usage_percentage numeric/);
  assert.match(migration, /usage_status text/);
  assert.match(migration, /window_started_at timestamptz/);
  assert.match(migration, /window_ends_at timestamptz/);
  assert.doesNotMatch(migration.match(/returns table \([\s\S]*?\)/)?.[0] || "", /microusd|tokens|model|routing/);
  assert.match(migration, /public\.is_workspace_member/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test("workspace presents usage, warning and fixed reopening time", () => {
  assert.match(workspace, /Current usage window/);
  assert.match(workspace, /Usage varies depending on the complexity of each request/);
  assert.match(workspace, /You’re close to your current usage limit/);
  assert.match(workspace, /You’ve reached your current usage limit/);
  assert.match(workspace, /localUsageTime/);
  assert.match(workspace, /usage\.enforcementActive && usage\.status === "limit_reached"/);
});

test("usage refresh is authenticated and never cached", () => {
  assert.match(api, /supabase\.auth\.getUser/);
  assert.match(api, /get_workspace_usage_summary/);
  assert.match(api, /private, no-store/);
});
