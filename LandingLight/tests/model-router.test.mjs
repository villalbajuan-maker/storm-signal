import assert from "node:assert/strict";
import test from "node:test";
import { chatRequiresMcp, estimateCostCents, estimateCostMicrousd, estimateTranscriptionCostMicrousd, executeRoutedResponse, executeRoutedStreamingResponse, getModelCatalog, inferChatCapability, selectModelRoute } from "../lib/openai/model-router.ts";
import { takeReadableStreamChunk } from "../lib/conversation-stream-pacer.ts";

const managedEnv = ["OPENAI_MODELS_ENABLED", "OPENAI_MODEL_NANO", "OPENAI_MODEL_MINI", "OPENAI_MODEL_FRONTIER", "OPENAI_MAX_REQUEST_COST_CENTS"];

function withEnv(values, callback) {
  const previous = Object.fromEntries(managedEnv.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { callback(); } finally { for (const key of managedEnv) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}

test("classifies operational requests without an extra model call", () => {
  assert.equal(inferChatCapability("Compare Tampa and Orlando and rank them"), "comparison");
  assert.equal(inferChatCapability("Prepare a shareable field brief"), "field_brief");
  assert.equal(inferChatCapability("Show recent hail reports in Florida"), "weather_chat");
});

test("reuses established evidence for contextual follow-ups", () => {
  assert.equal(inferChatCapability("Build a concise field plan for the highest-ranked area"), "field_plan");
  assert.equal(chatRequiresMcp("Compare the top two candidates", "comparison", true), false);
  assert.equal(chatRequiresMcp("Turn this into a compact field brief", "field_brief", true), false);
  assert.equal(chatRequiresMcp("Turn this into a field brief with where to check and what to verify", "field_brief", true), false);
  assert.equal(chatRequiresMcp("Find the latest hail reports in Texas", "weather_chat", true), true);
  assert.equal(chatRequiresMcp("Which area has recent hail?", "comparison", false), true);
});

test("uses the balanced policy for routine, operational, and complex work", () => {
  withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    assert.equal(selectModelRoute({ capability: "classification", input: "classify this", risk: "low" }).primary.alias, "nano");
    assert.equal(selectModelRoute({ capability: "weather_chat", input: "recent hail", risk: "medium", requiresMcp: true }).primary.alias, "mini");
    assert.equal(selectModelRoute({ capability: "summary", input: "summarize this", risk: "low" }).primary.alias, "nano");
    assert.equal(selectModelRoute({ capability: "comparison", input: "compare these areas", risk: "medium", requiresMcp: true }).primary.alias, "frontier");
    assert.equal(selectModelRoute({ capability: "field_brief", input: "build a brief", risk: "high", requiresMcp: true }).primary.alias, "frontier");
    assert.equal(selectModelRoute({ capability: "field_brief", input: "build a brief", risk: "high", requiresMcp: false }).expectedOutputTokens, 900);
  });
});

test("uses GPT-4.1 as the default operational chat model with current pricing", () => {
  const mini = getModelCatalog().mini;
  assert.equal(mini.id, "gpt-4.1");
  assert.equal(mini.inputCentsPerMillion, 200);
  assert.equal(mini.cachedInputCentsPerMillion, 50);
  assert.equal(mini.outputCentsPerMillion, 800);
  assert.equal(mini.supportsReasoning, false);
  assert.equal(mini.supportsMcp, true);
});

test("uses GPT-4.1 mini for economy and GPT-5.1 none for complex work", () => {
  const catalog = getModelCatalog();
  assert.equal(catalog.nano.id, "gpt-4.1-mini");
  assert.equal(catalog.nano.inputCentsPerMillion, 40);
  assert.equal(catalog.nano.outputCentsPerMillion, 160);
  assert.equal(catalog.frontier.id, "gpt-5.1");
  assert.equal(catalog.frontier.reasoningEffort, "none");
  assert.equal(catalog.frontier.inputCentsPerMillion, 125);
  assert.equal(catalog.frontier.outputCentsPerMillion, 1000);
});

test("blocks every GPT-5.6 model even when an environment override enables it", () => {
  withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier", OPENAI_MODEL_FRONTIER: "gpt-5.6-sol" }, () => {
    assert.equal(getModelCatalog().frontier.enabled, false);
    assert.equal(selectModelRoute({ capability: "field_brief", input: "build a brief" }).primary.id, "gpt-4.1");
  });
});

