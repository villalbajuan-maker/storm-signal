import assert from "node:assert/strict";
import test from "node:test";
import { createUsageAttemptLifecycle } from "../lib/usage-metering.ts";

test("usage lifecycle carries run, window and reservation identity through reconciliation", async () => {
  const calls = [];
  const admin = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "authorize_and_reserve_usage_attempt_for_user") return { single: async () => ({ data: { run_id: "run-1", window_id: "window-1", reservation_id: "reservation-1", result_code: "shadow_reserved", would_block: true }, error: null }) };
      return Promise.resolve({ data: { result_code: "reconciled" }, error: null });
    },
  };
  let started = null;
  const lifecycle = createUsageAttemptLifecycle({
    admin, userId: "user", workspaceId: "workspace", conversationId: "conversation", requestId: "request-123", operation: "weather_conversation",
    onExecutionStarted: async (runId, windowId) => { started = { runId, windowId }; },
  });
  const lease = await lifecycle.onAttemptStart({ attemptNumber: 1, model: { alias: "mini", id: "model" }, route: { capability: "weather_chat" }, reservationMicrousd: 50_000 });
  await lifecycle.onAttemptFinish({ attempt: { status: "succeeded", estimatedCostMicrousd: 30_000 }, lease, willRetry: false });
  assert.deepEqual(started, { runId: "run-1", windowId: "window-1" });
  assert.equal(lifecycle.getRunId(), "run-1");
  assert.equal(calls[0].args.p_reserved_microusd, 50_000);
  assert.equal(calls[1].args.p_actual_microusd, 30_000);
});
