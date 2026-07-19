from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .sources import Snapshot, parse_records


def canonical_hash(record: dict[str, Any]) -> str:
    body = json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def spc_cycle_date(day: str, retrieved_at: str) -> date:
    """SPC daily reports cover the convective day beginning at 12:00 UTC."""
    retrieved = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    cycle = retrieved.date() if retrieved.hour >= 12 else retrieved.date() - timedelta(days=1)
    return cycle if day == "today" else cycle - timedelta(days=1)


def spc_report_time(cycle: date, hhmm: str) -> datetime:
    value = hhmm.strip().zfill(4)
    hour, minute = int(value[:2]), int(value[2:])
    report_date = cycle if hour >= 12 else cycle + timedelta(days=1)
    return datetime(report_date.year, report_date.month, report_date.day, hour, minute, tzinfo=timezone.utc)


def ncei_time(value: str, zone: str) -> datetime:
    local = datetime.strptime(value.strip(), "%d-%b-%y %H:%M:%S")
    match = re.search(r"([+-]\d{1,2})$", zone.strip())
    if not match:
        raise ValueError(f"Unsupported NCEI timezone: {zone!r}")
    return local.replace(tzinfo=timezone(timedelta(hours=int(match.group(1)))))


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def normalize_snapshot(snapshot: Snapshot) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    records = parse_records(snapshot)
    if snapshot.source == "nws_alerts":
        return [pair for record in records if (pair := normalize_nws(record, snapshot))]
    if match := re.fullmatch(r"spc_(hail|wind|torn)_(.+)", snapshot.source):
        kind, cycle_token = match.groups()
        cycle = date.fromisoformat(cycle_token) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cycle_token) else spc_cycle_date(cycle_token, snapshot.retrieved_at)
        return [normalize_spc(record, snapshot, cycle, kind) for record in records]
    if snapshot.source == "noaa_storm_events_hail":
        return [normalize_ncei(record, snapshot) for record in records]
    raise ValueError(f"Unsupported snapshot source: {snapshot.source}")


def normalize_nws(record: dict[str, Any], snapshot: Snapshot) -> tuple[dict[str, Any], dict[str, Any]] | None:
    props = record.get("properties", {})
    event_type = {
        "Severe Thunderstorm Warning": "severe_thunderstorm_warning",
        "Tornado Warning": "tornado_warning",
    }.get(props.get("event"))
    if event_type is None:
        return None
    source_id = props.get("id") or record["id"]
    started = props.get("onset") or props.get("effective") or props.get("sent")
    raw = _raw_record("nws_alerts", source_id, record, snapshot)
    normalized = {
        "event_type": event_type,
        "status": props.get("status"),
        "started_at": started,
        "ended_at": props.get("ends") or props.get("expires"),
        "magnitude": None,
        "magnitude_unit": None,
        "severity": props.get("severity"),
        "urgency": props.get("urgency"),
        "certainty": props.get("certainty"),
        "geometry": record.get("geometry"),
        "state": _nws_state(props),
        "county": None,
        "source": "nws_alerts",
        "source_record_id": source_id,
        "source_url": record.get("id") or snapshot.source_url,
    }
    return raw, normalized


def _nws_state(props: dict[str, Any]) -> str | None:
    same_codes = props.get("geocode", {}).get("SAME", [])
    return same_codes[0][:2] if same_codes else None


def normalize_spc(record: dict[str, Any], snapshot: Snapshot, cycle: date, kind: str = "hail") -> tuple[dict[str, Any], dict[str, Any]]:
    started = spc_report_time(cycle, record["Time"])
    metric_field = {"hail": "Size", "wind": "Speed", "torn": "F_Scale"}[kind]
    metric = record.get(metric_field)
    identity = "|".join([
        cycle.isoformat(), kind, record["Time"], record["Lat"], record["Lon"], metric or ""
    ])
    source_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    raw = _raw_record("spc_reports", source_id, record, snapshot)
    point = {"type": "Point", "coordinates": [float(record["Lon"]), float(record["Lat"])]}
    normalized = {
        "event_type": {"hail": "hail_report", "wind": "wind_report", "torn": "tornado_report"}[kind],
        "status": "preliminary",
        "started_at": started.isoformat(),
        "ended_at": started.isoformat(),
        "magnitude": float(metric) / 100 if kind == "hail" and metric not in (None, "", "UNK") else float(metric) if kind == "wind" and metric not in (None, "", "UNK") else None,
        "magnitude_unit": "inch" if kind == "hail" else "mph" if kind == "wind" and metric not in (None, "", "UNK") else None,
        "severity": metric if kind == "torn" and metric not in (None, "", "UNK") else None,
        "urgency": None,
        "certainty": "Observed",
        "geometry": point,
        "state": record.get("State"),
        "county": record.get("County"),
        "source": "spc_reports",
        "source_record_id": source_id,
        "source_url": snapshot.source_url,
    }
    return raw, normalized


def normalize_ncei(record: dict[str, Any], snapshot: Snapshot) -> tuple[dict[str, Any], dict[str, Any]]:
    source_id = record["EVENT_ID"]
    started = ncei_time(record["BEGIN_DATE_TIME"], record["CZ_TIMEZONE"])
    ended = ncei_time(record["END_DATE_TIME"], record["CZ_TIMEZONE"])
    lon, lat = _number(record.get("BEGIN_LON")), _number(record.get("BEGIN_LAT"))
    point = {"type": "Point", "coordinates": [lon, lat]} if lon is not None and lat is not None else None
    raw = _raw_record("noaa_storm_events", source_id, record, snapshot)
    normalized = {
        "event_type": "historical_hail_event",
        "status": "historical",
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "magnitude": _number(record.get("MAGNITUDE")),
        "magnitude_unit": "inch",
        "severity": None,
        "urgency": None,
        "certainty": "Observed",
        "geometry": point,
        "state": record.get("STATE"),
        "county": record.get("CZ_NAME"),
        "source": "noaa_storm_events",
        "source_record_id": source_id,
        "source_url": snapshot.source_url,
    }
    return raw, normalized


def _raw_record(source: str, source_id: str, record: dict[str, Any], snapshot: Snapshot) -> dict[str, Any]:
    return {
        "source": source,
        "source_record_id": source_id,
        "retrieved_at": snapshot.retrieved_at,
        "payload_json": record,
        "payload_hash": canonical_hash(record),
        "source_url": snapshot.source_url,
    }
