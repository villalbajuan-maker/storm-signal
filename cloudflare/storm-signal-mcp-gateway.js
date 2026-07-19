const SUPABASE_ORIGIN = "https://efzezjfvhkywxukluowh.supabase.co";

async function iconResponse(request, env) {
  const assetUrl = new URL("/storm-signal-logo.png", request.url);
  const asset = await env.ASSETS.fetch(assetUrl);
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "image/png");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(asset.body, { status: asset.status, headers });
}

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
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/favicon.png" || path === "/favicon.ico") {
      return iconResponse(request, env);
    }
    const upstream = upstreamFor(request.url);
    if (!upstream) return new Response("Not Found", { status: 404 });
    return fetch(new Request(upstream, request));
  },
};