test("removes disabled models and keeps an ordered fallback chain", () => {
  withEnv({ OPENAI_MODELS_ENABLED: "mini,frontier" }, () => {
    const plan = selectModelRoute({ capability: "classification", input: "route", risk: "low" });
    assert.equal(plan.primary.alias, "mini");
    assert.deepEqual(plan.attempts.map((model) => model.alias), ["mini", "frontier"]);
  });
});

test("honors request cost ceilings by selecting an affordable enabled tier", () => {
  withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    assert.throws(() => selectModelRoute({ capability: "field_brief", input: "x".repeat(80_000), risk: "high", maxCostCents: 1 }), /exceeds its model budget/);
  });
});

test("cost estimation accounts for cached reads and cache writes", () => {
  const model = getModelCatalog().mini;
  const uncached = estimateCostCents(model, 100_000, 20_000);
  const cached = estimateCostCents(model, 100_000, 20_000, 80_000, 0);
  assert.ok(cached <= uncached);
  assert.ok(estimateCostCents(model, 100_000, 20_000, 0, 80_000) >= uncached);
  assert.equal(estimateCostCents(model, 100_000, 20_000), Math.ceil(estimateCostMicrousd(model, 100_000, 20_000) / 10_000));
});

test("meters transcription by provider audio duration at the configured minute rate", () => {
  const model = getModelCatalog().transcription;
  assert.equal(estimateTranscriptionCostMicrousd(model, 60), 3000);
  assert.equal(estimateTranscriptionCostMicrousd(model, 12.5), 625);
});

function response(model, text) {
  return { id: crypto.randomUUID(), model, output_text: text, output: [], usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } };
}

function eventStream(events) {
  return { async *[Symbol.asyncIterator]() { for (const event of events) yield event; } };
}

test("paces streamed prose at readable semantic boundaries", () => {
  const first = takeReadableStreamChunk("Florida has several recent wind reports worth checking. The strongest cluster is still being compared before the crew makes the call.");
  assert.equal(first?.chunk, "Florida has several recent wind reports worth checking. ");
  assert.equal(first?.rest, "The strongest cluster is still being compared before the crew makes the call.");
  assert.ok((first?.pauseMs || 0) >= 250);
  const final = takeReadableStreamChunk(first?.rest || "", true);
  assert.equal(final?.chunk, first?.rest);
  assert.equal(final?.pauseMs, 0);
});

test("paces long unpunctuated output instead of holding the entire response", () => {
  const text = "evidence ".repeat(30);
  const first = takeReadableStreamChunk(text);
  assert.ok(first);
  assert.ok(first.chunk.length <= 168);
  assert.ok(first.rest.length > 0);
});

test("streams provider text deltas and MCP activity without replaying the final answer", async () => {
  await new Promise((resolve, reject) => withEnv({ OPENAI_MODELS_ENABLED: "mini" }, () => {
    const answer = "A useful streamed answer that is long enough to clear the quality threshold safely.";
    const completed = { ...response("gpt-4.1", ""), output: [{ id: "mcp-1", type: "mcp_call", name: "search_storm_events", arguments: "{}", server_label: "storm_signal", status: "completed" }] };
    const client = { responses: { create: async () => eventStream([
      { type: "response.output_item.added", output_index: 0, sequence_number: 1, item: { id: "mcp-1", type: "mcp_call", name: "search_storm_events", arguments: "{}", server_label: "storm_signal", status: "in_progress" } },
      { type: "response.mcp_call.completed", item_id: "mcp-1", output_index: 0, sequence_number: 2 },
      { type: "response.output_text.delta", delta: "A useful streamed ", item_id: "message-1", output_index: 1, content_index: 0, sequence_number: 3, logprobs: [] },
      { type: "response.output_text.delta", delta: "answer that is long enough to clear the quality threshold safely.", item_id: "message-1", output_index: 1, content_index: 0, sequence_number: 4, logprobs: [] },
      { type: "response.completed", response: completed, sequence_number: 5 },
    ]) } };
    const deltas = [];
    const activities = [];
    const route = selectModelRoute({ capability: "weather_chat", input: "Show recent hail", risk: "medium", requiresMcp: true });
    executeRoutedStreamingResponse(client, route, {
      instructions: "Answer.", input: "Show recent hail",
      onTextDelta: (delta) => deltas.push(delta),
      onMcpActivity: (activity) => activities.push(activity),
    }).then((result) => {
      assert.equal(deltas.join(""), answer);
      assert.deepEqual(activities.map((item) => [item.name, item.status]), [["search_storm_events", "running"], ["search_storm_events", "completed"]]);
      assert.equal(result.response.id, completed.id);
      assert.equal(result.attempts[0].status, "succeeded");
      resolve();
    }, reject);
  }));
});

