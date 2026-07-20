import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { createUsageAttemptLifecycle } from "../lib/usage-metering.ts";
import { chatRequiresMcp, executeRoutedResponse, inferChatCapability, selectModelRoute } from "../lib/openai/model-router.ts";
import { recordModelAttempts } from "../lib/openai/telemetry.ts";

if (!process.argv.includes("--execute")) {
  console.error("Refusing to spend provider budget without --execute.");
  process.exit(2);
}

for (const name of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const cohort = `qa-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const mcpUrl = process.env.STORM_SIGNAL_MCP_URL || "https://mcp.vectoros.co/mcp";

const cycles = [
  {
    name: "normal_signal",
    market: "Florida",
    prompts: [
      "Check Florida for recent hail or damaging-wind evidence from the last 48 hours. Give me only the three areas most worth checking.",
      "From those areas, which one should a roofing crew check first and what evidence supports that call? Keep it concise.",
    ],
  },
  {
    name: "market_comparison",
    market: "Texas",
    prompts: [
      "Find the strongest recent hail or wind signals in Texas from the last 72 hours. Return no more than three candidates.",
      "Compare the top two candidates by recency, severity, and evidence confidence. Tell me which deserves attention first.",
    ],
  },
  {
    name: "complete_brief",
    market: "North Carolina",
    prompts: [
      "Check North Carolina for recent severe-weather evidence relevant to roofing or restoration work. Identify the strongest two areas.",
      "Prioritize those areas and explain the main uncertainty a field crew should verify before driving.",
      "Turn this into a compact field brief with where to check, why it stands out, what to verify, and a practical first move. Keep it under 250 words.",
    ],
  },
  {
    name: "sparse_evidence",
    market: "Louisiana",
    prompts: [
      "Check Louisiana for tornado, hail, or damaging-wind evidence from the last 24 hours. Be direct if evidence is sparse.",
      "Explain what we can responsibly conclude and what we cannot conclude from that evidence. Use short bullets.",
    ],
  },
  {
    name: "extended_field_plan",
    market: "Georgia",
    prompts: [
      "Find recent hail and damaging-wind signals in Georgia from the last seven days. Give me the strongest three areas.",
      "Rank those areas for a mobile roofing crew using recency, severity, and evidence quality. Show the tradeoff briefly.",
      "Build a concise field plan for the highest-ranked area: first stop, what to verify, evidence limitations, and the next decision.",
    ],
  },
];
const focusArgument = process.argv.find((argument) => argument.startsWith("--focus="));
const focus = focusArgument ? new Set(focusArgument.slice("--focus=".length).split(",").filter(Boolean)) : null;
const selectedCycles = focus ? cycles.filter((cycle) => focus.has(cycle.name)) : cycles;
if (!selectedCycles.length) throw new Error("The requested QA focus did not match a cycle.");

const instructions = `You are Storm Signal, a severe-weather intelligence assistant for roofing and restoration crews. Use the Storm Signal MCP for factual weather claims. Separate evidence from inference. Never claim confirmed property damage, guaranteed work, leads, insurance outcomes, or revenue. Answer concisely in practical field language. The authoritative current time is ${new Date().toISOString()}. Resolve relative time windows automatically.`;
const createdMembershipIds = [];
const createdWorkspaceIds = [];
const results = [];
let qaFailure = null;

async function required(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

try {
  const owner = await required(
    admin.from("workspace_members").select("user_id").eq("role", "owner").eq("status", "active").order("created_at").limit(1).maybeSingle(),
    "QA operator",
  );
  if (!owner?.user_id) throw new Error("No active workspace owner is available for controlled QA.");

  for (let cycleIndex = 0; cycleIndex < selectedCycles.length; cycleIndex++) {
    const cycle = selectedCycles[cycleIndex];
    const slug = `storm-signal-controlled-${cohort}-${cycleIndex + 1}`;
    const workspace = await required(
      admin.from("workspaces").insert({
        name: `Controlled QA · ${cycle.name} · ${cohort}`,
        slug,
        primary_market: cycle.market,
        crew_size: "3–5",
        workspace_type: "controlled_qa",
      }).select("id").single(),
      `Create ${cycle.name} workspace`,
    );
    createdWorkspaceIds.push(workspace.id);
    const membership = await required(
      admin.from("workspace_members").insert({
        workspace_id: workspace.id,
        user_id: owner.user_id,
        role: "owner",
        status: "active",
        created_at: "2000-01-01T00:00:00.000Z",
        updated_at: "2000-01-01T00:00:00.000Z",
      }).select("id").single(),
      `Create ${cycle.name} membership`,
    );
    createdMembershipIds.push(membership.id);
    await required(admin.from("entitlements").insert({
      workspace_id: workspace.id,
      plan: "trial",
      status: "active",
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }), `Create ${cycle.name} entitlement`);
    const conversation = await required(
      admin.from("conversations").insert({
        workspace_id: workspace.id,
        created_by: owner.user_id,
        title: `Controlled QA · ${cycle.name}`,
        status: "active",
        context: { qa_cohort: cohort, qa_cycle: cycle.name },
      }).select("id,context").single(),
      `Create ${cycle.name} conversation`,
    );

    let previousResponseId;
    const cycleAttempts = [];
    for (let stepIndex = 0; stepIndex < cycle.prompts.length; stepIndex++) {
      const prompt = cycle.prompts[stepIndex];
      const capability = inferChatCapability(prompt);
      const route = selectModelRoute({
        capability,
        input: prompt,
        contextCharacters: stepIndex * 1_600,
        requiresMcp: chatRequiresMcp(prompt, capability, Boolean(previousResponseId)),
        risk: capability === "field_brief" || capability === "field_plan" ? "high" : "medium",
        maxCostCents: 25,
      });
      const requestId = `${cohort}:${cycleIndex + 1}:${stepIndex + 1}:${crypto.randomUUID()}`;
      let runId = null;
      const lifecycle = createUsageAttemptLifecycle({
        admin,
        userId: owner.user_id,
        workspaceId: workspace.id,
        conversationId: conversation.id,
        requestId,
        operation: "weather_conversation",
        onExecutionStarted: async (executionRunId) => {
          runId = executionRunId;
          await required(admin.from("messages").insert({
            workspace_id: workspace.id,
            conversation_id: conversation.id,
            role: "user",
            content: { text: prompt, qa_cohort: cohort },
            execution_run_id: executionRunId,
            created_by: owner.user_id,
          }), "Persist QA question");
        },
      });

      const routed = await executeRoutedResponse(openai, route, {
        instructions,
        input: prompt,
        previousResponseId,
        tools: [{ type: "mcp", server_label: "storm_signal", server_url: mcpUrl, require_approval: "never" }],
        promptCacheKey: `ss:${workspace.id}:qa-v1`,
        onAttemptStart: lifecycle.onAttemptStart,
        onAttemptFinish: lifecycle.onAttemptFinish,
      });
      runId ||= lifecycle.getRunId();
      previousResponseId = routed.response.id;
      const inputTokens = routed.attempts.reduce((sum, attempt) => sum + attempt.inputTokens, 0);
      const outputTokens = routed.attempts.reduce((sum, attempt) => sum + attempt.outputTokens, 0);
      const costMicrousd = routed.attempts.reduce((sum, attempt) => sum + attempt.estimatedCostMicrousd, 0);
      const toolCount = routed.response.output.filter((item) => item.type === "mcp_call").length;
      await recordModelAttempts(admin, {
        workspaceId: workspace.id,
        userId: owner.user_id,
        conversationId: conversation.id,
        executionRunId: runId,
        operation: "weather_conversation",
        route: routed.route,
        attempts: routed.attempts,
      });
      await required(admin.rpc("finalize_execution_for_user", {
        p_user_id: owner.user_id,
        p_run_id: runId,
        p_status: "succeeded",
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
        p_mcp_calls: toolCount,
        p_estimated_cost_cents: Math.ceil(costMicrousd / 10_000),
        p_error_code: null,
      }), "Finalize QA execution");
      await required(admin.from("execution_runs").update({
        model: routed.response.model || routed.model.id,
        routing_capability: routed.route.capability,
        routing_reason: routed.route.reason,
        retry_count: Math.max(0, routed.attempts.length - 1),
        latency_ms: routed.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
        cached_input_tokens: routed.attempts.reduce((sum, attempt) => sum + attempt.cachedInputTokens, 0),
        cache_write_tokens: routed.attempts.reduce((sum, attempt) => sum + attempt.cacheWriteTokens, 0),
      }).eq("id", runId), "Update QA routing telemetry");
      await required(admin.from("messages").insert({
        workspace_id: workspace.id,
        conversation_id: conversation.id,
        role: "assistant",
        content: { text: routed.response.output_text, status: "complete", qa_cohort: cohort },
        execution_run_id: runId,
        created_by: null,
      }), "Persist QA response");
      await required(admin.from("conversations").update({
        context: { ...conversation.context, qa_cohort: cohort, qa_cycle: cycle.name, openai_response_id: previousResponseId },
        updated_at: new Date().toISOString(),
      }).eq("id", conversation.id), "Update QA conversation");
      cycleAttempts.push(...routed.attempts.map((attempt) => ({
        alias: attempt.alias,
        status: attempt.status,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        cachedInputTokens: attempt.cachedInputTokens,
        costMicrousd: attempt.estimatedCostMicrousd,
        latencyMs: attempt.latencyMs,
      })));
    }

    const cycleCost = cycleAttempts.reduce((sum, attempt) => sum + attempt.costMicrousd, 0);
    results.push({
      cycle: cycle.name,
      operations: cycle.prompts.length,
      attempts: cycleAttempts.length,
      costMicrousd: cycleCost,
      windowPercentage: Number(((cycleCost / 270_000) * 100).toFixed(2)),
      inputTokens: cycleAttempts.reduce((sum, attempt) => sum + attempt.inputTokens, 0),
      outputTokens: cycleAttempts.reduce((sum, attempt) => sum + attempt.outputTokens, 0),
      cachedInputTokens: cycleAttempts.reduce((sum, attempt) => sum + attempt.cachedInputTokens, 0),
      latencyMs: cycleAttempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
      models: [...new Set(cycleAttempts.map((attempt) => attempt.alias))],
      statuses: [...new Set(cycleAttempts.map((attempt) => attempt.status))],
    });
  }
} catch (error) {
  qaFailure = error;
} finally {
  if (createdMembershipIds.length) {
    await admin.from("workspace_members").update({ status: "removed", updated_at: new Date().toISOString() }).in("id", createdMembershipIds);
  }
}

if (qaFailure) {
  if (createdWorkspaceIds.length) await admin.from("workspaces").delete().in("id", createdWorkspaceIds);
  throw qaFailure;
}

const { data: audit, error: auditError } = await admin.rpc("run_usage_metering_audit");
if (auditError) throw auditError;
const { data: readiness, error: readinessError } = await admin.rpc("evaluate_trial_usage_enforcement_readiness");
if (readinessError) throw readinessError;

const totals = results.reduce((summary, cycle) => ({
  operations: summary.operations + cycle.operations,
  attempts: summary.attempts + cycle.attempts,
  costMicrousd: summary.costMicrousd + cycle.costMicrousd,
  inputTokens: summary.inputTokens + cycle.inputTokens,
  outputTokens: summary.outputTokens + cycle.outputTokens,
  latencyMs: summary.latencyMs + cycle.latencyMs,
}), { operations: 0, attempts: 0, costMicrousd: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 });

console.log(JSON.stringify({ cohort, cycles: results, totals, audit, readiness }, null, 2));
