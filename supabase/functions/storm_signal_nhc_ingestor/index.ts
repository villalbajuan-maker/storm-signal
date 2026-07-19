import shp from "shpjs"

type Row = Record<string, any>
type Collection = { fileName?: string; features: Row[] }
const STATUS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
const RSS_URL = "https://www.nhc.noaa.gov/gis-at.xml"
const USER_AGENT = "storm-signal-nhc-ingestor/0.1 (contact: https://vectoros.co)"

function backend() {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("Supabase backend credentials unavailable")
  const headers: Row = { apikey: key, "Content-Type": "application/json", Accept: "application/json" }
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`
  return { base: `${url}/rest/v1`, headers }
}

async function rest(path: string, init: RequestInit = {}) {
  const { base, headers } = backend()
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

async function hashBytes(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function stableId(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).slice(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const h = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function officialFetch(url: string) {
  const response = await fetch(url, { headers: { Accept: "*/*", "User-Agent": USER_AGENT } })
  if (!response.ok) throw new Error(`NHC ${response.status} ${url}`)
  return response
}

function collections(value: any): Collection[] { return (Array.isArray(value) ? value : [value]) as Collection[] }
function layer(items: Collection[], suffix: string) { return items.find((item) => (item.fileName ?? "").toLowerCase().endsWith(suffix))?.features ?? [] }
function number(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed < 9999 ? parsed : null
}
function warningType(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") }
function iso(value: any) { return value ? new Date(value).toISOString() : null }

function forecastValid(value: string, issuedAt: string) {
  const match = value.match(/^(\d{2})\/(\d{2})(\d{2})$/)
  if (!match) throw new Error(`Invalid forecast valid time ${value}`)
  const issued = new Date(issuedAt), day = Number(match[1]), hour = Number(match[2]), minute = Number(match[3])
  const monthIndex = issued.getUTCFullYear() * 12 + issued.getUTCMonth()
  const candidates = [-1, 0, 1].map((offset) => {
    const index = monthIndex + offset
    return new Date(Date.UTC(Math.floor(index / 12), index % 12, day, hour, minute))
  })
  return candidates.sort((a, b) => Math.abs(a.getTime() - issued.getTime()) - Math.abs(b.getTime() - issued.getTime()))[0].toISOString()
}
function compactUtc(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/)
  if (!match) throw new Error(`Invalid compact valid time ${value}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]))).toISOString()
}

async function rawManifest(atcf: string, advisory: string, kind: string, url: string, bytes: ArrayBuffer, extra: Row = {}) {
  const payloadHash = await hashBytes(bytes)
  return {
    id: await stableId(`raw:nhc_gis:${atcf}:${advisory}:${kind}:${payloadHash}`), source: "nhc_gis",
    source_record_id: `${atcf}:${advisory}:${kind}`, retrieved_at: new Date().toISOString(),
    payload_json: { artifact_kind: kind, atcf_id: atcf, advisory_label: advisory, byte_length: bytes.byteLength, sha256: payloadHash, ...extra },
    payload_hash: payloadHash, source_url: url,
  }
}

async function normalizedFeature(advisoryId: string, rawId: string, productType: string, evidenceClass: string, sourceFeatureId: string, geometry: Row, attributes: Row, values: Row = {}) {
  const validAt = values.valid_at ?? null, threshold = values.threshold_kt ?? null
  const id = await stableId(`${advisoryId}:${productType}:${sourceFeatureId}:${validAt ?? ""}:${threshold ?? ""}:operational:1`)
  return {
    id, advisory_id: advisoryId, product_type: productType, evidence_class: evidenceClass,
    product_status: "operational", source_feature_id: sourceFeatureId, source_revision: 1,
    is_current: true, superseded_at: null, forecast_hour: null, valid_at: null,
    threshold_kt: null, probability_percent: null, watch_warning_type: null,
    geometry, source_record_id: rawId, attributes, ...values,
  }
}

