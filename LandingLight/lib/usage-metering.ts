import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptLease, ModelConfig, RoutePlan, RoutedAttempt } from "./openai/model-router";

type ReservationRow = {
  run_id?: string | null;
  window_id?: string | null;
  reservation_id?: string | null;
  result_code?: string | null;
  retry_after_seconds?: number | null;
  would_block?: boolean | null;
  usage_percentage?: number | string | null;
};

export class UsageControlError extends Error {
  code: string;
  retryAfter: number;
  constructor(code: string, retryAfter = 0) {
    super(code);
    this.name = "UsageControlError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function usageControlMessage(error: UsageControlError) {
  if (error.code === "entitlement_inactive") return "Your trial has ended. Choose a plan to continue.";
  if (error.code === "duplicate") return "That request is already being processed.";
  if (error.code === "concurrent_limit") return "One investigation is already running. Let it finish before starting another.";
  if (error.code === "minute_limit") return "That was a lot at once. Wait a minute, then keep going.";
  if (error.code === "daily_limit") return "Your current usage window is full. Check Usage for the exact reopening time.";
  if (error.code === "legacy_period_budget") return "This workspace has reached its current usage allowance.";
  if (["window_limit", "period_budget", "operation_limit"].includes(error.code)) return "You’ve reached your current usage limit.";
  return "Usage controls are temporarily unavailable.";
}

export function usageControlStatus(error: UsageControlError) {
  if (error.code === "entitlement_inactive") return 402;
  if (error.code === "duplicate") return 409;
  if (["concurrent_limit", "minute_limit", "daily_limit", "legacy_period_budget", "window_limit", "period_budget", "operation_limit"].includes(error.code)) return 429;
  return 503;
}

export function createUsageAttemptLifecycle(context: {
  admin: SupabaseClient;
  userId: string;
  workspaceId: string;
  conversationId?: string | null;
  requestId: string;
  operation: string;
  onExecutionStarted?: (runId: string, windowId: string) => Promise<void>;
}) {
  let runId: string | null = null;
  let windowId: string | null = null;

  const onAttemptStart = async ({ attemptNumber, model, route, reservationMicrousd }: {
    attemptNumber: number;
    model: ModelConfig;
    route: RoutePlan;
    reservationMicrousd: number;
  }): Promise<AttemptLease> => {
    const { data, error } = await context.admin.rpc("authorize_and_reserve_usage_attempt_for_user", {
      p_user_id: context.userId,
      p_workspace_id: context.workspaceId,
      p_conversation_id: context.conversationId || null,
      p_idempotency_key: context.requestId,
      p_execution_run_id: runId,
      p_attempt_number: attemptNumber,
      p_operation: context.operation,
      p_capability: route.capability,
      p_selected_alias: model.alias,
      p_selected_model: model.id,
      p_reserved_microusd: reservationMicrousd,
    }).single();
    if (error) throw error;
    const result = data as ReservationRow | null;
    const code = result?.result_code || "usage_unavailable";
    if (!["reserved", "shadow_reserved", "duplicate"].includes(code) || !result?.run_id || !result.window_id || !result.reservation_id) {
      throw new UsageControlError(code, Number(result?.retry_after_seconds || 0));
    }
    const firstExecution = !runId;
    runId = result.run_id;
    windowId = result.window_id;
    if (firstExecution && context.onExecutionStarted) {
      try { await context.onExecutionStarted(runId, windowId); }
      catch (startError) {
        await context.admin.rpc("reconcile_usage_attempt_for_user", {
          p_user_id: context.userId,
          p_reservation_id: result.reservation_id,
          p_outcome: "failed_nonbillable",
          p_actual_microusd: 0,
        });
        throw startError;
      }
    }
    return { executionRunId: runId, usageWindowId: windowId, usageReservationId: result.reservation_id };
  };

  const onAttemptFinish = async ({ attempt, lease, willRetry }: { attempt: RoutedAttempt; lease?: AttemptLease; willRetry: boolean }) => {
    if (!lease?.usageReservationId) throw new Error("Usage reservation identity is missing.");
    const outcome = attempt.status === "succeeded" ? "succeeded" : attempt.status === "quality_rejected" ? "quality_rejected" : willRetry ? "failed_billable" : "failed_nonbillable";
    const { data, error } = await context.admin.rpc("reconcile_usage_attempt_for_user", {
      p_user_id: context.userId,
      p_reservation_id: lease.usageReservationId,
      p_outcome: outcome,
      p_actual_microusd: attempt.estimatedCostMicrousd,
    });
    if (error) throw error;
    const result = data as { result_code?: string } | null;
    if (!result || !["reconciled", "already_reconciled"].includes(result.result_code || "")) throw new Error("Usage reconciliation was not accepted.");
  };

  return {
    onAttemptStart,
    onAttemptFinish,
    voidEmptyTerminalWindow: async () => {
      if (!runId) return false;
      const { data, error } = await context.admin.rpc("void_empty_usage_window_for_run", {
        p_user_id: context.userId,
        p_run_id: runId,
      });
      if (error) throw error;
      return data === true;
    },
    getRunId: () => runId,
    getWindowId: () => windowId,
  };
}
