const PROTOCOL_VERSION = "2025-11-25"
const SERVER_INFO = {
  name: "storm-signal",
  title: "Storm Signal",
  version: "0.1.0",
  description: "Persistent severe-weather intelligence for operational analysis.",
  websiteUrl: "https://vectoros.co",
  icons: [{
    src: "https://mcp.vectoros.co/favicon.png",
    mimeType: "image/png",
    sizes: ["500x500"],
  }],
}
const EVENT_TYPES = ["hail_report", "severe_thunderstorm_warning", "tornado_warning", "wind_report", "tornado_report", "historical_hail_event"]
const LIMITATIONS = [
  "Warnings describe forecast or warned areas; they do not prove hail at a property.",
  "SPC reports are preliminary observer points, not hail footprints, and may be corrected.",
  "SPC wind and tornado reports are preliminary observation points; unknown speed or scale is preserved rather than inferred.",
  "Historical coordinates can be approximate or absent.",
  "This evidence does not establish property damage, roof condition, or sales qualification.",
]
const COVERAGE_MESSAGE = "This location is not yet part of Storm Signal's controlled demo coverage. We currently provide commercial analysis for Texas, Florida, Louisiana, Georgia, and North Carolina. Coverage for additional states is coming soon."
const IN_COVERAGE_MESSAGE = "This request is within Storm Signal's controlled demo coverage for Texas, Florida, Louisiana, Georgia, and North Carolina."
const WINDOW_DAYS = 14

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Args = Record<string, unknown>

function schema(properties: Record<string, Json>, required: string[] = []) {
  const value: Record<string, Json> = { type: "object", properties, additionalProperties: false }
  if (required.length) value.required = required
  return value
}

