import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeRoutedTranscription, selectModelRoute } from "@/lib/openai/model-router";
import { attemptsFromError, recordModelAttempts } from "@/lib/openai/telemetry";
import { createUsageAttemptLifecycle, UsageControlError, usageControlMessage, usageControlStatus } from "@/lib/usage-metering";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use voice input." }, { status: 401 });

  const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
  if (!membership) return NextResponse.json({ error: "No authorized workspace was found." }, { status: 403 });

  const { data: entitlement } = await supabase.from("entitlements").select("status,ends_at").eq("workspace_id", membership.workspace_id).order("starts_at", { ascending: false }).limit(1).maybeSingle();
  if (entitlement?.status !== "active" || new Date(entitlement.ends_at).getTime() <= Date.now()) return NextResponse.json({ error: "Your trial has ended. Choose a plan to continue." }, { status: 402 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Voice input is not configured." }, { status: 503 });
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) return NextResponse.json({ error: "An audio recording is required." }, { status: 400 });

  const prompt = "Storm Signal severe weather, hail, wind, tornadoes, warnings, counties, ZIP areas, roofing, restoration, markets, field planning.";
  const route = selectModelRoute({ capability: "transcription", input: prompt, risk: "low" });
  const admin = createAdminClient();
  let runId: string | null = null;
  try {
    const data = await request.formData();
    const audio = data.get("audio");
    if (!(audio instanceof File) || !audio.size) return NextResponse.json({ error: "An audio recording is required." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Keep the recording under 20 MB." }, { status: 413 });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const usageLifecycle = createUsageAttemptLifecycle({
      admin, userId: user.id, workspaceId: membership.workspace_id, requestId: request.headers.get("x-idempotency-key") || crypto.randomUUID(), operation: "voice_transcription",
      onExecutionStarted: async (executionRunId) => { runId = executionRunId; },
    });
    const routed = await executeRoutedTranscription(client, audio, prompt, usageLifecycle);
    runId = runId || usageLifecycle.getRunId();
    await recordModelAttempts(admin, { workspaceId: membership.workspace_id, userId: user.id, executionRunId: runId, operation: "voice_transcription", route: routed.route, attempts: routed.attempts });
    if (runId) await admin.rpc("finalize_execution_for_user", { p_user_id: user.id, p_run_id: runId, p_status: "succeeded", p_input_tokens: 0, p_output_tokens: 0, p_mcp_calls: 0, p_estimated_cost_cents: routed.attempts.reduce((sum, attempt) => sum + attempt.estimatedCostCents, 0), p_error_code: null });
    return NextResponse.json({ text: routed.transcription.text });
  } catch (error) {
    const attempts = attemptsFromError(error);
    if (attempts.length) await recordModelAttempts(admin, { workspaceId: membership.workspace_id, userId: user.id, executionRunId: runId, operation: "voice_transcription", route, attempts });
    if (runId && attempts.every((attempt) => attempt.estimatedCostMicrousd === 0)) await admin.rpc("void_empty_usage_window_for_run", { p_user_id: user.id, p_run_id: runId });
    if (runId) await admin.rpc("finalize_execution_for_user", { p_user_id: user.id, p_run_id: runId, p_status: "failed", p_input_tokens: 0, p_output_tokens: 0, p_mcp_calls: 0, p_estimated_cost_cents: attempts.reduce((sum, attempt) => sum + attempt.estimatedCostCents, 0), p_error_code: "provider_error" });
    if (error instanceof UsageControlError) return NextResponse.json({ error: usageControlMessage(error), retryAfter: error.retryAfter }, { status: usageControlStatus(error) });
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    console.error("Storm Signal transcription failed:", status);
    return NextResponse.json({ error: status === 401 ? "Voice input could not be authorized." : "The recording could not be transcribed." }, { status: status === 401 ? 401 : 500 });
  }
}
