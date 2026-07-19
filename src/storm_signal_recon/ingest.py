from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable

from .normalize import normalize_snapshot
from .sources import default_historical_year, fetch_ncei_hail_sample, fetch_nws_alerts, fetch_spc_hail
from .supabase import SupabaseRest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ingest normalized severe-weather evidence into Supabase")
    parser.add_argument("--source", choices=("all", "nws", "spc", "historical"), default="all")
    parser.add_argument("--year", type=int, default=default_historical_year())
    parser.add_argument("--states", default="TEXAS,OKLAHOMA")
    parser.add_argument("--historical-limit", type=int, default=100)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY are required", file=sys.stderr)
        return 2
    client = SupabaseRest(url, key)
    collectors: list[tuple[str, Callable]] = []
    if args.source in ("all", "nws"):
        collectors.append(("nws_alerts", fetch_nws_alerts))
    if args.source in ("all", "spc"):
        collectors.extend([
            ("spc_reports", lambda: fetch_spc_hail("today")),
            ("spc_reports", lambda: fetch_spc_hail("yesterday")),
        ])
    if args.source in ("all", "historical"):
        collectors.append((
            "noaa_storm_events",
            lambda: fetch_ncei_hail_sample(args.year, args.states.split(","), args.historical_limit),
        ))

    results, failed = [], False
    for source, collect in collectors:
        run_id = client.start_run(source)
        try:
            pairs = normalize_snapshot(collect())
            existing = client.existing_event_ids(source)
            raw_ids = client.upsert_records([raw for raw, _ in pairs])
            events = []
            for raw, event in pairs:
                event["raw_record_id"] = raw_ids[(raw["source"], raw["source_record_id"], raw["payload_hash"])]
                events.append(event)
            client.upsert_events(events)
            created = sum(event["source_record_id"] not in existing for event in events)
            updated = len(events) - created
            client.finish_run(run_id, "complete", len(pairs), created, updated)
            results.append({"source": source, "status": "complete", "received": len(pairs), "created": created, "updated": updated})
        except Exception as exc:
            failed = True
            message = f"{type(exc).__name__}: {exc}"
            client.finish_run(run_id, "failed", 0, 0, 0, message)
            results.append({"source": source, "status": "failed", "error": message})
    print(json.dumps(results, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
