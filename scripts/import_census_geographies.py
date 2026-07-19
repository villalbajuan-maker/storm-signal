from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

USER_AGENT = "storm-signal-census-importer/0.1 (https://vectoros.co)"
VINTAGE = 2025
TIGER_ROOT = "https://www2.census.gov/geo/tiger/TIGER2025"
ZCTA_ENDPOINT = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/4/query"
STATE_ABBREVIATIONS = {"08": "CO", "12": "FL", "13": "GA", "22": "LA", "30": "MT", "37": "NC", "40": "OK", "48": "TX"}


@dataclass(frozen=True)
class Artifact:
    area_type: str
    source_url: str
    source_sha256: str
    feature_collection: dict[str, Any]


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
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Download failed after 3 attempts: {url}: {last_error}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def archive_artifact(area_type: str, url: str, where: str | None, work: Path) -> Artifact:
    body = download(url)
    archive = work / f"{area_type}.zip"
    archive.write_bytes(body)
    extract_dir = work / area_type
    extract_dir.mkdir()
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(extract_dir)
    shapefiles = list(extract_dir.glob("*.shp"))
    if len(shapefiles) != 1:
        raise RuntimeError(f"Expected one shapefile for {area_type}, found {len(shapefiles)}")
    output = work / f"{area_type}.geojson"
    command = ["ogr2ogr", "-f", "GeoJSON", str(output), str(shapefiles[0]), "-t_srs", "EPSG:4326"]
    if where:
        command.extend(["-where", where])
    subprocess.run(command, check=True)
    return Artifact(area_type, url, sha256(body), json.loads(output.read_text()))


