from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .sources import (
    default_historical_year,
    fetch_ncei_hail_sample,
    fetch_nws_alerts,
    fetch_spc_reports,
    write_snapshot,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect representative NOAA/NWS severe-weather payloads")
    parser.add_argument("--output", type=Path, default=Path("data/runs"), help="parent output directory")
    parser.add_argument("--year", type=int, default=default_historical_year(), help="NCEI sample year")
    parser.add_argument("--states", default="TEXAS,OKLAHOMA", help="comma-separated full state names")
    parser.add_argument("--historical-limit", type=int, default=100, help="maximum historical hail rows")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.output / run_id
    manifest = {"run_id": run_id, "status": "running", "sources": [], "errors": []}
    collectors = [
        ("nws_alerts", fetch_nws_alerts),
        *[(f"spc_{kind}_{day}", lambda day=day, kind=kind: fetch_spc_reports(day, kind))
          for day in ("today", "yesterday") for kind in ("hail", "wind", "torn")],
        (
            "noaa_storm_events_hail",
            lambda: fetch_ncei_hail_sample(args.year, args.states.split(","), args.historical_limit),
        ),
    ]
    for name, collect in collectors:
        try:
            manifest["sources"].append(write_snapshot(collect(), run_dir))
        except Exception as exc:  # continue so one upstream outage does not hide other evidence
            manifest["errors"].append({"source": name, "error": f"{type(exc).__name__}: {exc}"})
    manifest["status"] = "complete" if not manifest["errors"] else "partial"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0 if not manifest["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())
