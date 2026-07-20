import { createClient } from "@supabase/supabase-js";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) throw new Error("Pass the user email as the first argument.");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase admin configuration is required.");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user = null;
for (let page = 1; page <= 20 && !user; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;
  if (data.users.length < 1000) break;
}
if (!user) throw new Error(`No auth user found for ${email}.`);

const { data: conversation, error: conversationError } = await admin
  .from("conversations")
  .select("id,workspace_id,title,created_at,updated_at")
  .eq("created_by", user.id)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (conversationError) throw conversationError;
if (!conversation) throw new Error(`No conversation found for ${email}.`);

const [{ data: messages, error: messagesError }, { data: runs, error: runsError }] = await Promise.all([
  admin.from("messages").select("id,role,content,execution_run_id,created_at").eq("conversation_id", conversation.id).order("created_at", { ascending: true }),
  admin.from("execution_runs").select("id,status,model,input_tokens,output_tokens,mcp_calls,estimated_cost_cents,estimated_cost_microusd,reserved_cost_microusd,routing_capability,retry_count,latency_ms,cached_input_tokens,cache_write_tokens,error_code,usage_window_id,created_at,completed_at").eq("conversation_id", conversation.id).eq("user_id", user.id).order("created_at", { ascending: true }),
]);
if (messagesError) throw messagesError;
if (runsError) throw runsError;

const runIds = (runs || []).map((run) => run.id);
const windowIds = [...new Set((runs || []).map((run) => run.usage_window_id).filter(Boolean))];
const [{ data: attempts, error: attemptsError }, { data: reservations, error: reservationsError }, { data: windows, error: windowsError }] = await Promise.all([
  runIds.length ? admin.from("model_operation_logs").select("execution_run_id,attempt_number,selected_alias,selected_model,status,latency_ms,input_tokens,output_tokens,cached_input_tokens,cache_write_tokens,estimated_cost_cents,estimated_cost_microusd,error_code,created_at").in("execution_run_id", runIds).order("created_at", { ascending: true }) : { data: [], error: null },
  runIds.length ? admin.from("usage_reservations").select("id,usage_window_id,execution_run_id,attempt_number,capability,selected_alias,selected_model,status,reserved_microusd,actual_microusd,created_at,reconciled_at").in("execution_run_id", runIds).order("created_at", { ascending: true }) : { data: [], error: null },
  windowIds.length ? admin.from("usage_windows").select("id,status,started_at,ends_at,budget_microusd,used_microusd,reserved_microusd,warning_percentage,warning_reached_at,exhausted_at").in("id", windowIds).order("started_at", { ascending: true }) : { data: [], error: null },
]);
if (attemptsError) throw attemptsError;
if (reservationsError) throw reservationsError;
if (windowsError) throw windowsError;

const [{ data: allWindowReservations, error: allWindowReservationsError }, { data: allWindowRuns, error: allWindowRunsError }, { data: windowEvents, error: windowEventsError }] = await Promise.all([
  windowIds.length ? admin.from("usage_reservations").select("id,usage_window_id,execution_run_id,user_id,attempt_number,capability,selected_alias,selected_model,status,reserved_microusd,actual_microusd,created_at,reconciled_at").in("usage_window_id", windowIds).order("created_at", { ascending: true }) : { data: [], error: null },
  windowIds.length ? admin.from("execution_runs").select("id,conversation_id,user_id,status,model,input_tokens,output_tokens,mcp_calls,estimated_cost_microusd,error_code,created_at,completed_at,usage_window_id").in("usage_window_id", windowIds).order("created_at", { ascending: true }) : { data: [], error: null },
  windowIds.length ? admin.from("usage_window_events").select("usage_window_id,execution_run_id,event_type,details,occurred_at").in("usage_window_id", windowIds).order("occurred_at", { ascending: true }) : { data: [], error: null },
]);
if (allWindowReservationsError) throw allWindowReservationsError;
if (allWindowRunsError) throw allWindowRunsError;
if (windowEventsError) throw windowEventsError;

const compactMessage = (message) => {
  const text = typeof message.content?.text === "string" ? message.content.text : "";
  return {
    role: message.role,
    createdAt: message.created_at,
    characters: text.length,
    preview: text.replace(/\s+/g, " ").slice(0, 500),
    tools: Array.isArray(message.content?.tools) ? message.content.tools : [],
    status: message.content?.status || null,
    executionRunId: message.execution_run_id,
  };
};

const total = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  email,
  conversation,
  messages: (messages || []).map(compactMessage),
  totals: {
    turns: (runs || []).length,
    inputTokens: total(runs || [], "input_tokens"),
    outputTokens: total(runs || [], "output_tokens"),
    cachedInputTokens: total(runs || [], "cached_input_tokens"),
    cacheWriteTokens: total(runs || [], "cache_write_tokens"),
    mcpCalls: total(runs || [], "mcp_calls"),
    estimatedCostMicrousd: total(runs || [], "estimated_cost_microusd"),
    estimatedCostUsd: Number((total(runs || [], "estimated_cost_microusd") / 1_000_000).toFixed(6)),
  },
  runs,
  attempts,
  reservations,
  allWindowReservations,
  allWindowRuns,
  windowEvents,
  windows: (windows || []).map((window) => ({
    ...window,
    usagePercentage: Number(window.budget_microusd) ? Number(((Number(window.used_microusd) + Number(window.reserved_microusd)) / Number(window.budget_microusd) * 100).toFixed(2)) : null,
  })),
}, null, 2));