def geometry_bbox(collection: dict[str, Any], padding: float = 0.1) -> tuple[float, float, float, float]:
    positions: list[tuple[float, float]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            positions.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            for item in value:
                visit(item)

    for feature in collection.get("features", []):
        visit((feature.get("geometry") or {}).get("coordinates"))
    if not positions:
        raise ValueError("cannot derive a bounding box from an empty state geometry")
    xs, ys = zip(*positions)
    return min(xs) - padding, min(ys) - padding, max(xs) + padding, max(ys) + padding


def zcta_artifact(bbox: tuple[float, float, float, float]) -> Artifact:
    xmin, ymin, xmax, ymax = bbox
    envelope = json.dumps({
        "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
        "spatialReference": {"wkid": 4326},
    }, separators=(",", ":"))
    id_parameters = {
        "where": "OBJECTID IS NOT NULL",
        "geometry": envelope,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnIdsOnly": "true",
        "f": "json",
    }
    source_url = ZCTA_ENDPOINT + "?" + urllib.parse.urlencode(id_parameters)
    id_payload = json.loads(download(source_url))
    object_ids = id_payload.get("objectIds")
    if not isinstance(object_ids, list):
        raise RuntimeError(f"TIGERweb ZCTA ID response was invalid: {id_payload}")
    features: list[dict[str, Any]] = []
    for offset in range(0, len(object_ids), 50):
        query = {
            "objectIds": ",".join(str(value) for value in object_ids[offset:offset + 50]),
            "outFields": "GEOID,NAME,ZCTA5",
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "6",
            "f": "geojson",
        }
        payload = json.loads(download(ZCTA_ENDPOINT + "?" + urllib.parse.urlencode(query)))
        if "features" not in payload:
            raise RuntimeError(f"TIGERweb ZCTA feature response was invalid: {payload}")
        features.extend(payload["features"])
    collection = {"type": "FeatureCollection", "features": features}
    artifact_body = json.dumps(collection, sort_keys=True, separators=(",", ":")).encode()
    return Artifact("zcta", source_url, sha256(artifact_body), collection)


def sql_literal(value: Any) -> str:
    if value is None or value == "":
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def normalized_properties(area_type: str, properties: dict[str, Any]) -> dict[str, str | None]:
    geoid = str(properties.get("GEOID") or properties.get("GEOID20") or "")
    if not geoid:
        raise ValueError("feature has no GEOID")
    state_fips = str(properties.get("STATEFP") or "") or None
    county_fips = str(properties.get("COUNTYFP") or "") or None
    zcta5 = str(properties.get("ZCTA5") or properties.get("ZCTA5CE20") or "") or None
    return {
        "geoid": geoid,
        "name": properties.get("NAMELSAD") or properties.get("NAME") or properties.get("NAME20"),
        "state_fips": state_fips,
        "county_fips": county_fips,
        "zcta5": zcta5 if area_type == "zcta" else None,
    }


def artifact_sql(artifact: Artifact, scope: str = "MT") -> tuple[str, int, int]:
    run_id = str(uuid.uuid4())
    statements = [
        "begin;",
        "update public.geographic_import_runs set status='failed',completed_at=now(),"
        "error_message='superseded by idempotent retry' "
        f"where status='running' and vintage={VINTAGE} and area_type={sql_literal(artifact.area_type)} and scope={sql_literal(scope)};",
        "insert into public.geographic_import_runs "
        "(id,vintage,area_type,scope,source_url,source_sha256,status) values "
        f"('{run_id}',{VINTAGE},{sql_literal(artifact.area_type)},{sql_literal(scope)},"
        f"{sql_literal(artifact.source_url)},{sql_literal(artifact.source_sha256)},'running');",
    ]
    loaded = rejected = 0
    for feature in artifact.feature_collection.get("features", []):
        try:
            fields = normalized_properties(artifact.area_type, feature.get("properties") or {})
            geometry = feature.get("geometry")
            if not geometry:
                raise ValueError("feature has no geometry")
            geometry_json = json.dumps(geometry, separators=(",", ":"))
            statements.append(
                "insert into public.geographic_areas "
                "(vintage,area_type,geoid,name,state_fips,county_fips,zcta5,geometry,source_url,source_sha256) values ("
                f"{VINTAGE},{sql_literal(artifact.area_type)},{sql_literal(fields['geoid'])},{sql_literal(fields['name'])},"
                f"{sql_literal(fields['state_fips'])},{sql_literal(fields['county_fips'])},{sql_literal(fields['zcta5'])},"
                "extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid("
                f"extensions.st_setsrid(extensions.st_geomfromgeojson($geo${geometry_json}$geo$),4326)),3)),"
                f"{sql_literal(artifact.source_url)},{sql_literal(artifact.source_sha256)}) "
                "on conflict (vintage,area_type,geoid) do update set "
                "name=excluded.name,state_fips=excluded.state_fips,county_fips=excluded.county_fips,"
                "zcta5=excluded.zcta5,geometry=excluded.geometry,source_url=excluded.source_url,source_sha256=excluded.source_sha256;"
            )
            loaded += 1
        except (TypeError, ValueError):
            rejected += 1
    received = loaded + rejected
    statements.extend([
        "update public.geographic_import_runs set "
        f"status='complete',completed_at=now(),records_received={received},records_loaded={loaded},records_rejected={rejected} "
        f"where id='{run_id}';",
        "commit;",
    ])
    return "\n".join(statements) + "\n", loaded, rejected


def apply_sql_batched(sql: str, work: Path, prefix: str, max_chars: int = 800_000) -> None:
    statements = [line for line in sql.splitlines() if line not in {"begin;", "commit;"}]
    batches: list[list[str]] = []
    current: list[str] = []
    current_size = 0
    for statement in statements:
        if current and current_size + len(statement) > max_chars:
            batches.append(current)
            current, current_size = [], 0
        current.append(statement)
        current_size += len(statement) + 1
    if current:
        batches.append(current)
    for index, batch in enumerate(batches, start=1):
        path = work / f"{prefix}-{index:04d}.sql"
        path.write_text("begin;\n" + "\n".join(batch) + "\ncommit;\n")
        subprocess.run(["supabase", "db", "query", "--linked", "-f", str(path)], check=True)


def collect(work: Path, layers: set[str], state_fips: str) -> list[Artifact]:
    state = archive_artifact(
        "state", f"{TIGER_ROOT}/STATE/tl_2025_us_state.zip", f"STATEFP = '{state_fips}'", work
    )
    if not state.feature_collection.get("features"):
        raise ValueError(f"no Census state found for FIPS {state_fips}")
    collectors = {
        "state": lambda: state,
        "county": lambda: archive_artifact("county", f"{TIGER_ROOT}/COUNTY/tl_2025_us_county.zip", f"STATEFP = '{state_fips}'", work),
        "place": lambda: archive_artifact("place", f"{TIGER_ROOT}/PLACE/tl_2025_{state_fips}_place.zip", None, work),
        "zcta": lambda: zcta_artifact(geometry_bbox(state.feature_collection)),
    }
    return [collectors[layer]() for layer in ("state", "county", "place", "zcta") if layer in layers]


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Census/PostGIS geography for one state")
    parser.add_argument("--apply", action="store_true", help="apply generated SQL to the linked Supabase project")
    parser.add_argument("--output", type=Path, help="retain the generated SQL at this path")
    parser.add_argument("--layers", default="state,county,place,zcta", help="comma-separated subset of state,county,place,zcta")
    parser.add_argument("--state-fips", default="30", help="two-digit Census state FIPS code (default: 30, Montana)")
    args = parser.parse_args()
    state_fips = args.state_fips.strip().zfill(2)
    if len(state_fips) != 2 or not state_fips.isdigit():
        parser.error("--state-fips must be a two-digit numeric Census state FIPS code")
    layers = {value.strip() for value in args.layers.split(",") if value.strip()}
    unknown = layers - {"state", "county", "place", "zcta"}
    if not layers or unknown:
        parser.error(f"invalid layers: {sorted(unknown)}")
    with tempfile.TemporaryDirectory(prefix="storm-signal-census-") as temp:
        work = Path(temp)
        artifacts = collect(work, layers, state_fips)
        parts, summary = [], []
        scope = STATE_ABBREVIATIONS.get(state_fips, f"state_fips:{state_fips}")
        for artifact in artifacts:
            sql, loaded, rejected = artifact_sql(artifact, scope=scope)
            parts.append(sql)
            summary.append({"area_type": artifact.area_type, "loaded": loaded, "rejected": rejected, "source_sha256": artifact.source_sha256})
            if args.apply:
                apply_sql_batched(sql, work, artifact.area_type)
        sql_path = args.output or work / f"state_{state_fips}_geographies.sql"
        sql_path.write_text("\n".join(parts))
        print(json.dumps({"applied": args.apply, "state_fips": state_fips, "scope": scope, "layers": summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
