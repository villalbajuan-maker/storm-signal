from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


USER_AGENT = "storm-signal-nhc-archive-importer/0.1 (https://vectoros.co)"
NAMESPACE = uuid.UUID("92a15aed-1375-4c5f-bdb0-8b0189205fa9")
DEFAULT_ATCF_ID = "AL112017"
DEFAULT_ADVISORY = "20"
DEFAULT_URLS = {
    "forecast": "https://www.nhc.noaa.gov/gis/examples/al112017_5day_020.zip",
    "wind": "https://www.nhc.noaa.gov/gis/examples/al112017_fcst_020.zip",
    "warnings": "https://www.nhc.noaa.gov/gis/examples/AL112017_020adv_WW.kmz",
}
ZONE_OFFSETS = {
    "UTC": 0,
    "GMT": 0,
    "AST": -4,
    "EDT": -4,
    "EST": -5,
    "CDT": -5,
    "CST": -6,
    "MDT": -6,
    "MST": -7,
    "PDT": -7,
    "PST": -8,
    "HST": -10,
}


@dataclass(frozen=True)
class Artifact:
    kind: str
    url: str
    body: bytes
    sha256: str
    collections: dict[str, dict[str, Any]]


def download(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(request, timeout=180) as response:
                body = response.read()
            if not body:
                raise RuntimeError("empty response")
            return body
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"Download failed after 3 attempts: {url}: {last_error}")


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def deterministic_uuid(value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, value))


def sql_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def json_literal(value: Any) -> str:
    compact = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return "$json$" + compact.replace("$json$", "") + "$json$::jsonb"


def clean_number(value: Any, *, integer: bool = False) -> int | float | None:
    if value in (None, ""):
        return None
    number = float(value)
    if number >= 9999:
        return None
    return int(number) if integer else number


def parse_advisory_time(label: str) -> datetime:
    match = re.fullmatch(r"\s*(\d{3,4})\s+(AM|PM)\s+([A-Z]+)\s+[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s*", label)
    if not match:
        raise ValueError(f"Unsupported NHC advisory date: {label!r}")
    clock, meridiem, zone, month, day, year = match.groups()
    minute = int(clock[-2:])
    hour = int(clock[:-2])
    if meridiem == "AM" and hour == 12:
        hour = 0
    elif meridiem == "PM" and hour != 12:
        hour += 12
    if zone not in ZONE_OFFSETS:
        raise ValueError(f"Unsupported NHC timezone: {zone}")
    month_number = datetime.strptime(month, "%b").month
    local = datetime(int(year), month_number, int(day), hour, minute, tzinfo=timezone(timedelta(hours=ZONE_OFFSETS[zone])))
    return local.astimezone(timezone.utc)


