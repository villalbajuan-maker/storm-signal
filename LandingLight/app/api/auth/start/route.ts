import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueEmailOtp } from "@/lib/auth/email-otp";

export const runtime = "nodejs";

const MARKETS = new Set(["Texas", "Florida", "Louisiana", "Georgia", "North Carolina"]);
const CREW_SIZES = new Set(["1", "2-5", "6-15", "16+"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StartBody = { email?: unknown; company?: unknown; market?: unknown; crewSize?: unknown };
const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: Request) {
  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Please check the form and try again." }, { status: 400 });
  }

  const email = clean(body.email).toLowerCase();
  const companyName = clean(body.company);
  const primaryMarket = clean(body.market);
  const crewSize = clean(body.crewSize);
  if (!EMAIL_PATTERN.test(email) || companyName.length < 2 || companyName.length > 160 || !MARKETS.has(primaryMarket) || !CREW_SIZES.has(crewSize)) {
    return NextResponse.json({ error: "Please complete every field with valid information." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await admin
      .from("signup_intents")
      .select("id, created_at")
      .eq("email", email)
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(5);
    if (recentError) throw recentError;

    const latest = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
    const retryAfter = Math.ceil((latest + 60_000 - Date.now()) / 1000);
    if (retryAfter > 0) {
      return NextResponse.json({ error: `Please wait ${retryAfter} seconds before requesting another code.`, retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    if ((recent?.length ?? 0) >= 5) {
      return NextResponse.json({ error: "Too many access-code requests. Please try again later." }, { status: 429, headers: { "Retry-After": "3600" } });
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: intent, error: intentError } = await admin
      .from("signup_intents")
      .insert({ email, company_name: companyName, primary_market: primaryMarket, crew_size: crewSize, expires_at: expiresAt })
      .select("id, expires_at")
      .single();
    if (intentError) throw intentError;

    try {
      await issueEmailOtp(email, { allowCreate: true });
    } catch (otpError) {
      await admin.from("signup_intents").update({ status: "expired" }).eq("id", intent.id);
      console.error("Could not issue signup OTP:", otpError instanceof Error ? otpError.message : "unknown error");
      return NextResponse.json({ error: "We couldn't send the access code. Please try again shortly." }, { status: 502 });
    }

    return NextResponse.json({ intent: { id: intent.id, email, company: companyName, market: primaryMarket, crewSize, status: "pending", expiresAt: intent.expires_at } });
  } catch (error) {
    console.error("Could not start Storm Signal access:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Storm Signal couldn't start access right now. Please try again." }, { status: 500 });
  }
}
