import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ExpiredWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=%2Fworkspace%2Fexpired");

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/start?reason=no-workspace");

  const { data: entitlement } = await supabase
    .from("entitlements")
    .select("status, ends_at")
    .eq("workspace_id", membership.workspace_id)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (entitlement?.status === "active" && new Date(entitlement.ends_at).getTime() > Date.now()) redirect("/workspace");
  return children;
}
