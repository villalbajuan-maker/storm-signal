from __future__ import annotations

import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone

from storm_signal_mcp.server import MCPApplication, PROTOCOL_VERSION
from storm_signal_mcp.tools import StormSignalTools


class FakeDatabase:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def rpc(self, name, parameters):
        self.calls.append((name, parameters))
        if name not in self.responses and name == "mcp_check_coverage":
            return {"status": "in_coverage", "scope_defaulted": True, "covered_states": []}
        if name not in self.responses and name == "mcp_check_event_coverage":
            return {"status": "in_coverage", "requested_state_code": "TX", "covered_states": []}
        value = self.responses.get(name, [])
        return value(parameters) if callable(value) else value


async def request(app, method, path, payload=None, headers=None):
    sent = []
    body = b"" if payload is None else json.dumps(payload).encode()
    messages = iter([{"type": "http.request", "body": body, "more_body": False}])

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "method": method, "path": path,
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    await app(scope, receive, send)
    response_headers = {k.decode(): v.decode() for k, v in sent[0]["headers"]}
    response_body = sent[1].get("body", b"")
    return sent[0]["status"], response_headers, json.loads(response_body) if response_body else None


class MCPTransportTests(unittest.TestCase):
    def setUp(self):
        self.app = MCPApplication(StormSignalTools(FakeDatabase()))

    def test_initialize_returns_negotiated_protocol_and_session(self):
        status, headers, body = asyncio.run(request(self.app, "POST", "/mcp", {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
        }))
        self.assertEqual(status, 200)
        self.assertEqual(body["result"]["protocolVersion"], PROTOCOL_VERSION)
        self.assertIn("mcp-session-id", headers)
        self.assertEqual(headers["access-control-expose-headers"], "mcp-session-id")

    def test_tools_list_is_exactly_the_frozen_six(self):
        _, _, body = asyncio.run(request(self.app, "POST", "/mcp", {
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
        }))
        self.assertEqual([t["name"] for t in body["result"]["tools"]], [
            "search_storm_events", "get_storm_event", "assess_location",
            "summarize_storm_activity", "search_tropical_cyclones", "rank_markets",
        ])

    def test_notification_is_accepted_without_response_body(self):
        status, _, body = asyncio.run(request(self.app, "POST", "/mcp", {
            "jsonrpc": "2.0", "method": "notifications/initialized"
        }))
        self.assertEqual((status, body), (202, None))

    def test_get_mcp_is_405_and_health_is_separate(self):
        status, _, _ = asyncio.run(request(self.app, "GET", "/mcp"))
        health, _, body = asyncio.run(request(self.app, "GET", "/health"))
        self.assertEqual(status, 405)
        self.assertEqual(health, 200)
        self.assertEqual(body["status"], "ok")

    def test_tool_error_uses_mcp_tool_result_not_protocol_error(self):
        _, _, body = asyncio.run(request(self.app, "POST", "/mcp", {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "get_storm_event", "arguments": {"event_id": "bad"}},
        }))
        self.assertTrue(body["result"]["isError"])
        self.assertIn("trace_id", body["result"]["structuredContent"])

    def test_successful_tool_has_readable_text_fallback(self):
        database = FakeDatabase({
            "mcp_get_storm_event": {
                "event": {"id": "0e8f6a0d-f364-4cdd-8e32-f4c18fed8a64", "county": "Floyd"},
                "source_versions": [],
            },
            "mcp_get_event_geographies": {
                "vintage": 2025,
                "geospatial_status": "complete",
                "areas": [
                    {"area_type": "state", "name": "Texas", "geoid": "48"},
                    {"area_type": "county", "name": "Floyd County", "geoid": "48153"},
                    {"area_type": "zcta", "name": "ZCTA5 79235", "zcta5": "79235"},
                ],
            },
        })
        app = MCPApplication(StormSignalTools(database))
        _, _, body = asyncio.run(request(app, "POST", "/mcp", {
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "get_storm_event", "arguments": {
                "event_id": "0e8f6a0d-f364-4cdd-8e32-f4c18fed8a64"
            }},
        }))
        text = body["result"]["content"][0]["text"]
        self.assertIn("Floyd", text)
        self.assertIn("79235", text)
        self.assertIn("0e8f6a0d-f364-4cdd-8e32-f4c18fed8a64", text)
        self.assertEqual(body["result"]["structuredContent"]["geography"]["geospatial_status"], "complete")
        self.assertEqual(
            body["result"]["structuredContent"]["geography"]["summary"]["zcta_approximate_zip_area"],
            "79235",
        )
        self.assertIn(("mcp_get_event_geographies", {
            "p_event_id": "0e8f6a0d-f364-4cdd-8e32-f4c18fed8a64"
        }), database.calls)


