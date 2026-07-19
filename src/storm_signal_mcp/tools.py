from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from storm_signal_recon.supabase import SupabaseRest

EVENT_TYPES = [
    "hail_report", "severe_thunderstorm_warning", "tornado_warning",
    "wind_report", "tornado_report", "historical_hail_event",
]


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        value["required"] = required
    return value


TOOL_DEFINITIONS = [
    {
        "name": "search_storm_events",
        "description": "Search persisted Storm Signal events by time, type, state, derived county, Census place, ZCTA, hail size, status, or distance from a coordinate.",
        "inputSchema": _schema({
            "start_at": {"type": "string", "format": "date-time"},
            "end_at": {"type": "string", "format": "date-time"},
            "event_types": {"type": "array", "items": {"type": "string", "enum": EVENT_TYPES}},
            "state": {"type": "string"}, "county": {"type": "string"},
            "place": {"type": "string"}, "zcta": {"type": "string", "pattern": "^[0-9]{5}$"},
            "min_hail_inches": {"type": "number", "minimum": 0},
            "status": {"type": "string"},
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "radius_miles": {"type": "number", "exclusiveMinimum": 0, "maximum": 500},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        }),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "get_storm_event",
        "description": "Get one normalized event with retained source payload versions, Census geography when available, and evidence limitations.",
        "inputSchema": _schema({"event_id": {"type": "string", "format": "uuid"}}, ["event_id"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "assess_location",
        "description": "Produce a deterministic evidence score for a location and time window. It never claims that a property was hit or damaged.",
        "inputSchema": _schema({
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            "start_at": {"type": "string", "format": "date-time"},
            "end_at": {"type": "string", "format": "date-time"},
            "radius_miles": {"type": "number", "exclusiveMinimum": 0, "maximum": 100, "default": 10},
        }, ["latitude", "longitude", "start_at", "end_at"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "summarize_storm_activity",
        "description": "Aggregate persisted storm activity by event type, state, county, or UTC day for a bounded time window.",
        "inputSchema": _schema({
            "start_at": {"type": "string", "format": "date-time"},
            "end_at": {"type": "string", "format": "date-time"},
            "group_by": {"type": "string", "enum": ["event_type", "state", "county", "day"], "default": "event_type"},
            "state": {"type": "string"},
            "event_types": {"type": "array", "items": {"type": "string", "enum": EVENT_TYPES}},
        }, ["start_at", "end_at"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
]


class StormSignalTools:
    def __init__(self, database: SupabaseRest):
        self.database = database

    @classmethod
    def from_environment(cls) -> "StormSignalTools":
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
        return cls(SupabaseRest(url, key))

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        trace_id = str(uuid.uuid4())
        self._validate(name, arguments)
        data_health = self.database.rpc("mcp_data_health", {})
        if name == "search_storm_events":
            data = self.database.rpc("mcp_search_storm_events", self._search_params(arguments))
            result = {"events": data or [], "count": len(data or []), "limitations": self._limitations()}
        elif name == "get_storm_event":
            data = self.database.rpc("mcp_get_storm_event", {"p_event_id": arguments["event_id"]})
            if data is None:
                raise ValueError("Storm event not found")
            geography = self._present_geography(
                self.database.rpc("mcp_get_event_geographies", {"p_event_id": arguments["event_id"]})
            )
            result = {**data, "geography": geography, "limitations": self._limitations()}
        elif name == "summarize_storm_activity":
            data = self.database.rpc("mcp_summarize_storm_activity", {
                "p_start_at": arguments["start_at"], "p_end_at": arguments["end_at"],
                "p_group_by": arguments.get("group_by", "event_type"),
                "p_state": arguments.get("state"), "p_event_types": arguments.get("event_types"),
            })
            result = {"groups": data or [], "group_by": arguments.get("group_by", "event_type"), "limitations": self._limitations()}
        elif name == "assess_location":
            result = self._assess(arguments)
        else:
            raise ValueError(f"Unknown tool: {name}")
        return {
            "trace_id": trace_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_health": data_health,
            **result,
        }

    def _assess(self, a: dict[str, Any]) -> dict[str, Any]:
        radius = float(a.get("radius_miles", 10))
        events = self.database.rpc("mcp_search_storm_events", self._search_params({**a, "limit": 200})) or []
        reports = [e for e in events if e["event_type"] == "hail_report"]
        warnings = [e for e in events if e["event_type"] in ("severe_thunderstorm_warning", "tornado_warning")]
        historical = [e for e in events if e["event_type"] == "historical_hail_event"]
        score, reasons = 0, []
        if warnings:
            score += 15; reasons.append({"points": 15, "reason": "warning evidence in the search radius"})
        if reports:
            score += 30; reasons.append({"points": 30, "reason": "preliminary hail report in the search radius"})
        if any((e.get("distance_miles") or radius + 1) <= 3 for e in reports):
            score += 25; reasons.append({"points": 25, "reason": "hail report within 3 miles"})
        if len(reports) >= 2:
            score += 10; reasons.append({"points": 10, "reason": "multiple nearby hail reports"})
        if any((e.get("magnitude") or 0) >= 1.5 for e in reports):
            score += 15; reasons.append({"points": 15, "reason": "reported hail at least 1.5 inches"})
        score = min(score, 100)
        classification = "strong" if score >= 60 else "moderate" if score >= 25 else "limited"
        return {
            "location": {"latitude": a["latitude"], "longitude": a["longitude"], "radius_miles": radius},
            "window": {"start_at": a["start_at"], "end_at": a["end_at"]},
            "score": score, "classification": classification, "score_reasons": reasons,
            "evidence": {"warnings": warnings, "hail_reports": reports, "historical_hail_events": historical},
            "limitations": self._limitations(),
        }

    @staticmethod
    def _search_params(a: dict[str, Any]) -> dict[str, Any]:
        return {
            "p_start_at": a.get("start_at"), "p_end_at": a.get("end_at"),
            "p_event_types": a.get("event_types"), "p_state": a.get("state"),
            "p_county": a.get("county"), "p_place": a.get("place"), "p_zcta": a.get("zcta"),
            "p_min_hail_inches": a.get("min_hail_inches"),
            "p_status": a.get("status"), "p_lat": a.get("latitude"), "p_lon": a.get("longitude"),
            "p_radius_miles": a.get("radius_miles"), "p_limit": a.get("limit", 50),
        }

    @staticmethod
    def _present_geography(value: dict[str, Any] | None) -> dict[str, Any]:
        geography = value or {"areas": [], "geospatial_status": "insufficient"}
        areas = geography.get("areas") or []
        by_type = {area.get("area_type"): area for area in areas}
        return {
            **geography,
            "summary": {
                "state": (by_type.get("state") or {}).get("name"),
                "county": (by_type.get("county") or {}).get("name"),
                "place": (by_type.get("place") or {}).get("name"),
                "zcta_approximate_zip_area": (by_type.get("zcta") or {}).get("zcta5"),
            },
            "zcta_interpretation": "ZCTA is an approximate ZIP area from Census geography, not a USPS delivery boundary.",
        }

    @staticmethod
    def _validate(name: str, a: dict[str, Any]) -> None:
        names = {tool["name"] for tool in TOOL_DEFINITIONS}
        if name not in names:
            raise ValueError(f"Unknown tool: {name}")
        if name in ("assess_location", "summarize_storm_activity"):
            for key in ("start_at", "end_at"):
                if key not in a: raise ValueError(f"{key} is required")
                datetime.fromisoformat(str(a[key]).replace("Z", "+00:00"))
            if a["start_at"] > a["end_at"]: raise ValueError("start_at must be before end_at")
        if name == "get_storm_event":
            uuid.UUID(str(a.get("event_id", "")))
        coords = (a.get("latitude"), a.get("longitude"))
        if (coords[0] is None) != (coords[1] is None):
            raise ValueError("latitude and longitude must be provided together")
        if coords[0] is not None and not (-90 <= float(coords[0]) <= 90 and -180 <= float(coords[1]) <= 180):
            raise ValueError("Invalid latitude or longitude")
        if coords[0] is not None and not a.get("radius_miles"):
            a["radius_miles"] = 10

    @staticmethod
    def _limitations() -> list[str]:
        return [
            "Warnings describe forecast or warned areas; they do not prove hail at a property.",
            "SPC reports are preliminary observer points, not hail footprints, and may be corrected.",
            "SPC wind and tornado reports are preliminary observation points; unknown speed or scale is preserved rather than inferred.",
            "Historical coordinates can be approximate or absent.",
            "This evidence does not establish property damage, roof condition, or sales qualification.",
        ]
