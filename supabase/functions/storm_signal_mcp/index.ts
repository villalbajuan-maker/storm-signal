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
const NHC_PRODUCT_TYPES = ["analysis_center", "forecast_track_point", "forecast_track_line", "operational_cone", "experimental_cone", "watch_warning", "wind_radius", "wind_probability", "arrival_time", "storm_surge_watch_warning", "storm_surge_probability", "storm_surge_inundation"]
const NHC_EVIDENCE_CLASSES = ["analysis", "forecast", "uncertainty", "watch_warning", "probability", "preliminary_observation", "final_historical"]
const LIMITATIONS = [
  "Warnings describe forecast or warned areas; they do not prove hail at a property.",
  "SPC reports are preliminary observer points, not hail footprints, and may be corrected.",
  "SPC wind and tornado reports are preliminary observation points; unknown speed or scale is preserved rather than inferred.",
  "Historical coordinates can be approximate or absent.",
  "This evidence does not establish property damage, roof condition, or sales qualification.",
]
const NHC_LIMITATIONS = [
  "NHC forecasts describe future conditions and remain forecasts after their valid time; they are not observations.",
  "The cone describes probable center-track uncertainty, not storm size or an impact footprint.",
  "Wind-radius polygons are maximum extents by threshold and quadrant; wind is not uniform inside them.",
  "A Census intersection indicates geographic overlap only, not property impact, damage, a lead, or a claim.",
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
    description: "Produce a deterministic multihazard support score for hail, wind, tornado, and warning evidence near a covered location over the available 14-day window. NHC forecasts remain separate context and never prove impact or damage.",
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
  {
    name: "search_tropical_cyclones",
    description: "Search versioned NHC Atlantic cyclone advisories, tracks, operational cones, watches/warnings, and 34/50/64-kt wind fields that intersect TX, FL, LA, GA, or NC. Results preserve forecast and uncertainty semantics.",
    inputSchema: schema({
      active_only: { type: "boolean", default: true }, atcf_id: { type: "string", pattern: "^[A-Za-z]{2}[0-9]{6}$" },
      issued_after: { type: "string", format: "date-time" }, issued_before: { type: "string", format: "date-time" },
      product_types: { type: "array", items: { type: "string", enum: NHC_PRODUCT_TYPES } },
      evidence_classes: { type: "array", items: { type: "string", enum: NHC_EVIDENCE_CLASSES } },
      state: { type: "string" }, county: { type: "string" }, place: { type: "string" },
      zcta: { type: "string", pattern: "^[0-9]{5}$" }, valid_at: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "rank_markets",
    description: "Compare 2 to 5 explicitly located candidate markets using the versioned multihazard evidence score, operating-base proximity, geographic readiness, and missing-input penalties. Outputs are investigation priorities, never leads or confirmed opportunities.",
    inputSchema: schema({
      markets: {
        type: "array", minItems: 2, maxItems: 5,
        items: {
          type: "object", additionalProperties: false, required: ["name", "latitude", "longitude"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
          },
        },
      },
      start_at: { type: "string", format: "date-time" }, end_at: { type: "string", format: "date-time" },
      radius_miles: { type: "number", exclusiveMinimum: 0, maximum: 100, default: 10 },
      operating_base: {
        type: "object", additionalProperties: false, required: ["latitude", "longitude"],
        properties: {
          name: { type: "string", maxLength: 120 },
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 },
        },
      },
    }, ["markets", "start_at", "end_at"]),
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

function tropicalParams(a: Args) {
  return {
    p_active_only: a.active_only ?? true, p_atcf_id: a.atcf_id ?? null,
    p_issued_after: a.issued_after ?? null, p_issued_before: a.issued_before ?? null,
    p_product_types: a.product_types ?? null, p_evidence_classes: a.evidence_classes ?? null,
    p_state: a.state ?? null, p_county: a.county ?? null, p_place: a.place ?? null,
    p_zcta: a.zcta ?? null, p_valid_at: a.valid_at ?? null, p_limit: a.limit ?? 50,
  }
}

function validate(name: string, a: Args) {
  if (!TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`)
  if (name === "get_storm_event" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(a.event_id ?? ""))) throw new Error("event_id must be a UUID")
  if (["assess_location", "summarize_storm_activity", "rank_markets"].includes(name)) {
    if (!a.start_at || !a.end_at) throw new Error("start_at and end_at are required")
    if (Number.isNaN(Date.parse(String(a.start_at))) || Number.isNaN(Date.parse(String(a.end_at)))) throw new Error("Invalid date-time")
    if (Date.parse(String(a.start_at)) > Date.parse(String(a.end_at))) throw new Error("start_at must be before end_at")
  }
  if (name === "rank_markets") {
    if (!Array.isArray(a.markets) || a.markets.length < 2 || a.markets.length > 5) throw new Error("markets must contain between 2 and 5 candidates")
    for (const market of a.markets as any[]) {
      if (!market || typeof market.name !== "string" || !market.name.trim()) throw new Error("every market requires a name")
      if (!(Number(market.latitude) >= -90 && Number(market.latitude) <= 90) || !(Number(market.longitude) >= -180 && Number(market.longitude) <= 180)) throw new Error("every market requires valid latitude and longitude")
    }
    const base = a.operating_base as any
    if (base && (!(Number(base.latitude) >= -90 && Number(base.latitude) <= 90) || !(Number(base.longitude) >= -180 && Number(base.longitude) <= 180))) throw new Error("operating_base requires valid latitude and longitude")
  }
  if (name === "search_tropical_cyclones") {
    for (const key of ["issued_after", "issued_before", "valid_at"]) {
      if (a[key] !== undefined && Number.isNaN(Date.parse(String(a[key])))) throw new Error(`${key} must be a valid date-time`)
    }
    if (a.issued_after && a.issued_before && Date.parse(String(a.issued_after)) > Date.parse(String(a.issued_before))) throw new Error("issued_after must be before issued_before")
    if (a.atcf_id !== undefined && !/^[A-Za-z]{2}[0-9]{6}$/.test(String(a.atcf_id))) throw new Error("atcf_id must use the ATCF format, for example AL012026")
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

function tropicalUnavailable(trace_id: string, generated_at: string, data_health: any, coverage: any) {
  return {
    trace_id, generated_at, status: coverage?.status ?? "out_of_coverage",
    message: COVERAGE_MESSAGE, coverage, data_health, cyclones: [], count: 0,
    evidence_domain: "nhc_tropical_cyclone", limitations: NHC_LIMITATIONS,
  }
}

function presentCoverage(value: any) {
  return { ...value, message: value?.status === "in_coverage" ? IN_COVERAGE_MESSAGE : COVERAGE_MESSAGE }
}

function distanceMiles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radians = (value: number) => value * Math.PI / 180
  const dLat = radians(bLat - aLat), dLon = radians(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function operatingProximity(distance: number | null) {
  if (distance === null) return 0
  return distance <= 50 ? 20 : distance <= 100 ? 16 : distance <= 200 ? 12 : distance <= 300 ? 8 : distance <= 500 ? 4 : 0
}

async function callTool(name: string, a: Args): Promise<any> {
  validate(name, a)
  const trace_id = crypto.randomUUID(), generated_at = new Date().toISOString()
  const data_health = await rpc("mcp_data_health", {})
  const window = name === "search_tropical_cyclones" ? null : effectiveWindow(a)
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
  if (coverage?.status !== "in_coverage") return name === "search_tropical_cyclones"
    ? tropicalUnavailable(trace_id, generated_at, data_health, coverage)
    : unavailable(trace_id, generated_at, data_health, coverage, window)
  if (name === "search_storm_events") {
    const events = await rpc("mcp_search_storm_events", searchParams({ ...a, radius_miles: a.radius_miles ?? (a.latitude !== undefined ? 10 : null) })) ?? []
    return { trace_id, generated_at, status: "in_coverage", coverage, window, data_health, events, count: events.length, limitations: LIMITATIONS }
  }
  if (name === "summarize_storm_activity") {
    const groups = await rpc("mcp_summarize_storm_activity", { p_start_at: a.start_at, p_end_at: a.end_at, p_group_by: a.group_by ?? "event_type", p_state: a.state ?? null, p_event_types: a.event_types ?? null }) ?? []
    return { trace_id, generated_at, status: "in_coverage", coverage, window, data_health, groups, group_by: a.group_by ?? "event_type", limitations: LIMITATIONS }
  }
  if (name === "search_tropical_cyclones") {
    const cyclones = await rpc("mcp_search_tropical_cyclones_compact", tropicalParams(a)) ?? []
    return {
      trace_id, generated_at, status: "in_coverage", coverage, data_health,
      cyclones, count: cyclones.length, evidence_domain: "nhc_tropical_cyclone",
      limitations: NHC_LIMITATIONS,
    }
  }
  if (name === "rank_markets") {
    const markets = a.markets as any[], base = a.operating_base as any
    const evaluated = []
    for (const market of markets) {
      const assessment: any = await callTool("assess_location", {
        latitude: market.latitude, longitude: market.longitude,
        start_at: a.start_at, end_at: a.end_at, radius_miles: a.radius_miles ?? 10,
      })
      if (assessment.status !== "in_coverage") {
        evaluated.push({
          name: market.name, location: { latitude: market.latitude, longitude: market.longitude },
          eligible: false, decision: "insufficient_evidence", final_score: null, rank: null,
          coverage: assessment.coverage, message: COVERAGE_MESSAGE,
        })
        continue
      }
      const baseDistance = base ? distanceMiles(Number(base.latitude), Number(base.longitude), Number(market.latitude), Number(market.longitude)) : null
      const evidencePoints = Math.round(Number(assessment.score) * 0.7)
      const proximityPoints = operatingProximity(baseDistance)
      const readinessPoints = data_health?.geography?.queue_status === "healthy" ? 10 : 5
      const missingPenalty = base ? 0 : 5
      const finalScore = Math.max(0, Math.min(100, evidencePoints + proximityPoints + readinessPoints - missingPenalty))
      const decision = assessment.support_level === "insufficient" ? "insufficient_evidence" : finalScore >= 65 ? "prioritize" : finalScore >= 30 ? "monitor" : "insufficient_evidence"
      evaluated.push({
        name: market.name, location: { latitude: market.latitude, longitude: market.longitude, radius_miles: a.radius_miles ?? 10 },
        eligible: true, decision, final_score: finalScore, rank: null,
        support_level: assessment.support_level,
        components: {
          multihazard_evidence: { score: evidencePoints, max: 70, source_score: assessment.score },
          operating_proximity: { score: proximityPoints, max: 20, straight_line_miles: baseDistance === null ? null : Math.round(baseDistance * 10) / 10 },
          geographic_readiness: { score: readinessPoints, max: 10 },
          missing_input_penalty: { score: -missingPenalty, operating_base_missing: !base },
        },
        evidence_components: assessment.components, hazards: assessment.hazards,
        missing_data: [...(assessment.missing_data ?? []), ...(!base ? ["Operating base was not supplied; operational proximity could not be scored."] : [])],
        rationale: decision === "prioritize" ? "Strongest combined support for investigation under the supplied evidence and operating constraints."
          : decision === "monitor" ? "Some investigation support exists, but the evidence or operating fit is not strong enough to prioritize."
          : "Current persisted evidence is insufficient for market prioritization.",
      })
    }
    const ranked: any[] = evaluated.filter((item: any) => item.eligible).sort((left: any, right: any) => right.final_score - left.final_score || left.name.localeCompare(right.name))
    ranked.forEach((item: any, index: number) => { item.rank = index + 1 })
    const output = evaluated.sort((left: any, right: any) => (left.rank ?? 999) - (right.rank ?? 999) || left.name.localeCompare(right.name))
    return {
      trace_id, generated_at, status: ranked.length ? (ranked.length === markets.length ? "in_coverage" : "partial") : "insufficient_evidence",
      coverage, data_health, methodology: {
        id: "storm-signal-market-ranking-v1", version: 1,
        component_maxima: { multihazard_evidence: 70, operating_proximity: 20, geographic_readiness: 10 },
        decision_thresholds: { prioritize: 65, monitor: 30, insufficient_evidence: 0 },
        distance_interpretation: "Operating proximity uses straight-line distance, not road distance or travel time.",
      },
      operating_base: base ?? null, markets: output, count: output.length,
      limitations: [
        ...LIMITATIONS,
        "Rankings are relative investigation priorities, not leads, confirmed opportunities, route plans, or proof of damage.",
        "NHC forecast evidence is not included in market-ranking points.",
      ],
    }
  }
  const radius = Number(a.radius_miles ?? 10)
  const events = await rpc("mcp_search_storm_events", searchParams({ ...a, radius_miles: radius, limit: 200 })) ?? []
  const hail = events.filter((e: any) => e.event_type === "hail_report")
  const wind = events.filter((e: any) => e.event_type === "wind_report")
  const tornado = events.filter((e: any) => e.event_type === "tornado_report")
  const severeWarnings = events.filter((e: any) => e.event_type === "severe_thunderstorm_warning")
  const tornadoWarnings = events.filter((e: any) => e.event_type === "tornado_warning")
  const warnings = [...severeWarnings, ...tornadoWarnings]
  const historical = events.filter((e: any) => e.event_type === "historical_hail_event")
  const observed = [...hail, ...wind, ...tornado]
  const magnitudes = (items: any[]) => items.map((e: any) => e.magnitude).filter((value: any) => value !== null && value !== undefined).map(Number)
  const hailMagnitudes = magnitudes(hail), windMagnitudes = magnitudes(wind)
  const maxHail = hailMagnitudes.length ? Math.max(...hailMagnitudes) : null
  const maxWind = windMagnitudes.length ? Math.max(...windMagnitudes) : null
  const hailSeverity = !hail.length ? 0 : maxHail !== null && maxHail >= 2 ? 15 : maxHail !== null && maxHail >= 1.5 ? 12 : maxHail !== null && maxHail >= 1 ? 8 : 4
  const windSeverity = !wind.length ? 0 : maxWind !== null && maxWind >= 75 ? 14 : maxWind !== null && maxWind >= 58 ? 10 : maxWind !== null ? 5 : 4
  const severity = Math.min(35, hailSeverity + windSeverity + (tornado.length ? 18 : 0) + (tornadoWarnings.length ? 8 : 0) + (severeWarnings.length ? 4 : 0))
  const hazardCount = [hail, wind, tornado].filter((items) => items.length).length
  const baseConcentration = observed.length >= 4 ? 18 : observed.length === 3 ? 15 : observed.length === 2 ? 10 : observed.length === 1 ? 5 : 0
  const concentration = Math.min(20, baseConcentration + (hazardCount >= 2 ? 2 : 0))
  const distances = observed.map((e: any) => e.distance_miles).filter((value: any) => value !== null && value !== undefined).map(Number)
  const nearest = distances.length ? Math.min(...distances) : null
  const proximity = nearest !== null && nearest <= 3 ? 15 : nearest !== null && nearest <= 5 ? 12 : nearest !== null && nearest <= 10 ? 8 : nearest !== null && nearest <= radius ? 4 : 0
  const timestamps = events.map((e: any) => Date.parse(String(e.started_at ?? ""))).filter((value: number) => !Number.isNaN(value))
  const latestMs = timestamps.length ? Math.max(...timestamps) : null
  const ageHours = latestMs === null ? null : Math.max(0, (Date.now() - latestMs) / 3600000)
  const recency = ageHours !== null && ageHours <= 6 ? 15 : ageHours !== null && ageHours <= 24 ? 12 : ageHours !== null && ageHours <= 72 ? 8 : ageHours !== null && ageHours <= 168 ? 4 : ageHours !== null ? 2 : 0
  const quality = observed.length && warnings.length ? 15 : observed.length ? 10 : warnings.length ? 6 : historical.length ? 2 : 0
  const sourceHealth = new Map((data_health?.sources ?? []).map((item: any) => [item.source, item.freshness_status]))
  let penalties = 0
  const missing_data: string[] = []
  if (sourceHealth.has("spc_reports") && sourceHealth.get("spc_reports") !== "fresh") { penalties += 10; missing_data.push("SPC report ingestion is not fresh.") }
  if (sourceHealth.has("nws_alerts") && sourceHealth.get("nws_alerts") !== "fresh") { penalties += 5; missing_data.push("NWS alert ingestion is not fresh.") }
  if (Number(data_health?.geography?.event_processing?.pending ?? 0) > 0) { penalties += 5; missing_data.push("Some recent events still await geographic processing.") }
  const components = {
    severity: { score: severity, max: 35 },
    evidence_concentration: { score: concentration, max: 20 },
    proximity: { score: proximity, max: 15, nearest_observed_miles: nearest },
    recency: { score: recency, max: 15, latest_evidence_at: latestMs === null ? null : new Date(latestMs).toISOString() },
    evidence_quality: { score: quality, max: 15 },
  }
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum, item) => sum + item.score, 0) - penalties))
  const supportLevel = score >= 70 ? "strong" : score >= 40 ? "moderate" : score >= 15 ? "limited" : "insufficient"
  return {
    trace_id, generated_at, data_health,
    location: { latitude: a.latitude, longitude: a.longitude, radius_miles: radius },
    status: "in_coverage", coverage, window, score,
    classification: supportLevel, support_level: supportLevel,
    methodology: {
      id: "storm-signal-location-multihazard-v1", version: 1, score_range: [0, 100], penalty_points: penalties,
      nhc_scoring_policy: "NHC forecast evidence is excluded from this score and must be presented separately as forecast context.",
    },
    components, missing_data,
    hazards: {
      hail: { report_count: hail.length, max_inches: maxHail },
      wind: { report_count: wind.length, max_mph: maxWind },
      tornado: { report_count: tornado.length },
      warnings: { severe_thunderstorm_count: severeWarnings.length, tornado_count: tornadoWarnings.length },
    },
    evidence: { hail_reports: hail, wind_reports: wind, tornado_reports: tornado, warnings, historical_hail_events: historical },
    limitations: LIMITATIONS,
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
      instructions: "Use persisted weather evidence conservatively. Commercial answers are limited to Texas, Florida, Louisiana, Georgia, and North Carolina. Severe-event evidence is limited to the latest 14 days; NHC advisories remain an explicitly separate forecast domain. Unlocated questions default to those five states. Treat out_of_coverage as a coverage limitation, never as proof that no weather occurred. Never infer property impact or damage.",
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
