const NWS_URL = "https://api.weather.gov/alerts/active"
const SPC_URL = (day: string) => `https://www.spc.noaa.gov/climo/reports/${day}_hail.csv`
const SPC_PAGE_URL = (day: string) => `https://www.spc.noaa.gov/climo/reports/${day}.html`
const USER_AGENT = "storm-signal-ingestor/0.2 (contact: https://vectoros.co)"

type Row = Record<string, any>
type Pair = { raw: Row; event: Row }

function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

async function sha256Text(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256(value: any): Promise<string> {
  return sha256Text(stable(value))
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let row: string[] = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (!quoted && char === ",") { row.push(field); field = ""; continue }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++
      row.push(field); field = ""
      if (row.some((value) => value !== "")) rows.push(row)
      row = []
      continue
    }
    field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const headers = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "")) ?? []
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
}

function cycleDateFromPage(html: string): Date {
  const match = html.match(/Storm Reports \((\d{4})(\d{2})(\d{2})\s+1200 UTC/i)
  if (!match) throw new Error("SPC report page did not expose its convective cycle date")
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function reportTime(cycle: Date, hhmm: string): string {
  const value = hhmm.trim().padStart(4, "0")
  const hour = Number(value.slice(0, 2)), minute = Number(value.slice(2))
  const date = new Date(cycle)
  if (hour < 12) date.setUTCDate(date.getUTCDate() + 1)
  date.setUTCHours(hour, minute, 0, 0)
  return date.toISOString()
}

async function rawRecord(source: string, sourceId: string, payload: Row, retrievedAt: string, sourceUrl: string): Promise<Row> {
  return { source, source_record_id: sourceId, retrieved_at: retrievedAt, payload_json: payload, payload_hash: await sha256(payload), source_url: sourceUrl }
}

async function fetchNws(): Promise<Pair[]> {
  const response = await fetch(NWS_URL, { headers: { Accept: "application/geo+json", "User-Agent": USER_AGENT } })
  if (!response.ok) throw new Error(`NWS ${response.status}`)
  const retrievedAt = new Date().toISOString(), payload = await response.json()
  const pairs: Pair[] = []
  for (const feature of payload.features ?? []) {
    const props = feature.properties ?? {}
    const eventType = props.event === "Severe Thunderstorm Warning" ? "severe_thunderstorm_warning"
      : props.event === "Tornado Warning" ? "tornado_warning" : null
    if (!eventType) continue
    const sourceId = props.id ?? feature.id
    pairs.push({
      raw: await rawRecord("nws_alerts", sourceId, feature, retrievedAt, feature.id ?? NWS_URL),
      event: {
        event_type: eventType, status: props.status, started_at: props.onset ?? props.effective ?? props.sent,
        ended_at: props.ends ?? props.expires, magnitude: null, magnitude_unit: null,
        severity: props.severity, urgency: props.urgency, certainty: props.certainty,
        geometry: feature.geometry, state: props.geocode?.SAME?.[0]?.slice(0, 2) ?? null, county: null,
        source: "nws_alerts", source_record_id: sourceId, source_url: feature.id ?? NWS_URL,
      },
    })
  }
  return pairs
}

async function fetchSpcDay(day: string): Promise<Pair[]> {
  const pageResponse = await fetch(SPC_PAGE_URL(day), { headers: { Accept: "text/html", "User-Agent": USER_AGENT } })
  if (!pageResponse.ok) throw new Error(`SPC ${day} page ${pageResponse.status}`)
  const cycle = cycleDateFromPage(await pageResponse.text())
  const sourceUrl = SPC_URL(day)
  const response = await fetch(sourceUrl, { headers: { Accept: "text/csv", "User-Agent": USER_AGENT } })
  if (!response.ok) throw new Error(`SPC ${day} ${response.status}`)
  const retrievedAt = new Date().toISOString()
  const pairs: Pair[] = []
  for (const record of parseCsv(await response.text())) {
    if (!record.Time || !record.Lat || !record.Lon || !record.Size) continue
    const startedAt = reportTime(cycle, record.Time)
    const identity = `${cycle.toISOString().slice(0, 10)}|hail|${record.Time}|${record.Lat}|${record.Lon}|${record.Size}`
    const sourceId = await sha256Text(identity)
    pairs.push({
      raw: await rawRecord("spc_reports", sourceId, record, retrievedAt, sourceUrl),
      event: {
        event_type: "hail_report", status: "preliminary", started_at: startedAt, ended_at: startedAt,
        magnitude: Number(record.Size) / 100, magnitude_unit: "inch", severity: null, urgency: null,
        certainty: "Observed", geometry: { type: "Point", coordinates: [Number(record.Lon), Number(record.Lat)] },
        state: record.State || null, county: record.County || null,
        source: "spc_reports", source_record_id: sourceId, source_url: sourceUrl,
      },
    })
  }
  return pairs
}

function backend() {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("Supabase backend credentials unavailable")
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json", Accept: "application/json" }
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`
  return { base: `${url}/rest/v1`, headers }
}

async function rest(path: string, init: RequestInit = {}) {
  const { base, headers } = backend()
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function ingest(source: "nws_alerts" | "spc_reports", collect: () => Promise<Pair[]>) {
  const [run] = await rest("/ingestion_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ source, status: "running" }) })
  try {
    const pairs = await collect()
    const existingRows = await rest(`/storm_events?source=eq.${source}&select=source_record_id`)
    const existing = new Set(existingRows.map((row: Row) => row.source_record_id))
    let rawRows: Row[] = []
    if (pairs.length) rawRows = await rest("/source_records?on_conflict=source,source_record_id,payload_hash", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(pairs.map((pair) => pair.raw)),
    })
    const ids = new Map(rawRows.map((row) => [`${row.source}|${row.source_record_id}|${row.payload_hash}`, row.id]))
    const events: Row[] = pairs.map((pair) => ({ ...pair.event, raw_record_id: ids.get(`${pair.raw.source}|${pair.raw.source_record_id}|${pair.raw.payload_hash}`) }))
    if (events.length) await rest("/storm_events?on_conflict=source,source_record_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(events),
    })
    const created = events.filter((event) => !existing.has(event.source_record_id)).length
    await rest(`/ingestion_runs?id=eq.${run.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      status: "complete", completed_at: new Date().toISOString(), records_received: events.length,
      records_created: created, records_updated: events.length - created,
    }) })
    return { source, status: "complete", received: events.length, created, updated: events.length - created }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await rest(`/ingestion_runs?id=eq.${run.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      status: "failed", completed_at: new Date().toISOString(), error_message: message.slice(0, 1000),
    }) }).catch(() => null)
    throw error
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 })
  const expected = Deno.env.get("INGEST_CRON_SECRET")
  if (!expected || request.headers.get("x-storm-signal-cron") !== expected) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const source = body.source
  try {
    if (source === "nws") return Response.json(await ingest("nws_alerts", fetchNws))
    if (source === "spc") return Response.json(await ingest("spc_reports", async () => [...await fetchSpcDay("today"), ...await fetchSpcDay("yesterday")]))
    return Response.json({ error: "source_must_be_nws_or_spc" }, { status: 400 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
})
