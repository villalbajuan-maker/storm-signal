from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

NWS_ALERTS_URL = "https://api.weather.gov/alerts/active"
SPC_URL = "https://www.spc.noaa.gov/climo/reports/{day}_hail.csv"
SPC_PAGE_URL = "https://www.spc.noaa.gov/climo/reports/{day}.html"
NCEI_INDEX_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
USER_AGENT = "storm-signal-recon/0.1 (data-reconnaissance prototype)"


@dataclass(frozen=True)
class Snapshot:
    source: str
    source_url: str
    retrieved_at: str
    content_type: str
    body: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()


def fetch(url: str, accept: str = "*/*", timeout: int = 45) -> Snapshot:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        content_type = response.headers.get_content_type()
        final_url = response.geturl()
    return Snapshot("", final_url, datetime.now(timezone.utc).isoformat(), content_type, body)


def fetch_nws_alerts() -> Snapshot:
    snap = fetch(NWS_ALERTS_URL, "application/geo+json")
    return Snapshot("nws_alerts", snap.source_url, snap.retrieved_at, snap.content_type, snap.body)


def fetch_spc_hail(day: str) -> Snapshot:
    if day not in {"today", "yesterday"}:
        raise ValueError("SPC day must be 'today' or 'yesterday'")
    page = fetch(SPC_PAGE_URL.format(day=day), "text/html")
    cycle = discover_spc_cycle_date(page.body.decode("iso-8859-1", "replace"))
    snap = fetch(SPC_URL.format(day=day), "text/csv")
    return Snapshot(f"spc_hail_{cycle.isoformat()}", snap.source_url, snap.retrieved_at, snap.content_type, snap.body)


def discover_spc_cycle_date(page_html: str) -> date:
    match = re.search(r"Storm Reports \((\d{4})(\d{2})(\d{2})\s+1200 UTC", page_html, re.IGNORECASE)
    if not match:
        raise RuntimeError("SPC report page did not expose its convective cycle date")
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def discover_ncei_details_file(index_html: str, year: int) -> str:
    pattern = rf"StormEvents_details-ftp_v1\.0_d{year}_c\d+\.csv\.gz"
    matches = sorted(set(re.findall(pattern, index_html)))
    if not matches:
        raise RuntimeError(f"No NCEI details file found for {year}")
    return matches[-1]


def fetch_ncei_hail_sample(year: int, states: Iterable[str], limit: int) -> Snapshot:
    index = fetch(NCEI_INDEX_URL, "text/html")
    filename = discover_ncei_details_file(index.body.decode("utf-8", "replace"), year)
    source_url = NCEI_INDEX_URL + filename
    archive = fetch(source_url, "application/gzip")
    with gzip.GzipFile(fileobj=io.BytesIO(archive.body)) as zipped:
        reader = csv.DictReader(io.TextIOWrapper(zipped, encoding="utf-8-sig", newline=""))
        wanted = {state.strip().upper() for state in states}
        rows = [row for row in reader if row.get("EVENT_TYPE") == "Hail" and row.get("STATE") in wanted]
    rows = rows[:limit]
    if not rows:
        raise RuntimeError(f"No hail rows found for {year} and states {sorted(wanted)}")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return Snapshot(
        "noaa_storm_events_hail",
        source_url,
        archive.retrieved_at,
        "text/csv",
        output.getvalue().encode("utf-8"),
    )


def default_historical_year(today: date | None = None) -> int:
    # Storm Events publication lags; last calendar year is a stable reconnaissance sample.
    return (today or date.today()).year - 1


def parse_records(snapshot: Snapshot) -> list[dict[str, Any]]:
    if snapshot.source == "nws_alerts":
        payload = json.loads(snapshot.body)
        return payload.get("features", [])
    return list(csv.DictReader(io.StringIO(snapshot.body.decode("utf-8-sig"))))


def field_inventory(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}
    for record in records:
        flattened = _flatten_record(record) if "properties" in record else record
        for key, value in flattened.items():
            item = fields.setdefault(key, {"present": 0, "null": 0, "types": set(), "examples": []})
            item["present"] += 1
            if value is None or value == "":
                item["null"] += 1
            else:
                item["types"].add(type(value).__name__)
                rendered = value if isinstance(value, (str, int, float, bool)) else json.dumps(value)
                if rendered not in item["examples"] and len(item["examples"]) < 3:
                    item["examples"].append(rendered)
    total = len(records)
    return {
        key: {
            "present": value["present"],
            "missing": total - value["present"],
            "null": value["null"],
            "types": sorted(value["types"]),
            "examples": value["examples"],
        }
        for key, value in sorted(fields.items())
    }


def _flatten_record(record: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Expose nested object paths while keeping arrays/geometries inspectable as values."""
    flattened: dict[str, Any] = {}
    for key, value in record.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flattened.update(_flatten_record(value, path))
        else:
            flattened[path] = value
    return flattened


def write_snapshot(snapshot: Snapshot, run_dir: Path) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".json" if snapshot.source == "nws_alerts" else ".csv"
    raw_path = run_dir / f"{snapshot.source}{suffix}"
    raw_path.write_bytes(snapshot.body)
    records = parse_records(snapshot)
    inventory_path = run_dir / f"{snapshot.source}.fields.json"
    inventory_path.write_text(json.dumps(field_inventory(records), indent=2, ensure_ascii=False) + "\n")
    return {
        "source": snapshot.source,
        "source_url": snapshot.source_url,
        "retrieved_at": snapshot.retrieved_at,
        "content_type": snapshot.content_type,
        "sha256": snapshot.sha256,
        "records": len(records),
        "raw_file": raw_path.name,
        "field_inventory": inventory_path.name,
    }
