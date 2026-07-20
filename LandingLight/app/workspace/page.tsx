import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceClient, { type AuthorizedWorkspace } from "./WorkspaceClient";

export const dynamic = "force-dynamic";

type WorkspaceRow = {
  workspace_id: string;
  role: "owner" | "member";
  workspaces: { id: string; name: string; primary_market: string } | Array<{ id: string; name: string; primary_market: string }>;
};
type UsageSummary = {
  window_started_at: string | null;
  window_ends_at: string | null;
  usage_percentage: number | string | null;
  warning_percentage: number | string | null;
  usage_status: "available" | "almost_used" | "limit_reached";
  enforcement_active: boolean;
};

export default async function WorkspacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=%2Fworkspace");

  const { data: membershipData } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces!inner(id, name, primary_market)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const membership = membershipData as WorkspaceRow | null;
  if (!membership) redirect("/start?reason=no-workspace");

  const { data: entitlement } = await supabase
    .from("entitlements")
    .select("status, ends_at")
    .eq("workspace_id", membership.workspace_id)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Server authorization must compare the entitlement against request time.
  // eslint-disable-next-line react-hooks/purity
  const hasActiveAccess = entitlement?.status === "active" && new Date(entitlement.ends_at).getTime() > Date.now();
  if (!hasActiveAccess) redirect("/workspace/expired");

  const { data: usageData } = await supabase
    .rpc("get_workspace_usage_summary", { p_workspace_id: membership.workspace_id })
    .maybeSingle();
  const usage = usageData as UsageSummary | null;

  const relatedWorkspace = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces;
  const workspace: AuthorizedWorkspace = {
    id: relatedWorkspace.id,
    name: relatedWorkspace.name,
    primaryMarket: relatedWorkspace.primary_market,
    role: membership.role,
    trialEndsAt: entitlement.ends_at,
    usage: {
      windowStartedAt: usage?.window_started_at ?? null,
      windowEndsAt: usage?.window_ends_at ?? null,
      percentage: Number(usage?.usage_percentage ?? 0),
      warningPercentage: Number(usage?.warning_percentage ?? 90),
      status: usage?.usage_status ?? "available",
      enforcementActive: usage?.enforcement_active ?? false,
    },
  };

  return <WorkspaceClient workspace={workspace} />;
}
