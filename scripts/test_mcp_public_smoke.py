#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

MCP_URL = "https://mcp.vectoros.co/mcp"
HEALTH_URL = "https://mcp.vectoros.co/health"
COVERED = {"TX", "FL", "LA", "GA", "NC"}


def http_json(url: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, method="GET" if data is None else "POST")
    request.add_header("accept", "application/json, text/event-stream")
    request.add_header("user-agent", "storm-signal-public-acceptance/1.0")
    if data is not None:
        request.add_header("content-type", "application/json")
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read())


def rpc(method: str, params: dict, request_id: int) -> dict:
    return http_json(MCP_URL, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})


def call(name: str, arguments: dict, request_id: int) -> tuple[dict, bool]:
    result = rpc("tools/call", {"name": name, "arguments": arguments}, request_id)["result"]
    return result.get("structuredContent") or {}, bool(result.get("isError"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    checks: list[str] = []
    require(http_json(HEALTH_URL).get("status") == "ok", "health endpoint failed")
    checks.append("health")

    initialized = rpc("initialize", {
        "protocolVersion": "2025-11-25", "capabilities": {},
        "clientInfo": {"name": "public-acceptance", "version": "1"},
    }, 1)
    require("14 days" in initialized["result"].get("instructions", ""), "coverage instructions missing")
    checks.append("initialize")

    tools = rpc("tools/list", {}, 2)["result"]["tools"]
    require({tool["name"] for tool in tools} == {
        "search_storm_events", "get_storm_event", "assess_location", "summarize_storm_activity",
        "search_tropical_cyclones",
    }, "public tool catalog changed")
    checks.append("tools_list")

    search, error = call("search_storm_events", {}, 3)
    require(not error and search.get("status") == "in_coverage", "default search failed")
    require({event.get("state") for event in search.get("events", [])} <= COVERED, "default search leaked a state")
    checks.append("default_scope")

    colorado, error = call("search_storm_events", {"state": "Colorado"}, 4)
    require(not error and colorado.get("status") == "out_of_coverage", "Colorado guard failed")
    checks.append("unsupported_state")

    now = datetime.now(timezone.utc)
    denver, error = call("assess_location", {
        "latitude": 39.7392, "longitude": -104.9903,
        "start_at": (now - timedelta(days=2)).isoformat(), "end_at": now.isoformat(),
    }, 5)
    require(not error and denver.get("status") == "out_of_coverage", "Denver guard failed")
    require("score" not in denver, "out-of-coverage location received a score")
    checks.append("unsupported_coordinates")

    austin, error = call("assess_location", {
        "latitude": 30.2672, "longitude": -97.7431,
        "start_at": (now - timedelta(days=2)).isoformat(), "end_at": now.isoformat(),
    }, 6)
    require(not error and austin.get("status") == "in_coverage", "Austin assessment failed")
    require(austin.get("methodology", {}).get("id") == "storm-signal-location-multihazard-v1", "multihazard methodology missing")
    require(set(austin.get("components", {})) == {
        "severity", "evidence_concentration", "proximity", "recency", "evidence_quality",
    }, "multihazard components changed")
    require(austin.get("support_level") in {"strong", "moderate", "limited", "insufficient"}, "support level missing")
    require("wind" in austin.get("hazards", {}) and "tornado" in austin.get("hazards", {}), "multihazard evidence missing")
    checks.append("multihazard_location_score")

    summary, error = call("summarize_storm_activity", {
        "start_at": (now - timedelta(days=30)).isoformat(),
        "end_at": (now + timedelta(hours=1)).isoformat(), "group_by": "state",
    }, 10)
    require(not error and summary.get("window", {}).get("truncated") is True, "14-day clamp missing")
    require({group.get("group") for group in summary.get("groups", [])} <= COVERED, "summary leaked a state")
    checks.append("window_and_summary_scope")

    tropical, error = call("search_tropical_cyclones", {"active_only": True}, 7)
    require(not error and tropical.get("status") == "in_coverage", "default NHC search failed")
    require(tropical.get("evidence_domain") == "nhc_tropical_cyclone", "NHC evidence domain missing")
    require(tropical.get("data_health", {}).get("nhc", {}).get("state") in {
        "active", "seasonally_empty", "degraded", "failed",
    }, "NHC health state missing")
    if tropical.get("cyclones"):
        geography = tropical["cyclones"][0].get("geography", {})
        require("total_area_count" in geography and "areas" in geography, "compact NHC geography missing")
        require(len(geography["areas"]) <= 40, "NHC geography sample is unbounded")
    checks.append("nhc_default_scope")

    tropical_colorado, error = call("search_tropical_cyclones", {"state": "Colorado"}, 8)
    require(not error and tropical_colorado.get("status") == "out_of_coverage", "NHC Colorado guard failed")
    require(tropical_colorado.get("cyclones") == [], "NHC out-of-coverage result leaked evidence")
    checks.append("nhc_unsupported_state")

    # Weather can be quiet. Exercise detail only when a covered event exists.
    if search.get("events"):
        event_id = search["events"][0]["id"]
        detail, error = call("get_storm_event", {"event_id": event_id}, 9)
        require(not error and detail.get("status") == "in_coverage", "covered detail failed")
        require(detail.get("event", {}).get("id") == event_id, "detail continuity failed")
        checks.append("search_to_detail")

    print(json.dumps({"status": "passed", "checks": checks, "total": len(checks)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, indent=2), file=sys.stderr)
        raise
