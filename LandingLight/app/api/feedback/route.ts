import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const allowedReasons = new Set(["incorrect", "not_relevant", "unclear", "missing_evidence", "other"]);

export async function POST(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to send feedback." }, { status: 401 });
  let body: { messageId?: string; rating?: string; reasons?: string[]; details?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The feedback was not valid." }, { status: 400 }); }
  if (!body.messageId || !["up", "down"].includes(body.rating || "")) return NextResponse.json({ error: "Choose a response and a rating." }, { status: 400 });
  const reasons = Array.isArray(body.reasons) ? [...new Set(body.reasons.filter((reason) => allowedReasons.has(reason)))].slice(0, 5) : [];
  const details = body.details?.trim().slice(0, 1200) || null;
  const admin = createAdminClient();
  const { data: message } = await admin.from("messages").select("id,workspace_id,conversation_id,role").eq("id", body.messageId).eq("role", "assistant").maybeSingle();
  if (!message) return NextResponse.json({ error: "That response could not be found." }, { status: 404 });
  const { data: membership } = await admin.from("workspace_members").select("id").eq("workspace_id", message.workspace_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!membership) return NextResponse.json({ error: "You cannot review that response." }, { status: 403 });
  const { data, error } = await admin.from("message_feedback").upsert({
    workspace_id: message.workspace_id, conversation_id: message.conversation_id, message_id: message.id, user_id: user.id,
    rating: body.rating, reasons: body.rating === "down" ? reasons : [], details: body.rating === "down" ? details : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "message_id,user_id" }).select("rating,reasons,details").single();
  if (error) return NextResponse.json({ error: "Your feedback could not be saved." }, { status: 500 });
  return NextResponse.json({ feedback: data });
}