class MCPToolTests(unittest.TestCase):
    def test_assessment_is_deterministic_and_honest(self):
        events = [
            {"id": "1", "event_type": "severe_thunderstorm_warning", "distance_miles": 2},
            {"id": "2", "event_type": "hail_report", "distance_miles": 2, "magnitude": 1.75},
            {"id": "3", "event_type": "hail_report", "distance_miles": 7, "magnitude": 1.0},
            {"id": "4", "event_type": "historical_hail_event", "distance_miles": 5},
        ]
        tools = StormSignalTools(FakeDatabase({"mcp_search_storm_events": events}))
        result = tools.call("assess_location", {
            "latitude": 30.2672, "longitude": -97.7431,
            "start_at": "2026-07-18T00:00:00Z", "end_at": "2026-07-19T23:59:59Z",
            "radius_miles": 10,
        })
        self.assertEqual(result["score"], 56)
        self.assertEqual(result["classification"], "moderate")
        self.assertEqual(result["methodology"]["id"], "storm-signal-location-multihazard-v1")
        self.assertEqual(result["components"]["severity"]["score"], 16)
        self.assertEqual(len(result["evidence"]["historical_hail_events"]), 1)
        self.assertTrue(any("does not establish property damage" in item for item in result["limitations"]))

    def test_multihazard_assessment_scores_hail_wind_and_tornado(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        events = [
            {"id": "h", "event_type": "hail_report", "distance_miles": 2, "magnitude": 1.75, "started_at": recent},
            {"id": "w", "event_type": "wind_report", "distance_miles": 4, "magnitude": 80, "started_at": recent},
            {"id": "t", "event_type": "tornado_report", "distance_miles": 5, "magnitude": None, "started_at": recent},
            {"id": "tw", "event_type": "tornado_warning", "distance_miles": 8, "started_at": recent},
        ]
        health = {"sources": [
            {"source": "spc_reports", "freshness_status": "fresh"},
            {"source": "nws_alerts", "freshness_status": "fresh"},
        ], "geography": {"event_processing": {"pending": 0}}}
        result = StormSignalTools(FakeDatabase({
            "mcp_search_storm_events": events, "mcp_data_health": health,
        })).call("assess_location", {
            "latitude": 30.2672, "longitude": -97.7431,
            "start_at": recent, "end_at": datetime.now(timezone.utc).isoformat(), "radius_miles": 10,
        })
        self.assertEqual(result["score"], 97)
        self.assertEqual(result["support_level"], "strong")
        self.assertEqual(result["hazards"]["wind"]["max_mph"], 80)
        self.assertEqual(result["hazards"]["tornado"]["report_count"], 1)
        self.assertEqual(result["components"]["evidence_concentration"]["score"], 17)
        self.assertEqual(result["methodology"]["penalty_points"], 0)

    def test_multihazard_assessment_penalizes_degraded_inputs(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        health = {"sources": [
            {"source": "spc_reports", "freshness_status": "stale"},
            {"source": "nws_alerts", "freshness_status": "unhealthy"},
        ], "geography": {"event_processing": {"pending": 2}}}
        result = StormSignalTools(FakeDatabase({
            "mcp_search_storm_events": [{
                "id": "warning", "event_type": "severe_thunderstorm_warning",
                "distance_miles": 3, "started_at": recent,
            }],
            "mcp_data_health": health,
        })).call("assess_location", {
            "latitude": 30.2672, "longitude": -97.7431,
            "start_at": recent, "end_at": datetime.now(timezone.utc).isoformat(), "radius_miles": 10,
        })
        self.assertEqual(result["methodology"]["penalty_points"], 20)
        self.assertEqual(result["score"], 5)
        self.assertEqual(result["support_level"], "insufficient")
        self.assertEqual(len(result["missing_data"]), 3)

    def test_tool_response_exposes_data_freshness_and_coverage(self):
        health = {
            "sources": [{"source": "spc_reports", "freshness_status": "fresh"}],
            "coverage": {"states_with_recent_reports": 6},
            "geography": {
                "queue_status": "healthy", "vintage": 2025,
                "method_version": "census-postgis-v1",
                "covered_state_count": 5,
                "event_processing": {"pending": 0},
            },
        }
        tools = StormSignalTools(FakeDatabase({
            "mcp_data_health": health,
            "mcp_search_storm_events": [],
        }))
        result = tools.call("search_storm_events", {})
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["data_health"], health)
        self.assertEqual(result["data_health"]["geography"]["queue_status"], "healthy")
        self.assertEqual(result["data_health"]["geography"]["covered_state_count"], 5)

    def test_unsupported_state_returns_educational_coverage_result(self):
        coverage = {
            "status": "out_of_coverage", "requested_state": "Colorado",
            "covered_states": [{"state_code": "TX", "name": "Texas"}],
        }
        database = FakeDatabase({"mcp_check_coverage": coverage, "mcp_data_health": {}})
        result = StormSignalTools(database).call("search_storm_events", {"state": "Colorado"})
        self.assertEqual(result["status"], "out_of_coverage")
        self.assertIn("Texas, Florida, Louisiana, Georgia, and North Carolina", result["message"])
        self.assertEqual(result["events"], [])
        self.assertFalse(any(name == "mcp_search_storm_events" for name, _ in database.calls))

    def test_requested_30_days_discloses_14_day_effective_window(self):
        tools = StormSignalTools(FakeDatabase({"mcp_search_storm_events": []}))
        result = tools.call("search_storm_events", {
            "start_at": "2026-06-01T00:00:00Z", "end_at": "2099-01-01T00:00:00Z",
        })
        self.assertEqual(result["window"]["available_window_days"], 14)
        self.assertTrue(result["window"]["truncated"])

    def test_search_passes_derived_geography_filters(self):
        database = FakeDatabase({"mcp_search_storm_events": []})
        tools = StormSignalTools(database)
        tools.call("search_storm_events", {
            "county": "Pondera County", "place": "Ledger", "zcta": "59425"
        })
        params = next(parameters for name, parameters in database.calls if name == "mcp_search_storm_events")
        self.assertEqual(params["p_county"], "Pondera County")
        self.assertEqual(params["p_place"], "Ledger")
        self.assertEqual(params["p_zcta"], "59425")

    def test_tropical_search_preserves_forecast_semantics_and_filters(self):
        evidence = [{
            "cyclone": {"atcf_id": "AL112017", "name": "Irma"},
            "feature": {"product_type": "operational_cone", "evidence_class": "uncertainty"},
            "interpretation": "Within the cone means forecast-track uncertainty.",
        }]
        database = FakeDatabase({"mcp_search_tropical_cyclones_compact": evidence})
        result = StormSignalTools(database).call("search_tropical_cyclones", {
            "active_only": False, "state": "Florida",
            "product_types": ["operational_cone"], "limit": 10,
        })
        self.assertEqual(result["evidence_domain"], "nhc_tropical_cyclone")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["cyclones"][0]["feature"]["evidence_class"], "uncertainty")
        self.assertTrue(any("not observations" in item for item in result["limitations"]))
        params = next(parameters for name, parameters in database.calls if name == "mcp_search_tropical_cyclones_compact")
        self.assertEqual(params["p_state"], "Florida")
        self.assertFalse(params["p_active_only"])

    def test_tropical_search_outside_coverage_does_not_query_evidence(self):
        database = FakeDatabase({
            "mcp_check_coverage": {"status": "out_of_coverage", "requested_state": "Colorado"},
            "mcp_data_health": {"nhc": {"state": "active"}},
        })
        result = StormSignalTools(database).call("search_tropical_cyclones", {"state": "Colorado"})
        self.assertEqual(result["status"], "out_of_coverage")
        self.assertEqual(result["cyclones"], [])
        self.assertFalse(any(name == "mcp_search_tropical_cyclones_compact" for name, _ in database.calls))

    def test_market_ranking_is_deterministic_and_operationally_weighted(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        events = [
            {"id": "h", "event_type": "hail_report", "distance_miles": 2, "magnitude": 1.75, "started_at": recent},
            {"id": "w", "event_type": "wind_report", "distance_miles": 4, "magnitude": 80, "started_at": recent},
            {"id": "t", "event_type": "tornado_report", "distance_miles": 5, "started_at": recent},
            {"id": "tw", "event_type": "tornado_warning", "distance_miles": 8, "started_at": recent},
        ]
        health = {"sources": [
            {"source": "spc_reports", "freshness_status": "fresh"},
            {"source": "nws_alerts", "freshness_status": "fresh"},
        ], "geography": {"queue_status": "healthy", "event_processing": {"pending": 0}}}
        result = StormSignalTools(FakeDatabase({
            "mcp_search_storm_events": events, "mcp_data_health": health,
        })).call("rank_markets", {
            "markets": [
                {"name": "Near market", "latitude": 30.2672, "longitude": -97.7431},
                {"name": "Far market", "latitude": 34.7465, "longitude": -92.2896},
            ],
            "operating_base": {"name": "Austin", "latitude": 30.2672, "longitude": -97.7431},
            "start_at": recent, "end_at": datetime.now(timezone.utc).isoformat(), "radius_miles": 10,
        })
        self.assertEqual(result["methodology"]["id"], "storm-signal-market-ranking-v1")
        self.assertEqual(result["markets"][0]["name"], "Near market")
        self.assertEqual(result["markets"][0]["rank"], 1)
        self.assertEqual(result["markets"][0]["decision"], "prioritize")
        self.assertGreater(result["markets"][0]["final_score"], result["markets"][1]["final_score"])
        self.assertIn("straight-line", result["methodology"]["distance_interpretation"])

    def test_market_ranking_keeps_out_of_coverage_candidate_ineligible(self):
        def coverage(parameters):
            if parameters.get("p_lat") and parameters["p_lat"] > 35:
                return {"status": "out_of_coverage", "requested_state": "Colorado"}
            return {"status": "in_coverage", "scope_defaulted": parameters.get("p_lat") is None}
        database = FakeDatabase({"mcp_check_coverage": coverage, "mcp_data_health": {
            "geography": {"queue_status": "healthy", "event_processing": {"pending": 0}},
        }})
        result = StormSignalTools(database).call("rank_markets", {
            "markets": [
                {"name": "Austin", "latitude": 30.2672, "longitude": -97.7431},
                {"name": "Denver", "latitude": 39.7392, "longitude": -104.9903},
            ],
            "start_at": "2026-07-18T00:00:00Z", "end_at": "2026-07-19T23:59:59Z",
        })
        denver = next(item for item in result["markets"] if item["name"] == "Denver")
        self.assertEqual(result["status"], "partial")
        self.assertFalse(denver["eligible"])
        self.assertIsNone(denver["final_score"])
        self.assertEqual(denver["decision"], "insufficient_evidence")


if __name__ == "__main__":
    unittest.main()
