#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

MCP_URL = "https://mcp.vectoros.co/mcp"
HEALTH_URL = "https://mcp.vectoros.co/health"
COVERED = {"TX", "FL", "LA", "GA", "NC"}
STATE_NAMES = {
    "Texas": "TX", "Florida": "FL", "Louisiana": "LA",
    "Georgia": "GA", "North Carolina": "NC",
}
EXTERNAL_EVENT_ID = "90c1d889-35d1-48d4-aa31-c9ad6f86ba19"


def http_json(url: str, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=body, method="GET" if body is None else "POST")
    request.add_header("accept", "application/json, text/event-stream")
    request.add_header("user-agent", "storm-signal-controlled-demo-acceptance/1.0")
    if body is not None:
        request.add_header("content-type", "application/json")
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read())


def rpc(method: str, params: dict, request_id: int) -> dict:
    return http_json(MCP_URL, {
        "jsonrpc": "2.0", "id": request_id, "method": method, "params": params,
    })


def call(tool: str, arguments: dict, request_id: int) -> tuple[dict, bool]:
    response = rpc("tools/call", {"name": tool, "arguments": arguments}, request_id)
    result = response["result"]
    return result.get("structuredContent") or {}, bool(result.get("isError"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    results: list[dict] = []

    health = http_json(HEALTH_URL)
    require(health.get("status") == "ok", "health endpoint is not ok")
    results.append({"test": "health", "passed": True})

    initialized = rpc("initialize", {
        "protocolVersion": "2025-11-25", "capabilities": {},
        "clientInfo": {"name": "controlled-demo-acceptance", "version": "1"},
    }, 1)
    instructions = initialized["result"].get("instructions", "")
    require("Texas" in instructions and "14 days" in instructions, "initialize instructions omit coverage contract")
    results.append({"test": "initialize_contract", "passed": True})

    tools = rpc("tools/list", {}, 2)["result"]["tools"]
    require({item["name"] for item in tools} == {
        "search_storm_events", "get_storm_event", "assess_location", "summarize_storm_activity",
        "search_tropical_cyclones", "rank_markets",
    }, "tool list changed")
    require(all("controlled demo" in item["description"] or "TX" in item["description"] or item["name"] == "rank_markets" for item in tools), "tool descriptions omit coverage")
    results.append({"test": "six_tool_contract", "passed": True})

    default_search, error = call("search_storm_events", {}, 3)
    require(not error and default_search.get("status") == "in_coverage", "default search failed")
    require(default_search.get("coverage", {}).get("scope_defaulted") is True, "default scope not disclosed")
    require(default_search.get("window", {}).get("available_window_days") == 14, "14-day window missing")
    require({event.get("state") for event in default_search.get("events", [])} <= COVERED, "default search leaked a state")
    results.append({"test": "default_search_five_state_scope", "passed": True, "count": default_search.get("count")})

    warnings, error = call("search_storm_events", {
        "event_types": ["severe_thunderstorm_warning", "tornado_warning"], "limit": 200,
    }, 4)
    require(not error and warnings.get("status") == "in_coverage", "NWS warning search failed")
    require(warnings.get("count", 0) > 0, "no covered NWS warnings are visible")
    require(all(event.get("source") == "nws_alerts" for event in warnings.get("events", [])), "warning search returned another source")
    require({event.get("state") for event in warnings.get("events", [])} <= COVERED, "warning search leaked a state")
    results.append({"test": "nws_same_state_normalization", "passed": True, "count": warnings.get("count")})

    for index, (state_name, state_code) in enumerate(STATE_NAMES.items(), start=10):
        content, error = call("search_storm_events", {"state": state_name, "limit": 20}, index)
        require(not error and content.get("status") == "in_coverage", f"{state_name} was not accepted")
        require(all(event.get("state") == state_code for event in content.get("events", [])), f"{state_name} leaked another state")
        results.append({"test": f"covered_state_{state_code}", "passed": True, "count": content.get("count")})

    colorado, error = call("search_storm_events", {"state": "Colorado"}, 20)
    require(not error and colorado.get("status") == "out_of_coverage", "Colorado was not guarded")
    require(colorado.get("count") == 0 and "additional states" in colorado.get("message", ""), "Colorado response is not educational")
    results.append({"test": "unsupported_state", "passed": True})

    now = datetime.now(timezone.utc)
    two_days_ago = now - timedelta(days=2)
    thirty_days_ago = now - timedelta(days=30)
    dates = {"start_at": two_days_ago.isoformat(), "end_at": now.isoformat()}

    austin, error = call("assess_location", {
        "latitude": 30.2672, "longitude": -97.7431, **dates,
    }, 21)
    require(not error and austin.get("status") == "in_coverage", "Austin assessment failed")
    require(austin.get("methodology", {}).get("id") == "storm-signal-location-multihazard-v1", "Austin multihazard methodology missing")
    require(austin.get("support_level") in {"strong", "moderate", "limited", "insufficient"}, "Austin support level missing")
    results.append({"test": "covered_coordinates_multihazard", "passed": True})

    denver, error = call("assess_location", {
        "latitude": 39.7392, "longitude": -104.9903, **dates,
    }, 22)
    require(not error and denver.get("status") == "out_of_coverage", "Denver was not guarded")
    require("score" not in denver, "Denver received a commercial score")
    results.append({"test": "unsupported_coordinates", "passed": True})

    mismatch, error = call("search_storm_events", {
        "state": "Texas", "latitude": 25.7617, "longitude": -80.1918, "radius_miles": 10,
    }, 23)
    require(not error and mismatch.get("status") == "location_mismatch", "state/coordinate mismatch was not guarded")
    results.append({"test": "location_mismatch", "passed": True})

    summary, error = call("summarize_storm_activity", {
        "start_at": thirty_days_ago.isoformat(), "end_at": (now + timedelta(hours=1)).isoformat(),
        "group_by": "state",
    }, 24)
    require(not error and summary.get("status") == "in_coverage", "summary failed")
    require(summary.get("window", {}).get("truncated") is True, "30-day summary was not disclosed as truncated")
    require({group.get("group") for group in summary.get("groups", [])} <= COVERED, "summary leaked a state")
    results.append({"test": "summary_30_to_14_days", "passed": True, "groups": len(summary.get("groups", []))})

    events = default_search.get("events", [])
    require(bool(events), "no covered event available for conversational detail test")
    selected_id = events[0]["id"]
    detail, error = call("get_storm_event", {"event_id": selected_id}, 25)
    require(not error and detail.get("status") == "in_coverage", "covered event detail failed")
    require(detail.get("event", {}).get("id") == selected_id, "detail did not preserve selected event")
    results.append({"test": "conversation_search_to_detail", "passed": True, "event_id": selected_id})

    external, error = call("get_storm_event", {"event_id": EXTERNAL_EVENT_ID}, 26)
    require(not error and external.get("status") == "out_of_coverage", "external event id was not guarded")
    require("event" not in external, "external event payload leaked")
    results.append({"test": "external_event_id", "passed": True})

    missing, error = call("get_storm_event", {"event_id": "00000000-0000-4000-8000-000000000000"}, 27)
    require(error and "not found" in missing.get("error", "").lower(), "missing event was not reported as not found")
    results.append({"test": "missing_event_id", "passed": True})

    print(json.dumps({"status": "passed", "tests": results, "total": len(results)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, indent=2), file=sys.stderr)
        raise