test("streaming routing falls back only before answer text is exposed", async () => {
  await new Promise((resolve, reject) => withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    let calls = 0;
    const completed = response("gpt-4.1", "A complete fallback answer with enough detail to pass the quality boundary safely.");
    const client = { responses: { create: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
      return eventStream([{ type: "response.output_text.delta", delta: completed.output_text, item_id: "message-1", output_index: 0, content_index: 0, sequence_number: 1, logprobs: [] }, { type: "response.completed", response: completed, sequence_number: 2 }]);
    } } };
    const route = selectModelRoute({ capability: "classification", input: "classify", risk: "low" });
    executeRoutedStreamingResponse(client, route, { instructions: "Classify.", input: "classify" }).then((result) => {
      assert.equal(calls, 2);
      assert.equal(result.attempts[0].status, "failed");
      assert.equal(result.attempts[1].status, "succeeded");
      resolve();
    }, reject);
  }));
});

test("falls back after a retryable provider error", async () => {
  await new Promise((resolve, reject) => withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    const calls = [];
    const client = { responses: { create: async (request) => {
      calls.push(request.model);
      if (calls.length === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
      return response(request.model, "A complete and useful response with enough detail to pass the quality boundary safely.");
    } } };
    const route = selectModelRoute({ capability: "classification", input: "classify", risk: "low" });
    executeRoutedResponse(client, route, { instructions: "Classify.", input: "classify" }).then((result) => {
      assert.deepEqual(calls, [route.attempts[0].id, route.attempts[1].id]);
      assert.equal(result.attempts[0].status, "failed");
      assert.equal(result.attempts[1].status, "succeeded");
      resolve();
    }, reject);
  }));
});

test("does not escalate merely because a response misses the quality floor", async () => {
  await new Promise((resolve, reject) => withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    let count = 0;
    const client = { responses: { create: async (request) => { count += 1; return response(request.model, "Too short."); } } };
    const route = selectModelRoute({ capability: "summary", input: "summarize", risk: "low" });
    executeRoutedResponse(client, route, { instructions: "Summarize.", input: "summarize" }).then((result) => {
      assert.equal(result.attempts[0].status, "quality_rejected");
      assert.equal(result.attempts.length, 1);
      assert.equal(count, 1);
      resolve();
    }, reject);
  }));
});

test("reconciles one attempt when deterministic validation rejects quality", async () => {
  await new Promise((resolve, reject) => withEnv({ OPENAI_MODELS_ENABLED: "nano,mini,frontier" }, () => {
    const starts = [];
    const finishes = [];
    const client = { responses: { create: async (request) => response(request.model, "Short.") } };
    const route = selectModelRoute({ capability: "summary", input: "summarize", risk: "low" });
    executeRoutedResponse(client, route, {
      instructions: "Summarize.", input: "summarize",
      onAttemptStart: async ({ attemptNumber, reservationMicrousd }) => {
        starts.push({ attemptNumber, reservationMicrousd });
        return { executionRunId: "run", usageWindowId: "window", usageReservationId: `reservation-${attemptNumber}` };
      },
      onAttemptFinish: async ({ attemptNumber, attempt, lease }) => finishes.push({ attemptNumber, status: attempt.status, reservation: lease.usageReservationId }),
    }).then((result) => {
      assert.deepEqual(starts.map((item) => item.attemptNumber), [1]);
      assert.ok(starts.every((item) => item.reservationMicrousd > 0));
      assert.deepEqual(finishes, [{ attemptNumber: 1, status: "quality_rejected", reservation: "reservation-1" }]);
      assert.equal(result.attempts[0].usageReservationId, "reservation-1");
      resolve();
    }, reject);
  }));
});
