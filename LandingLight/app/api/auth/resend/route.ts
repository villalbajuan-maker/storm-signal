import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueEmailOtp } from "@/lib/auth/email-otp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { intentId?: unknown; email?: unknown };
  try {
    body = (await request.json()) as { intentId?: unknown; email?: unknown };
  } catch {
    return NextResponse.json({ error: "We couldn't send another code." }, { status: 400 });
  }

  const intentId = typeof body.intentId === "string" ? body.intentId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!intentId || !email) return NextResponse.json({ error: "Start a new access request." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: intent, error: intentError } = await admin
      .from("signup_intents")
      .select("id, email, status, expires_at")
      .eq("id", intentId)
      .eq("email", email)
      .single();

    if (intentError || !intent || intent.status !== "pending" || new Date(intent.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This access request has expired. Start again." }, { status: 410 });
    }

    try {
      await issueEmailOtp(email, { allowCreate: true });
    } catch (otpError) {
      console.error("Could not resend signup OTP:", otpError instanceof Error ? otpError.message : "unknown error");
      return NextResponse.json({ error: "We couldn't send another code yet. Please wait and try again." }, { status: 429 });
    }

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("Could not resend Storm Signal access:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't send another code." }, { status: 500 });
  }
}
