import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your searches." }, { status: 401 });

  const conversationId = new URL(request.url).searchParams.get("id");
  if (conversationId) {
    const { data: conversation, error } = await supabase.from("conversations").select("id,title,status,created_at,updated_at").eq("id", conversationId).maybeSingle();
    if (error || !conversation) return NextResponse.json({ error: "That search could not be found." }, { status: 404 });
    const { data: messages, error: messagesError } = await supabase.from("messages").select("id,role,content,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).order("id", { ascending: true });
    if (messagesError) return NextResponse.json({ error: "The conversation could not be loaded." }, { status: 500 });
    return NextResponse.json({ conversation, messages: messages || [] });
  }

  const { data, error } = await supabase.from("conversations").select("id,title,status,created_at,updated_at").eq("status", "active").order("updated_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: "Your searches could not be loaded." }, { status: 500 });
  return NextResponse.json({ conversations: data || [] });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to rename this search." }, { status: 401 });

  let body: { id?: string; title?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "The rename request was not valid." }, { status: 400 }); }

  const id = body.id?.trim();
  const title = body.title?.trim().replace(/\s+/g, " ");
  if (!id || !title) return NextResponse.json({ error: "Give this search a name." }, { status: 400 });
  if (title.length > 80) return NextResponse.json({ error: "Keep the name under 80 characters." }, { status: 400 });

  const { data, error } = await supabase.from("conversations").update({ title }).eq("id", id).select("id,title,status,created_at,updated_at").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "This search could not be renamed." }, { status: 403 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to delete this search." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Choose a search to delete." }, { status: 400 });
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "This search could not be deleted." }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