async function ingestStorm(storm: Row, retrievedStatus: Row) {
  const atcf = String(storm.id).toUpperCase()
  const track = storm.forecastTrack, wind = storm.forecastWindRadiiGIS ?? storm.initialWindExtent
  if (!track?.zipFile || !wind?.zipFile) throw new Error(`${atcf} missing required forecast GIS assets`)
  const advisory = String(track.advNum).toUpperCase(), issuedAt = iso(track.issuance)
  if (!issuedAt) throw new Error(`${atcf} missing advisory issuance`)
  const [forecastResponse, windResponse] = await Promise.all([officialFetch(track.zipFile), officialFetch(wind.zipFile)])
  const [forecastBytes, windBytes] = await Promise.all([forecastResponse.arrayBuffer(), windResponse.arrayBuffer()])
  const [forecastLayers, windLayers] = await Promise.all([shp(forecastBytes), shp(windBytes)])
  const forecastCollections = collections(forecastLayers), windCollections = collections(windLayers)
  const statusBytes = new TextEncoder().encode(JSON.stringify(retrievedStatus)).buffer
  const raw = await Promise.all([
    rawManifest(atcf, advisory, "status", STATUS_URL, statusBytes, { rss_url: RSS_URL }),
    rawManifest(atcf, advisory, "forecast", track.zipFile, forecastBytes, { layers: forecastCollections.map((item) => ({ name: item.fileName, features: item.features.length })) }),
    rawManifest(atcf, advisory, "wind", wind.zipFile, windBytes, { layers: windCollections.map((item) => ({ name: item.fileName, features: item.features.length })) }),
  ])
  await rest("/source_records?on_conflict=source,source_record_id,payload_hash", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(raw) })
  const cycloneId = await stableId(`cyclone:${atcf}`)
  const seasonYear = Number(atcf.slice(4)), cycloneNumber = atcf.slice(2, 4), basin = atcf.slice(0, 2)
  await rest("/tropical_cyclones?on_conflict=atcf_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({
    id: cycloneId, atcf_id: atcf, basin, cyclone_number: cycloneNumber, season_year: seasonYear,
    current_name: storm.name ?? null, current_classification: storm.classification ?? null,
    first_advisory_at: issuedAt, last_advisory_at: issuedAt, active: true,
  }) })
  const kind = /[A-Z]$/i.test(advisory) ? "intermediate" : "full"
  const advisoryId = await stableId(`advisory:${atcf}:${advisory}:${kind}:${issuedAt}`)
  const center = iso(storm.lastUpdate) === issuedAt && number(storm.longitudeNumeric) !== null && number(storm.latitudeNumeric) !== null
    ? { type: "Point", coordinates: [number(storm.longitudeNumeric), number(storm.latitudeNumeric)] } : null
  await rest(`/cyclone_advisories?cyclone_id=eq.${cycloneId}&status=eq.issued`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "superseded" }) })
  await rest("/cyclone_advisories?on_conflict=cyclone_id,advisory_label,advisory_kind,issued_at", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({
    id: advisoryId, cyclone_id: cycloneId, advisory_label: advisory, advisory_number: number(advisory.replace(/[A-Z]/gi, "")), advisory_kind: kind,
    issued_at: issuedAt, status: "issued", classification: storm.classification ?? null, storm_name: storm.name ?? null, center,
    maximum_wind_kt: number(storm.intensity), minimum_pressure_mb: number(storm.pressure), movement_direction_degrees: number(storm.movementDir),
    movement_speed_kt: null, headline: null, source_record_id: raw[0].id,
  }) })

  const features: Row[] = []
  for (const [index, item] of layer(forecastCollections, "_5day_pts").entries()) {
    const p = item.properties ?? {}, tau = number(p.TAU) ?? 0, validAt = forecastValid(String(p.VALIDTIME), issuedAt)
    features.push(await normalizedFeature(advisoryId, raw[1].id, tau === 0 ? "analysis_center" : "forecast_track_point", tau === 0 ? "analysis" : "forecast", `track-point-f${String(tau).padStart(3, "0")}-${index}`, item.geometry, p, { forecast_hour: tau, valid_at: validAt }))
  }
  for (const [suffix, product, evidence] of [["_5day_lin", "forecast_track_line", "forecast"], ["_5day_pgn", "operational_cone", "uncertainty"]] as const) {
    for (const [index, item] of layer(forecastCollections, suffix).entries()) features.push(await normalizedFeature(advisoryId, raw[1].id, product, evidence, `${product}-${index}`, item.geometry, item.properties ?? {}))
  }
  const warningLayer = forecastCollections.find((item) => (item.fileName ?? "").toLowerCase().includes("_ww_wwlin"))?.features ?? []
  for (const [index, item] of warningLayer.entries()) {
    const p = item.properties ?? {}, warning = warningType(String(p.TCWW ?? p.WWTYPE ?? p.Name ?? "unknown"))
    features.push(await normalizedFeature(advisoryId, raw[1].id, "watch_warning", "watch_warning", `watch-warning-${warning}-${index}`, item.geometry, p, { valid_at: issuedAt, watch_warning_type: warning }))
  }
  for (const item of [...layer(windCollections, "_initialradii"), ...layer(windCollections, "_forecastradii")]) {
    const p = item.properties ?? {}, tau = number(p.TAU) ?? 0, threshold = number(p.RADII)
    if (![34, 50, 64].includes(threshold ?? -1)) continue
    const validAt = compactUtc(String(p.VALIDTIME)), sourceId = `wind-radius-${threshold}-f${String(tau).padStart(3, "0")}`
    features.push(await normalizedFeature(advisoryId, raw[2].id, "wind_radius", tau === 0 ? "analysis" : "forecast", sourceId, item.geometry, p, { forecast_hour: tau, valid_at: validAt, threshold_kt: threshold }))
  }
  const unique = [...new Map(features.map((item) => [item.id, item])).values()]
  if (unique.length) await rest("/cyclone_features?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(unique) })
  const geographyParts: Row[] = []
  for (let offset = 0; offset < unique.length; offset += 1) {
    const ids = unique.slice(offset, offset + 1).map((item) => item.id)
    try {
      geographyParts.push(await rest("/rpc/enrich_cyclone_features", { method: "POST", body: JSON.stringify({ p_feature_ids: ids }) }))
    } catch (error) {
      geographyParts.push({ status: "failed", selected_features: ids.length, associations: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const failedBatches = geographyParts.filter((part) => part.status === "failed").length
  const partialFeatures = geographyParts.reduce((sum, part) => sum + Number(part.partial ?? 0), 0)
  const geography = {
    status: failedBatches > 0 || partialFeatures > 0 ? "partial" : "complete",
    selected_features: geographyParts.reduce((sum, part) => sum + Number(part.selected_features ?? 0), 0),
    associations: geographyParts.reduce((sum, part) => sum + Number(part.associations ?? 0), 0),
    partial_features: partialFeatures,
    failed_batches: failedBatches,
  }
  return { atcf_id: atcf, advisory, features: unique.length, geography }
}

async function run() {
  const [statusResponse, rssResponse] = await Promise.all([officialFetch(STATUS_URL), officialFetch(RSS_URL)])
  const [status, rssText] = await Promise.all([statusResponse.json(), rssResponse.text()])
  const storms = (status.activeStorms ?? []).filter((storm: Row) => String(storm.id ?? "").toUpperCase().startsWith("AL"))
  const [ingestionRun] = await rest("/ingestion_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ source: "nhc_gis", status: "running" }) })
  try {
    const results = []
    for (const storm of storms) results.push(await ingestStorm(storm, { storm, rss_sha256: await hashBytes(rssText) }))
    const activeIds = storms.map((storm: Row) => String(storm.id).toUpperCase())
    const activeRows = await rest("/tropical_cyclones?basin=eq.AL&active=eq.true&select=id,atcf_id")
    for (const row of activeRows) if (!activeIds.includes(row.atcf_id)) await rest(`/tropical_cyclones?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) })
    const features = results.reduce((sum, item) => sum + item.features, 0), associations = results.reduce((sum, item) => sum + Number(item.geography?.associations ?? 0), 0)
    const geographicStatus = results.some((item) => item.geography.status === "partial") ? "partial" : "complete"
    const failedBatches = results.reduce((sum, item) => sum + Number(item.geography.failed_batches ?? 0), 0)
    await rest(`/ingestion_runs?id=eq.${ingestionRun.id}`, { method: "PATCH", body: JSON.stringify({ status: "complete", completed_at: new Date().toISOString(), records_received: features, records_created: 0, records_updated: features, geographic_status: geographicStatus, geographic_events_processed: features, geographic_associations: associations, geographic_error_message: failedBatches > 0 ? "One or more NHC geography batches require retry" : null }) })
    return { source: "nhc_gis", status: storms.length ? "active" : "seasonally_empty", active_cyclones: storms.length, results }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await rest(`/ingestion_runs?id=eq.${ingestionRun.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }) }).catch(() => null)
    throw error
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 })
  const expected = Deno.env.get("INGEST_CRON_SECRET")
  if (!expected || request.headers.get("x-storm-signal-cron") !== expected) return Response.json({ error: "unauthorized" }, { status: 401 })
  try { return Response.json(await run()) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) }
})
