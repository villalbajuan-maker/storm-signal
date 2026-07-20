import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoutedAttempt, RoutePlan } from "./model-router";

export async function recordModelAttempts(admin: SupabaseClient, context: {
  workspaceId: string;
  userId: string;
  conversationId?: string | null;
  executionRunId?: string | null;
  operation: string;
  route: RoutePlan;
  attempts: RoutedAttempt[];
}) {
  if (!context.attempts.length) return;
  const rows = context.attempts.map((attempt, index) => ({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    conversation_id: context.conversationId || null,
    execution_run_id: context.executionRunId || null,
    operation: context.operation,
    capability: context.route.capability,
    attempt_number: index + 1,
    selected_alias: attempt.alias,
    selected_model: attempt.model,
    selection_reason: attempt.reason,
    status: attempt.status,
    latency_ms: attempt.latencyMs,
    input_tokens: attempt.inputTokens,
    output_tokens: attempt.outputTokens,
    cached_input_tokens: attempt.cachedInputTokens,
    cache_write_tokens: attempt.cacheWriteTokens,
    audio_duration_seconds: attempt.audioDurationSeconds || 0,
    usage_window_id: attempt.usageWindowId || null,
    usage_reservation_id: attempt.usageReservationId || null,
    estimated_cost_microusd: attempt.estimatedCostMicrousd,
    estimated_cost_cents: attempt.estimatedCostCents,
    error_code: attempt.errorCode,
  }));
  const { error } = await admin.from("model_operation_logs").insert(rows);
  if (error) console.error("Model telemetry could not be recorded:", error.code);
}

export function attemptsFromError(error: unknown): RoutedAttempt[] {
  if (typeof error === "object" && error && "routingAttempts" in error && Array.isArray(error.routingAttempts)) return error.routingAttempts as RoutedAttempt[];
  return [];
}