def parse_forecast_valid_time(value: str, issued_at: datetime) -> datetime:
    match = re.fullmatch(r"(\d{2})/(\d{2})(\d{2})", value.strip())
    if not match:
        raise ValueError(f"Unsupported NHC forecast valid time: {value!r}")
    day, hour, minute = (int(part) for part in match.groups())
    month_index = issued_at.year * 12 + issued_at.month - 1
    nearby = []
    for offset in (-1, 0, 1):
        candidate_index = month_index + offset
        nearby.append((candidate_index // 12, candidate_index % 12 + 1))
    candidates = [
        datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        for year, month in nearby
    ]
    return min(candidates, key=lambda candidate: abs((candidate - issued_at).total_seconds()))


def parse_compact_utc(value: str) -> datetime:
    return datetime.strptime(value.strip(), "%Y%m%d%H").replace(tzinfo=timezone.utc)


def normalize_warning_type(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def ogr_collection(source: Path, output: Path) -> dict[str, Any]:
    subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", str(output), str(source), "-t_srs", "EPSG:4326"],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return json.loads(output.read_text())


def collect_artifact(kind: str, url: str, body: bytes, work: Path) -> Artifact:
    source = work / (f"{kind}.kmz" if kind == "warnings" else f"{kind}.zip")
    source.write_bytes(body)
    collections: dict[str, dict[str, Any]] = {}
    if kind == "warnings":
        collections["warnings"] = ogr_collection(source, work / "warnings.geojson")
    else:
        extract = work / kind
        extract.mkdir()
        with zipfile.ZipFile(source) as zipped:
            zipped.extractall(extract)
        for shapefile in sorted(extract.glob("*.shp")):
            name = shapefile.stem
            if kind == "forecast":
                layer = "track_points" if name.endswith("_pts") else "track_line" if name.endswith("_lin") else "cone" if name.endswith("_pgn") else None
            else:
                layer = "initial_radii" if name.endswith("_initialradii") else "forecast_radii" if name.endswith("_forecastradii") else None
            if layer:
                collections[layer] = ogr_collection(shapefile, work / f"{layer}.geojson")
    return Artifact(kind, url, body, digest(body), collections)


def feature(
    advisory_id: str,
    raw_id: str,
    product_type: str,
    evidence_class: str,
    source_feature_id: str,
    geometry: dict[str, Any],
    attributes: dict[str, Any],
    *,
    forecast_hour: int | None = None,
    valid_at: datetime | None = None,
    threshold_kt: int | None = None,
    watch_warning_type: str | None = None,
) -> dict[str, Any]:
    identity = f"{advisory_id}:{product_type}:{source_feature_id}:{valid_at.isoformat() if valid_at else ''}:{threshold_kt or ''}:operational:1"
    return {
        "id": deterministic_uuid(identity),
        "advisory_id": advisory_id,
        "product_type": product_type,
        "evidence_class": evidence_class,
        "product_status": "operational",
        "source_feature_id": source_feature_id,
        "source_revision": 1,
        "forecast_hour": forecast_hour,
        "valid_at": valid_at.isoformat() if valid_at else None,
        "threshold_kt": threshold_kt,
        "probability_percent": None,
        "watch_warning_type": watch_warning_type,
        "geometry": geometry,
        "source_record_id": raw_id,
        "attributes": attributes,
    }


def deduplicate_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for item in features:
        unique.setdefault(item["id"], item)
    return list(unique.values())


def normalize(artifacts: dict[str, Artifact], atcf_id: str = DEFAULT_ATCF_ID, advisory_label: str = DEFAULT_ADVISORY) -> dict[str, Any]:
    points = artifacts["forecast"].collections["track_points"]["features"]
    if not points:
        raise ValueError("forecast archive contains no track points")
    base = points[0]["properties"]
    issued_at = parse_advisory_time(str(base["ADVDATE"]))
    discovered_atcf_id = f"{str(base['BASIN']).upper()}{int(float(base['STORMNUM'])):02d}{issued_at.year}"
    if discovered_atcf_id != atcf_id.upper():
        raise ValueError(f"Archive identity {discovered_atcf_id} does not match requested {atcf_id.upper()}")
    if str(base["ADVISNUM"]).strip() != advisory_label:
        raise ValueError(f"Archive advisory {base['ADVISNUM']} does not match requested {advisory_label}")
    basin = atcf_id[:2].upper()
    cyclone_number = atcf_id[2:4]
    season_year = int(atcf_id[4:])
    cyclone_id = deterministic_uuid(f"cyclone:{atcf_id.upper()}")
    advisory_id = deterministic_uuid(f"advisory:{atcf_id.upper()}:{advisory_label}:full:{issued_at.isoformat()}")
    raw_ids = {
        kind: deterministic_uuid(f"raw:nhc_gis:{atcf_id.upper()}:{advisory_label}:{kind}:{artifact.sha256}")
        for kind, artifact in artifacts.items()
    }
    normalized_features: list[dict[str, Any]] = []

    for index, item in enumerate(points):
        props = item["properties"]
        tau = int(float(props["TAU"]))
        valid_at = parse_forecast_valid_time(str(props["VALIDTIME"]), issued_at)
        normalized_features.append(feature(
            advisory_id,
            raw_ids["forecast"],
            "analysis_center" if tau == 0 else "forecast_track_point",
            "analysis" if tau == 0 else "forecast",
            f"track-point-f{tau:03d}-{index}",
            item["geometry"],
            props,
            forecast_hour=tau,
            valid_at=valid_at,
        ))

    for index, item in enumerate(artifacts["forecast"].collections["track_line"]["features"]):
        normalized_features.append(feature(advisory_id, raw_ids["forecast"], "forecast_track_line", "forecast", f"track-line-{index}", item["geometry"], item["properties"]))
    for index, item in enumerate(artifacts["forecast"].collections["cone"]["features"]):
        normalized_features.append(feature(advisory_id, raw_ids["forecast"], "operational_cone", "uncertainty", f"operational-cone-{index}", item["geometry"], item["properties"]))
    for index, item in enumerate(artifacts["warnings"].collections["warnings"]["features"]):
        props = item["properties"]
        warning = normalize_warning_type(str(props.get("Name") or "unknown"))
        normalized_features.append(feature(advisory_id, raw_ids["warnings"], "watch_warning", "watch_warning", f"watch-warning-{warning}-{index}", item["geometry"], props, valid_at=issued_at, watch_warning_type=warning))
    for layer in ("initial_radii", "forecast_radii"):
        for index, item in enumerate(artifacts["wind"].collections[layer]["features"]):
            props = item["properties"]
            tau = int(float(props["TAU"]))
            threshold = int(float(props["RADII"]))
            valid_at = parse_compact_utc(str(props["VALIDTIME"]))
            normalized_features.append(feature(
                advisory_id,
                raw_ids["wind"],
                "wind_radius",
                "analysis" if tau == 0 else "forecast",
                f"wind-radius-{threshold}-f{tau:03d}-{index}",
                item["geometry"],
                props,
                forecast_hour=tau,
                valid_at=valid_at,
                threshold_kt=threshold,
            ))

    storm_name = str(base.get("STORMNAME") or "").removeprefix("Hurricane ").removeprefix("Tropical Storm ") or None
    return {
        "raw_ids": raw_ids,
        "cyclone": {
            "id": cyclone_id,
            "atcf_id": atcf_id.upper(),
            "basin": basin,
            "cyclone_number": cyclone_number,
            "season_year": season_year,
            "current_name": storm_name,
            "current_classification": base.get("TCDVLP"),
            "first_advisory_at": issued_at.isoformat(),
            "last_advisory_at": issued_at.isoformat(),
            "active": False,
        },
        "advisory": {
            "id": advisory_id,
            "cyclone_id": cyclone_id,
            "advisory_label": advisory_label,
            "advisory_number": float(advisory_label) if advisory_label.isdigit() else None,
            "advisory_kind": "full",
            "issued_at": issued_at.isoformat(),
            "status": "issued",
            "classification": base.get("TCDVLP"),
            "storm_name": storm_name,
            # The sample track starts at a 0600 UTC synoptic point while the advisory was
            # issued at 0900 UTC, so no advisory-center geometry is invented here.
            "center": None,
            "maximum_wind_kt": clean_number(base.get("MAXWIND"), integer=True),
            "minimum_pressure_mb": clean_number(base.get("MSLP"), integer=True),
            "movement_direction_degrees": clean_number(base.get("TCDIR"), integer=True),
            "movement_speed_kt": clean_number(base.get("TCSPD")),
            "headline": None,
            "source_record_id": raw_ids["forecast"],
        },
        "features": deduplicate_features(normalized_features),
        "issued_at": issued_at,
    }


def build_sql(artifacts: dict[str, Artifact], normalized: dict[str, Any], atcf_id: str, advisory_label: str) -> str:
    statements = ["begin;"]
    for kind, artifact in artifacts.items():
        manifest = {
            "artifact_kind": kind,
            "atcf_id": atcf_id.upper(),
            "advisory_label": advisory_label,
            "byte_length": len(artifact.body),
            "sha256": artifact.sha256,
            "layers": {name: len(collection.get("features", [])) for name, collection in artifact.collections.items()},
        }
        statements.append(
            "insert into public.source_records (id,source,source_record_id,retrieved_at,payload_json,payload_hash,source_url) values ("
            f"{sql_literal(normalized['raw_ids'][kind])},'nhc_gis',{sql_literal(f'{atcf_id.upper()}:{advisory_label}:{kind}')},now(),"
            f"{json_literal(manifest)},{sql_literal(artifact.sha256)},{sql_literal(artifact.url)}) on conflict (source,source_record_id,payload_hash) do nothing;"
        )
    cyclone = normalized["cyclone"]
    statements.append(
        "insert into public.tropical_cyclones (id,atcf_id,basin,cyclone_number,season_year,current_name,current_classification,first_advisory_at,last_advisory_at,active) values ("
        + ",".join(sql_literal(cyclone[key]) for key in ("id", "atcf_id", "basin", "cyclone_number", "season_year", "current_name", "current_classification", "first_advisory_at", "last_advisory_at", "active"))
        + ") on conflict (atcf_id) do update set current_name=excluded.current_name,current_classification=excluded.current_classification,"
        "first_advisory_at=least(public.tropical_cyclones.first_advisory_at,excluded.first_advisory_at),"
        "last_advisory_at=greatest(public.tropical_cyclones.last_advisory_at,excluded.last_advisory_at);"
    )
    advisory = normalized["advisory"]
    advisory_columns = ("id", "cyclone_id", "advisory_label", "advisory_number", "advisory_kind", "issued_at", "status", "classification", "storm_name", "center", "maximum_wind_kt", "minimum_pressure_mb", "movement_direction_degrees", "movement_speed_kt", "headline", "source_record_id")
    advisory_values = []
    for key in advisory_columns:
        advisory_values.append("null" if key == "center" else sql_literal(advisory[key]))
    statements.append(
        "insert into public.cyclone_advisories (" + ",".join(advisory_columns) + ") values (" + ",".join(advisory_values) + ") "
        "on conflict (cyclone_id,advisory_label,advisory_kind,issued_at) do update set "
        "classification=excluded.classification,storm_name=excluded.storm_name,maximum_wind_kt=excluded.maximum_wind_kt,"
        "minimum_pressure_mb=excluded.minimum_pressure_mb,movement_direction_degrees=excluded.movement_direction_degrees,"
        "movement_speed_kt=excluded.movement_speed_kt,source_record_id=excluded.source_record_id;"
    )
    for item in normalized["features"]:
        geometry = json.dumps(item["geometry"], separators=(",", ":"))
        columns = ("id", "advisory_id", "product_type", "evidence_class", "product_status", "source_feature_id", "source_revision", "forecast_hour", "valid_at", "threshold_kt", "probability_percent", "watch_warning_type", "geometry", "source_record_id", "attributes")
        values = []
        for key in columns:
            if key == "geometry":
                values.append(f"extensions.st_force2d(extensions.st_setsrid(extensions.st_geomfromgeojson($geo${geometry}$geo$),4326))")
            elif key == "attributes":
                values.append(json_literal(item[key]))
            else:
                values.append(sql_literal(item[key]))
        statements.append(
            "insert into public.cyclone_features (" + ",".join(columns) + ") values (" + ",".join(values) + ") "
            "on conflict (id) do update set geometry=excluded.geometry,attributes=excluded.attributes,source_record_id=excluded.source_record_id,updated_at=now();"
        )
    statements.append("commit;")
    return "\n".join(statements) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay an official archived NHC advisory into the linked Storm Signal database")
    parser.add_argument("--apply", action="store_true", help="apply generated SQL to the linked Supabase project")
    parser.add_argument("--output", type=Path, help="retain generated SQL at this path")
    parser.add_argument("--atcf-id", default=DEFAULT_ATCF_ID)
    parser.add_argument("--advisory", default=DEFAULT_ADVISORY)
    args = parser.parse_args()
    if shutil.which("ogr2ogr") is None:
        raise RuntimeError("ogr2ogr is required to convert official NHC GIS assets")
    if not re.fullmatch(r"[A-Za-z]{2}[0-9]{6}", args.atcf_id):
        parser.error("--atcf-id must look like AL112017")
    with tempfile.TemporaryDirectory(prefix="storm-signal-nhc-") as temporary:
        work = Path(temporary)
        artifacts = {
            kind: collect_artifact(kind, url, download(url), work)
            for kind, url in DEFAULT_URLS.items()
        }
        normalized = normalize(artifacts, args.atcf_id, args.advisory)
        sql = build_sql(artifacts, normalized, args.atcf_id, args.advisory)
        output = args.output or work / f"{args.atcf_id.lower()}-{args.advisory}.sql"
        output.write_text(sql)
        if args.apply:
            subprocess.run(["supabase", "db", "query", "--linked", "-f", str(output)], check=True)
        counts: dict[str, int] = {}
        for item in normalized["features"]:
            counts[item["product_type"]] = counts.get(item["product_type"], 0) + 1
        print(json.dumps({
            "applied": args.apply,
            "atcf_id": args.atcf_id.upper(),
            "advisory": args.advisory,
            "issued_at": normalized["issued_at"].isoformat(),
            "features": counts,
            "artifacts": {kind: {"sha256": artifact.sha256, "bytes": len(artifact.body)} for kind, artifact in artifacts.items()},
        }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
