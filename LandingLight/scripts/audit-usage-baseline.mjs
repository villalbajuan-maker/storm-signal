import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const readAll = async (table, columns, order = "created_at") => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(order, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
};

const round = (value, digits = 2) => Number(value.toFixed(digits));
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
const summarizeCosts = (values) => ({
  count: values.length,
  totalCents: values.reduce((sum, value) => sum + value, 0),
  averageCents: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
  p50Cents: percentile(values, 0.5),
  p90Cents: percentile(values, 0.9),
  maxCents: values.length ? Math.max(...values) : 0,
});
const groupSummary = (rows, key) => Object.fromEntries(
  [...new Set(rows.map((row) => row[key] || "unknown"))].sort().map((value) => [
    value,
    {
      ...summarizeCosts(rows.filter((row) => (row[key] || "unknown") === value).map((row) => row.estimated_cost_cents || 0)),
      inputTokens: rows.filter((row) => (row[key] || "unknown") === value).reduce((sum, row) => sum + (row.input_tokens || 0), 0),
      outputTokens: rows.filter((row) => (row[key] || "unknown") === value).reduce((sum, row) => sum + (row.output_tokens || 0), 0),
      cachedInputTokens: rows.filter((row) => (row[key] || "unknown") === value).reduce((sum, row) => sum + (row.cached_input_tokens || 0), 0),
    },
  ]),
);

const [runs, attempts, conversations, messages, artifacts] = await Promise.all([
  readAll("execution_runs", "id,workspace_id,user_id,conversation_id,status,model,input_tokens,output_tokens,mcp_calls,estimated_cost_cents,error_code,started_at,completed_at,created_at,routing_capability,retry_count,latency_ms,cached_input_tokens,cache_write_tokens"),
  readAll("model_operation_logs", "id,workspace_id,user_id,conversation_id,execution_run_id,operation,capability,attempt_number,selected_alias,selected_model,status,latency_ms,input_tokens,output_tokens,cached_input_tokens,cache_write_tokens,estimated_cost_cents,error_code,created_at"),
  readAll("conversations", "id,workspace_id,title,created_at,updated_at"),
  readAll("messages", "id,workspace_id,conversation_id,role,execution_run_id,created_at"),
  readAll("artifacts", "id,workspace_id,conversation_id,type,status,created_at"),
]);

const successfulRuns = runs.filter((run) => run.status === "succeeded");
const routedRuns = successfulRuns.filter((run) => run.routing_capability);
const attemptsByRun = new Map();
for (const attempt of attempts) {
  const list = attemptsByRun.get(attempt.execution_run_id) || [];
  list.push(attempt);
  attemptsByRun.set(attempt.execution_run_id, list);
}

const conversationRows = conversations.map((conversation) => {
  const ownRuns = successfulRuns.filter((run) => run.conversation_id === conversation.id);
  const ownMessages = messages.filter((message) => message.conversation_id === conversation.id);
  const ownArtifacts = artifacts.filter((artifact) => artifact.conversation_id === conversation.id);
  return {
    conversationId: conversation.id,
    workspaceId: conversation.workspace_id,
    title: conversation.title,
    successfulOperations: ownRuns.length,
    userMessages: ownMessages.filter((message) => message.role === "user").length,
    assistantMessages: ownMessages.filter((message) => message.role === "assistant").length,
    artifacts: ownArtifacts.map((artifact) => artifact.type),
    costCents: ownRuns.reduce((sum, run) => sum + (run.estimated_cost_cents || 0), 0),
    inputTokens: ownRuns.reduce((sum, run) => sum + (run.input_tokens || 0), 0),
    outputTokens: ownRuns.reduce((sum, run) => sum + (run.output_tokens || 0), 0),
    mcpCalls: ownRuns.reduce((sum, run) => sum + (run.mcp_calls || 0), 0),
    firstActivity: ownMessages[0]?.created_at || conversation.created_at,
    lastActivity: ownMessages.at(-1)?.created_at || conversation.updated_at,
  };
}).filter((row) => row.userMessages > 0 || row.successfulOperations > 0);

const workspaceRows = [...new Set(runs.map((run) => run.workspace_id))].map((workspaceId) => {
  const ownRuns = successfulRuns.filter((run) => run.workspace_id === workspaceId);
  return {
    workspaceId,
    successfulOperations: ownRuns.length,
    costCents: ownRuns.reduce((sum, run) => sum + (run.estimated_cost_cents || 0), 0),
    conversations: new Set(ownRuns.map((run) => run.conversation_id).filter(Boolean)).size,
  };
});

const cacheEligibleInput = attempts.reduce((sum, row) => sum + (row.input_tokens || 0), 0);
const cachedInput = attempts.reduce((sum, row) => sum + (row.cached_input_tokens || 0), 0);

const report = {
  generatedAt: new Date().toISOString(),
  coverage: {
    firstExecutionAt: runs[0]?.created_at || null,
    lastExecutionAt: runs.at(-1)?.created_at || null,
    firstRoutedAttemptAt: attempts[0]?.created_at || null,
    lastRoutedAttemptAt: attempts.at(-1)?.created_at || null,
    workspaces: workspaceRows.length,
    conversationsWithActivity: conversationRows.length,
    executionRuns: runs.length,
    routedAttempts: attempts.length,
    artifacts: artifacts.length,
  },
  successfulOperations: summarizeCosts(successfulRuns.map((run) => run.estimated_cost_cents || 0)),
  routedSuccessfulOperations: summarizeCosts(routedRuns.map((run) => run.estimated_cost_cents || 0)),
  byModel: groupSummary(attempts, "selected_model"),
  byCapability: groupSummary(attempts, "capability"),
  reliability: {
    failedRuns: runs.filter((run) => run.status === "failed").length,
    canceledRuns: runs.filter((run) => run.status === "canceled").length,
    retriedRuns: runs.filter((run) => (run.retry_count || 0) > 0).length,
    qualityRejectedAttempts: attempts.filter((attempt) => attempt.status === "quality_rejected").length,
    failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
  },
  latencyMs: {
    p50: percentile(routedRuns.map((run) => run.latency_ms || 0), 0.5),
    p90: percentile(routedRuns.map((run) => run.latency_ms || 0), 0.9),
    max: routedRuns.length ? Math.max(...routedRuns.map((run) => run.latency_ms || 0)) : 0,
  },
  cache: {
    inputTokens: cacheEligibleInput,
    cachedInputTokens: cachedInput,
    cachedSharePercentage: cacheEligibleInput ? round((cachedInput / cacheEligibleInput) * 100) : 0,
  },
  conversations: {
    cost: summarizeCosts(conversationRows.map((row) => row.costCents)),
    withAtLeastFourUserTurns: conversationRows.filter((row) => row.userMessages >= 4).length,
    withArtifacts: conversationRows.filter((row) => row.artifacts.length).length,
    highestCost: [...conversationRows].sort((a, b) => b.costCents - a.costCents).slice(0, 10),
  },
  workspaces: {
    cost: summarizeCosts(workspaceRows.map((row) => row.costCents)),
    highestCost: [...workspaceRows].sort((a, b) => b.costCents - a.costCents).slice(0, 10),
  },
  caveats: [
    "Costs are operational estimates from the configured model catalog, not provider invoices.",
    "Model-attempt telemetry only covers executions after the routing migration was deployed.",
    "Conversation totals are lifetime totals and do not yet simulate fixed five-hour windows.",
    "A complete product arc requires explicit scenario labeling or artifact persistence to identify reliably.",
  ],
};

console.log(JSON.stringify(report, null, 2));