const TOOLS = [
  {
    name: "search_storm_events",
    description: "Search recent events within the controlled demo coverage: Texas, Florida, Louisiana, Georgia, and North Carolina. Searches without a location default to all five states; the available evidence window is 14 days.",
    inputSchema: schema({
      start_at: { type: "string", format: "date-time" }, end_at: { type: "string", format: "date-time" },
      event_types: { type: "array", items: { type: "string", enum: EVENT_TYPES } }, state: { type: "string" }, county: { type: "string" },
      place: { type: "string" }, zcta: { type: "string", pattern: "^[0-9]{5}$" },
      min_hail_inches: { type: "number", minimum: 0 }, status: { type: "string" },
      latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 },
      radius_miles: { type: "number", exclusiveMinimum: 0, maximum: 500 }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_storm_event",
    description: "Get one normalized event only when it belongs to the five-state controlled demo coverage, with retained source payload versions, Census geography, and evidence limitations.",
    inputSchema: schema({ event_id: { type: "string", format: "uuid" } }, ["event_id"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "assess_location",
    description: "Produce a deterministic evidence score for a covered location in TX, FL, LA, GA, or NC over the available 14-day window. It never claims that a property was hit or damaged.",
    inputSchema: schema({
      latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 },
      start_at: { type: "string", format: "date-time" }, end_at: { type: "string", format: "date-time" },
      radius_miles: { type: "number", exclusiveMinimum: 0, maximum: 100, default: 10 },
    }, ["latitude", "longitude", "start_at", "end_at"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "summarize_storm_activity",
    description: "Aggregate storm activity only for TX, FL, LA, GA, and NC. Unlocated requests default to all five states, and requested windows are limited to the latest 14 days.",
    inputSchema: schema({
      start_at: { type: "string", format: "date-time" }, end_at: { type: "string", format: "date-time" },
      group_by: { type: "string", enum: ["event_type", "state", "county", "day"], default: "event_type" },
      state: { type: "string" }, event_types: { type: "array", items: { type: "string", enum: EVENT_TYPES } },
    }, ["start_at", "end_at"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, accept, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
}

function response(body: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = { ...cors, ...extra }
  if (body === null) return new Response(null, { status, headers })
  return Response.json(body, { status, headers })
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

function searchParams(a: Args) {
  return {
    p_start_at: a.start_at ?? null, p_end_at: a.end_at ?? null, p_event_types: a.event_types ?? null,
    p_state: a.state ?? null, p_county: a.county ?? null, p_place: a.place ?? null, p_zcta: a.zcta ?? null,
    p_min_hail_inches: a.min_hail_inches ?? null,
    p_status: a.status ?? null, p_lat: a.latitude ?? null, p_lon: a.longitude ?? null,
    p_radius_miles: a.radius_miles ?? null, p_limit: a.limit ?? 50,
  }
}

function validate(name: string, a: Args) {
  if (!TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`)
  if (name === "get_storm_event" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(a.event_id ?? ""))) throw new Error("event_id must be a UUID")
  if (["assess_location", "summarize_storm_activity"].includes(name)) {
    if (!a.start_at || !a.end_at) throw new Error("start_at and end_at are required")
    if (Number.isNaN(Date.parse(String(a.start_at))) || Number.isNaN(Date.parse(String(a.end_at)))) throw new Error("Invalid date-time")
    if (Date.parse(String(a.start_at)) > Date.parse(String(a.end_at))) throw new Error("start_at must be before end_at")
  }
  const hasLat = a.latitude !== undefined, hasLon = a.longitude !== undefined
  if (hasLat !== hasLon) throw new Error("latitude and longitude must be provided together")
  if (hasLat && (!(Number(a.latitude) >= -90 && Number(a.latitude) <= 90) || !(Number(a.longitude) >= -180 && Number(a.longitude) <= 180))) throw new Error("Invalid latitude or longitude")
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<any> {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("Supabase backend credentials are unavailable")
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json", Accept: "application/json" }
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(parameters) })
  if (!result.ok) throw new Error(`Database RPC ${name} failed (${result.status})`)
  return result.status === 204 ? null : await result.json()
}

function presentGeography(value: any) {
  const areas = Array.isArray(value?.areas) ? value.areas : []
  const area = (type: string) => areas.find((item: any) => item.area_type === type)
  return {
    ...value,
    summary: {
      state: area("state")?.name ?? null,
      county: area("county")?.name ?? null,
      place: area("place")?.name ?? null,
      zcta_approximate_zip_area: area("zcta")?.zcta5 ?? null,
    },
    zcta_interpretation: "ZCTA is an approximate ZIP area from Census geography, not a USPS delivery boundary.",
  }
}

function effectiveWindow(a: Args) {
  const now = new Date()
  const availableStart = new Date(now.getTime() - WINDOW_DAYS * 86400000)
  const requestedStart = a.start_at ? new Date(String(a.start_at)) : null
  const requestedEnd = a.end_at ? new Date(String(a.end_at)) : null
  const effectiveStart = requestedStart && requestedStart > availableStart ? requestedStart : availableStart
  const effectiveEnd = requestedEnd && requestedEnd < now ? requestedEnd : now
  return {
    requested_start_at: requestedStart?.toISOString() ?? null,
    requested_end_at: requestedEnd?.toISOString() ?? null,
    effective_start_at: effectiveStart.toISOString(),
    effective_end_at: effectiveEnd.toISOString(),
    available_window_days: WINDOW_DAYS,
    truncated: Boolean((requestedStart && requestedStart < availableStart) || (requestedEnd && requestedEnd > now)),
    defaulted: !requestedStart || !requestedEnd,
  }
}

function unavailable(trace_id: string, generated_at: string, data_health: any, coverage: any, window: any) {
  return {
    trace_id, generated_at, status: coverage?.status ?? "out_of_coverage",
    message: COVERAGE_MESSAGE, coverage, window, data_health,
    events: [], count: 0, limitations: LIMITATIONS,
  }
}

function presentCoverage(value: any) {
  return { ...value, message: value?.status === "in_coverage" ? IN_COVERAGE_MESSAGE : COVERAGE_MESSAGE }
}

async function callTool(name: string, a: Args) {
  validate(name, a)
  const trace_id = crypto.randomUUID(), generated_at = new Date().toISOString()
  const data_health = await rpc("mcp_data_health", {})
  const window = effectiveWindow(a)
  if (name === "get_storm_event") {
    const coverage = presentCoverage(await rpc("mcp_check_event_coverage", { p_event_id: a.event_id }))
    if (coverage?.status === "not_found") throw new Error("Storm event not found")
    if (coverage?.status !== "in_coverage") return unavailable(trace_id, generated_at, data_health, coverage, null)
    const data = await rpc("mcp_get_storm_event", { p_event_id: a.event_id })
    if (!data) throw new Error("Storm event not found")
    const geography = presentGeography(await rpc("mcp_get_event_geographies", { p_event_id: a.event_id }))
    return { trace_id, generated_at, status: "in_coverage", coverage, data_health, ...data, geography, limitations: LIMITATIONS }
  }
  const coverage = presentCoverage(await rpc("mcp_check_coverage", {
    p_state: a.state ?? null, p_lat: a.latitude ?? null, p_lon: a.longitude ?? null,
  }))
  if (coverage?.status !== "in_coverage") return unavailable(trace_id, generated_at, data_health, coverage, window)
  if (name === "search_storm_events") {
    const events = await rpc("mcp_search_storm_events", searchParams({ ...a, radius_miles: a.radius_miles ?? (a.latitude !== undefined ? 10 : null) })) ?? []
    return { trace_id, generated_at, status: "in_coverage", coverage, window, data_health, events, count: events.length, limitations: LIMITATIONS }
  }
  if (name === "summarize_storm_activity") {
    const groups = await rpc("mcp_summarize_storm_activity", { p_start_at: a.start_at, p_end_at: a.end_at, p_group_by: a.group_by ?? "event_type", p_state: a.state ?? null, p_event_types: a.event_types ?? null }) ?? []
    return { trace_id, generated_at, status: "in_coverage", coverage, window, data_health, groups, group_by: a.group_by ?? "event_type", limitations: LIMITATIONS }
  }
  const radius = Number(a.radius_miles ?? 10)
  const events = await rpc("mcp_search_storm_events", searchParams({ ...a, radius_miles: radius, limit: 200 })) ?? []
  const reports = events.filter((e: any) => e.event_type === "hail_report")
  const warnings = events.filter((e: any) => ["severe_thunderstorm_warning", "tornado_warning"].includes(e.event_type))
  const historical = events.filter((e: any) => e.event_type === "historical_hail_event")
  let score = 0
  const score_reasons: { points: number; reason: string }[] = []
  const add = (points: number, reason: string) => { score += points; score_reasons.push({ points, reason }) }
  if (warnings.length) add(15, "warning evidence in the search radius")
  if (reports.length) add(30, "preliminary hail report in the search radius")
  if (reports.some((e: any) => Number(e.distance_miles) <= 3)) add(25, "hail report within 3 miles")
  if (reports.length >= 2) add(10, "multiple nearby hail reports")
  if (reports.some((e: any) => Number(e.magnitude) >= 1.5)) add(15, "reported hail at least 1.5 inches")
  score = Math.min(score, 100)
  return {
    trace_id, generated_at, data_health,
    location: { latitude: a.latitude, longitude: a.longitude, radius_miles: radius },
    status: "in_coverage", coverage, window, score,
    classification: score >= 60 ? "strong" : score >= 25 ? "moderate" : "limited",
    score_reasons, evidence: { warnings, hail_reports: reports, historical_hail_events: historical }, limitations: LIMITATIONS,
  }
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname
  if (req.method === "OPTIONS") return response(null, 204)
  if (req.method === "GET" && path.endsWith("/health")) return response({ status: "ok", server: SERVER_INFO })
  // Claude probes the MCP URL before initialize. A body on this 405 has caused
  // its connector registration to enter OAuth discovery for no-auth spikes.
  if (req.method === "GET") return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } })
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405)
  let message: any
  try { message = await req.json() } catch { return response(rpcError(null, -32700, "Parse error"), 400) }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return response(rpcError(message?.id, -32600, "Invalid Request"), 400)
  if (message.id === undefined || message.id === null) return response(null, 202)
  if (message.method === "initialize") return response({
    jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
      instructions: "Use persisted weather evidence conservatively. Commercial answers are limited to Texas, Florida, Louisiana, Georgia, and North Carolina over the latest 14 days. Unlocated questions default to those five states. Treat out_of_coverage as a coverage limitation, never as proof that no weather occurred. Never infer property impact or damage.",
    },
  }, 200, { "Mcp-Session-Id": crypto.randomUUID() })
  if (message.method === "ping") return response({ jsonrpc: "2.0", id: message.id, result: {} })
  if (message.method === "tools/list") return response({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } })
  if (message.method === "tools/call") {
    try {
      const output = await callTool(String(message.params?.name ?? ""), message.params?.arguments ?? {})
      return response({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          // Some MCP hosts currently ignore structuredContent unless a tool
          // also supplies a useful text fallback. Keep both representations.
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
          isError: false,
        },
      })
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown tool error"
      return response({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `Tool call failed: ${text}` }], structuredContent: { trace_id: crypto.randomUUID(), error: text }, isError: true } })
    }
  }
  return response(rpcError(message.id, -32601, "Method not found"))
})
