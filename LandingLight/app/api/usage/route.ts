import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to view usage." }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "No authorized workspace was found." }, { status: 403 });

  const { data, error } = await supabase
    .rpc("get_workspace_usage_summary", { p_workspace_id: membership.workspace_id })
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Usage is temporarily unavailable." }, { status: 503 });
  return NextResponse.json({ usage: data }, { headers: { "cache-control": "private, no-store" } });
}
