from __future__ import annotations

import asyncio
import json
import unittest

from storm_signal_mcp.server import MCPApplication, PROTOCOL_VERSION
from storm_signal_mcp.tools import StormSignalTools


class FakeDatabase:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def rpc(self, name, parameters):
        self.calls.append((name, parameters))
        return self.responses.get(name, [])


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

    def test_tools_list_is_exactly_the_frozen_four(self):
        _, _, body = asyncio.run(request(self.app, "POST", "/mcp", {
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
        }))
        self.assertEqual([t["name"] for t in body["result"]["tools"]], [
            "search_storm_events", "get_storm_event", "assess_location", "summarize_storm_activity"
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
        self.assertEqual(result["score"], 95)
        self.assertEqual(result["classification"], "strong")
        self.assertEqual(len(result["evidence"]["historical_hail_events"]), 1)
        self.assertTrue(any("does not establish property damage" in item for item in result["limitations"]))


if __name__ == "__main__":
    unittest.main()
