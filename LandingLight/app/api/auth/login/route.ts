import { NextResponse } from "next/server";
import { issueEmailOtp } from "@/lib/auth/email-otp";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });

  try {
    await issueEmailOtp(email, { allowCreate: false });

    // Keep this response neutral so the endpoint does not disclose whether an
    // unrelated email address belongs to a Storm Signal account.
    return NextResponse.json({ request: { id: crypto.randomUUID(), email, status: "returning", expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() } });
  } catch (error) {
    console.error("Could not start returning-user access:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't send the access code. Please try again." }, { status: 500 });
  }
}
