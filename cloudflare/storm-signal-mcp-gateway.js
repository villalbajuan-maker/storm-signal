const SUPABASE_ORIGIN = "https://efzezjfvhkywxukluowh.supabase.co";

function upstreamFor(requestUrl) {
  const incoming = new URL(requestUrl);

  if (incoming.pathname === "/mcp") {
    return new URL(
      `/functions/v1/storm_signal_mcp${incoming.search}`,
      SUPABASE_ORIGIN,
    );
  }

  if (incoming.pathname === "/health") {
    return new URL(
      `/functions/v1/storm_signal_mcp/health${incoming.search}`,
      SUPABASE_ORIGIN,
    );
  }

  return null;
}

export default {
  async fetch(request) {
    const upstream = upstreamFor(request.url);
    if (!upstream) return new Response("Not Found", { status: 404 });
    return fetch(new Request(upstream, request));
  },
};
