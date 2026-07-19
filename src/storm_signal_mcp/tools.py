from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from storm_signal_recon.supabase import SupabaseRest

EVENT_TYPES = [
    "hail_report", "severe_thunderstorm_warning", "tornado_warning",
    "wind_report", "tornado_report", "historical_hail_event",
]
NHC_PRODUCT_TYPES = [
    "analysis_center", "forecast_track_point", "forecast_track_line",
    "operational_cone", "experimental_cone", "watch_warning", "wind_radius",
    "wind_probability", "arrival_time", "storm_surge_watch_warning",
    "storm_surge_probability", "storm_surge_inundation",
]
NHC_EVIDENCE_CLASSES = [
    "analysis", "forecast", "uncertainty", "watch_warning", "probability",
    "preliminary_observation", "final_historical",
]
COVERAGE_MESSAGE = "This location is not yet part of Storm Signal's controlled demo coverage. We currently provide commercial analysis for Texas, Florida, Louisiana, Georgia, and North Carolina. Coverage for additional states is coming soon."
IN_COVERAGE_MESSAGE = "This request is within Storm Signal's controlled demo coverage for Texas, Florida, Louisiana, Georgia, and North Carolina."
WINDOW_DAYS = 14


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        value["required"] = required
    return value


TOOL_DEFINITIONS = [
    {
        "name": "search_storm_events",
        "description": "Search recent events within the controlled demo coverage: Texas, Florida, Louisiana, Georgia, and North Carolina. Unlocated searches default to all five states; the available window is 14 days.",
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
        "description": "Get one normalized event only when it belongs to the five-state controlled demo coverage, with source versions, Census geography, and limitations.",
        "inputSchema": _schema({"event_id": {"type": "string", "format": "uuid"}}, ["event_id"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "assess_location",
        "description": "Produce a deterministic multihazard support score for hail, wind, tornado, and warning evidence near a covered location over the available 14-day window. NHC forecasts remain separate context.",
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
        "description": "Aggregate activity only for TX, FL, LA, GA, and NC over the available 14-day window. Unlocated requests default to all five states.",
        "inputSchema": _schema({
            "start_at": {"type": "string", "format": "date-time"},
            "end_at": {"type": "string", "format": "date-time"},
            "group_by": {"type": "string", "enum": ["event_type", "state", "county", "day"], "default": "event_type"},
            "state": {"type": "string"},
            "event_types": {"type": "array", "items": {"type": "string", "enum": EVENT_TYPES}},
        }, ["start_at", "end_at"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "search_tropical_cyclones",
        "description": "Search versioned NHC Atlantic cyclone advisories, tracks, operational cones, watches/warnings, and 34/50/64-kt wind fields that intersect TX, FL, LA, GA, or NC.",
        "inputSchema": _schema({
            "active_only": {"type": "boolean", "default": True},
            "atcf_id": {"type": "string", "pattern": "^[A-Za-z]{2}[0-9]{6}$"},
            "issued_after": {"type": "string", "format": "date-time"},
            "issued_before": {"type": "string", "format": "date-time"},
            "product_types": {"type": "array", "items": {"type": "string", "enum": NHC_PRODUCT_TYPES}},
            "evidence_classes": {"type": "array", "items": {"type": "string", "enum": NHC_EVIDENCE_CLASSES}},
            "state": {"type": "string"}, "county": {"type": "string"},
            "place": {"type": "string"}, "zcta": {"type": "string", "pattern": "^[0-9]{5}$"},
            "valid_at": {"type": "string", "format": "date-time"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        }),
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
        window = self._effective_window(arguments)
        if name == "get_storm_event":
            coverage = self._present_coverage(self.database.rpc("mcp_check_event_coverage", {"p_event_id": arguments["event_id"]}))
            if coverage.get("status") == "not_found":
                raise ValueError("Storm event not found")
            if coverage.get("status") != "in_coverage":
                result = self._unavailable(coverage, None)
            else:
                data = self.database.rpc("mcp_get_storm_event", {"p_event_id": arguments["event_id"]})
                if data is None:
                    raise ValueError("Storm event not found")
                geography = self._present_geography(
                    self.database.rpc("mcp_get_event_geographies", {"p_event_id": arguments["event_id"]})
                )
                result = {"status": "in_coverage", "coverage": coverage, **data, "geography": geography, "limitations": self._limitations()}
            return {"trace_id": trace_id, "generated_at": datetime.now(timezone.utc).isoformat(), "data_health": data_health, **result}

        coverage = self._present_coverage(self.database.rpc("mcp_check_coverage", {
            "p_state": arguments.get("state"), "p_lat": arguments.get("latitude"), "p_lon": arguments.get("longitude"),
        }))
        if coverage.get("status") != "in_coverage":
            result = self._tropical_unavailable(coverage) if name == "search_tropical_cyclones" else self._unavailable(coverage, window)
            return {"trace_id": trace_id, "generated_at": datetime.now(timezone.utc).isoformat(), "data_health": data_health, **result}
        if name == "search_storm_events":
            data = self.database.rpc("mcp_search_storm_events", self._search_params(arguments))
            result = {"status": "in_coverage", "coverage": coverage, "window": window, "events": data or [], "count": len(data or []), "limitations": self._limitations()}
        elif name == "summarize_storm_activity":
            data = self.database.rpc("mcp_summarize_storm_activity", {
                "p_start_at": arguments["start_at"], "p_end_at": arguments["end_at"],
                "p_group_by": arguments.get("group_by", "event_type"),
                "p_state": arguments.get("state"), "p_event_types": arguments.get("event_types"),
            })
            result = {"status": "in_coverage", "coverage": coverage, "window": window, "groups": data or [], "group_by": arguments.get("group_by", "event_type"), "limitations": self._limitations()}
        elif name == "assess_location":
            result = {"status": "in_coverage", "coverage": coverage, **self._assess(arguments, data_health)}
        elif name == "search_tropical_cyclones":
            data = self.database.rpc("mcp_search_tropical_cyclones_compact", self._tropical_params(arguments))
            result = {
                "status": "in_coverage", "coverage": coverage,
                "cyclones": data or [], "count": len(data or []),
                "evidence_domain": "nhc_tropical_cyclone",
                "limitations": self._nhc_limitations(),
            }
        else:
            raise ValueError(f"Unknown tool: {name}")
        return {
            "trace_id": trace_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_health": data_health,
            **result,
        }

    def _assess(self, a: dict[str, Any], data_health: dict[str, Any]) -> dict[str, Any]:
        radius = float(a.get("radius_miles", 10))
        events = self.database.rpc("mcp_search_storm_events", self._search_params({**a, "limit": 200})) or []
        hail = [e for e in events if e["event_type"] == "hail_report"]
        wind = [e for e in events if e["event_type"] == "wind_report"]
        tornado = [e for e in events if e["event_type"] == "tornado_report"]
        severe_warnings = [e for e in events if e["event_type"] == "severe_thunderstorm_warning"]
        tornado_warnings = [e for e in events if e["event_type"] == "tornado_warning"]
        warnings = severe_warnings + tornado_warnings
        historical = [e for e in events if e["event_type"] == "historical_hail_event"]
        observed = hail + wind + tornado

        max_hail = max((float(e["magnitude"]) for e in hail if e.get("magnitude") is not None), default=None)
        max_wind = max((float(e["magnitude"]) for e in wind if e.get("magnitude") is not None), default=None)
        hail_severity = 0 if not hail else 15 if max_hail is not None and max_hail >= 2 else 12 if max_hail is not None and max_hail >= 1.5 else 8 if max_hail is not None and max_hail >= 1 else 4
        wind_severity = 0 if not wind else 14 if max_wind is not None and max_wind >= 75 else 10 if max_wind is not None and max_wind >= 58 else 5 if max_wind is not None else 4
        severity = min(35, hail_severity + wind_severity + (18 if tornado else 0) + (8 if tornado_warnings else 0) + (4 if severe_warnings else 0))

        observed_count = len(observed)
        concentration = 18 if observed_count >= 4 else 15 if observed_count == 3 else 10 if observed_count == 2 else 5 if observed_count == 1 else 0
        observed_hazards = sum(bool(group) for group in (hail, wind, tornado))
        concentration = min(20, concentration + (2 if observed_hazards >= 2 else 0))

        distances = [float(e["distance_miles"]) for e in observed if e.get("distance_miles") is not None]
        nearest = min(distances, default=None)
        proximity = 15 if nearest is not None and nearest <= 3 else 12 if nearest is not None and nearest <= 5 else 8 if nearest is not None and nearest <= 10 else 4 if nearest is not None and nearest <= radius else 0

        timestamps = []
        for event in events:
            if event.get("started_at"):
                try: timestamps.append(datetime.fromisoformat(str(event["started_at"]).replace("Z", "+00:00")))
                except ValueError: pass
        latest = max(timestamps, default=None)
        age_hours = max(0, (datetime.now(timezone.utc) - latest).total_seconds() / 3600) if latest else None
        recency = 15 if age_hours is not None and age_hours <= 6 else 12 if age_hours is not None and age_hours <= 24 else 8 if age_hours is not None and age_hours <= 72 else 4 if age_hours is not None and age_hours <= 168 else 2 if age_hours is not None else 0

        quality = 15 if observed and warnings else 10 if observed else 6 if warnings else 2 if historical else 0
        source_health = {item.get("source"): item.get("freshness_status") for item in (data_health or {}).get("sources", [])}
        penalties, missing_data = 0, []
        if source_health.get("spc_reports") not in (None, "fresh"):
            penalties += 10; missing_data.append("SPC report ingestion is not fresh.")
        if source_health.get("nws_alerts") not in (None, "fresh"):
            penalties += 5; missing_data.append("NWS alert ingestion is not fresh.")
        pending = ((data_health or {}).get("geography", {}).get("event_processing", {}) or {}).get("pending", 0)
        if pending:
            penalties += 5; missing_data.append("Some recent events still await geographic processing.")

        components = {
            "severity": {"score": severity, "max": 35},
            "evidence_concentration": {"score": concentration, "max": 20},
            "proximity": {"score": proximity, "max": 15, "nearest_observed_miles": nearest},
            "recency": {"score": recency, "max": 15, "latest_evidence_at": latest.isoformat() if latest else None},
            "evidence_quality": {"score": quality, "max": 15},
        }
        score = max(0, min(100, sum(item["score"] for item in components.values()) - penalties))
        support_level = "strong" if score >= 70 else "moderate" if score >= 40 else "limited" if score >= 15 else "insufficient"
        return {
            "location": {"latitude": a["latitude"], "longitude": a["longitude"], "radius_miles": radius},
            "window": self._effective_window(a),
            "score": score, "classification": support_level, "support_level": support_level,
            "methodology": {
                "id": "storm-signal-location-multihazard-v1", "version": 1,
                "score_range": [0, 100], "penalty_points": penalties,
                "nhc_scoring_policy": "NHC forecast evidence is excluded from this score and must be presented separately as forecast context.",
            },
            "components": components, "missing_data": missing_data,
            "hazards": {
                "hail": {"report_count": len(hail), "max_inches": max_hail},
                "wind": {"report_count": len(wind), "max_mph": max_wind},
                "tornado": {"report_count": len(tornado)},
                "warnings": {"severe_thunderstorm_count": len(severe_warnings), "tornado_count": len(tornado_warnings)},
            },
            "evidence": {
                "hail_reports": hail, "wind_reports": wind, "tornado_reports": tornado,
                "warnings": warnings, "historical_hail_events": historical,
            },
            "limitations": self._limitations(),
        }

    @staticmethod
    def _present_coverage(value: dict[str, Any]) -> dict[str, Any]:
        return {**value, "message": IN_COVERAGE_MESSAGE if value.get("status") == "in_coverage" else COVERAGE_MESSAGE}

    @staticmethod
    def _effective_window(a: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        available_start = now - timedelta(days=WINDOW_DAYS)
        requested_start = datetime.fromisoformat(str(a["start_at"]).replace("Z", "+00:00")) if a.get("start_at") else None
        requested_end = datetime.fromisoformat(str(a["end_at"]).replace("Z", "+00:00")) if a.get("end_at") else None
        effective_start = max(requested_start, available_start) if requested_start else available_start
        effective_end = min(requested_end, now) if requested_end else now
        return {
            "requested_start_at": requested_start.isoformat() if requested_start else None,
            "requested_end_at": requested_end.isoformat() if requested_end else None,
            "effective_start_at": effective_start.isoformat(), "effective_end_at": effective_end.isoformat(),
            "available_window_days": WINDOW_DAYS,
            "truncated": bool((requested_start and requested_start < available_start) or (requested_end and requested_end > now)),
            "defaulted": not requested_start or not requested_end,
        }

    @staticmethod
    def _unavailable(coverage: dict[str, Any], window: dict[str, Any] | None) -> dict[str, Any]:
        return {"status": coverage.get("status", "out_of_coverage"), "message": COVERAGE_MESSAGE, "coverage": coverage, "window": window, "events": [], "count": 0, "limitations": StormSignalTools._limitations()}

    @staticmethod
    def _tropical_unavailable(coverage: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": coverage.get("status", "out_of_coverage"), "message": COVERAGE_MESSAGE,
            "coverage": coverage, "cyclones": [], "count": 0,
            "evidence_domain": "nhc_tropical_cyclone",
            "limitations": StormSignalTools._nhc_limitations(),
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
    def _tropical_params(a: dict[str, Any]) -> dict[str, Any]:
        return {
            "p_active_only": a.get("active_only", True), "p_atcf_id": a.get("atcf_id"),
            "p_issued_after": a.get("issued_after"), "p_issued_before": a.get("issued_before"),
            "p_product_types": a.get("product_types"), "p_evidence_classes": a.get("evidence_classes"),
            "p_state": a.get("state"), "p_county": a.get("county"),
            "p_place": a.get("place"), "p_zcta": a.get("zcta"),
            "p_valid_at": a.get("valid_at"), "p_limit": a.get("limit", 50),
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
        if name == "search_tropical_cyclones":
            for key in ("issued_after", "issued_before", "valid_at"):
                if a.get(key): datetime.fromisoformat(str(a[key]).replace("Z", "+00:00"))
            if a.get("issued_after") and a.get("issued_before"):
                after = datetime.fromisoformat(str(a["issued_after"]).replace("Z", "+00:00"))
                before = datetime.fromisoformat(str(a["issued_before"]).replace("Z", "+00:00"))
                if after > before: raise ValueError("issued_after must be before issued_before")
            atcf_id = str(a.get("atcf_id", ""))
            if atcf_id and (len(atcf_id) != 8 or not atcf_id[:2].isalpha() or not atcf_id[2:].isdigit()):
                raise ValueError("atcf_id must use the ATCF format, for example AL012026")
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

    @staticmethod
    def _nhc_limitations() -> list[str]:
        return [
            "NHC forecasts describe future conditions and remain forecasts after their valid time; they are not observations.",
            "The cone describes probable center-track uncertainty, not storm size or an impact footprint.",
            "Wind-radius polygons are maximum extents by threshold and quadrant; wind is not uniform inside them.",
            "A Census intersection indicates geographic overlap only, not property impact, damage, a lead, or a claim.",
        ]
