import { NextResponse } from "next/server";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.json({ configured: false, authenticated: false });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && error.name !== "AuthSessionMissingError") {
    return NextResponse.json(
      { configured: true, authenticated: false, available: false },
      { status: 503 },
    );
  }

  return NextResponse.json({
    configured: true,
    authenticated: Boolean(user),
    available: true,
  });
}
