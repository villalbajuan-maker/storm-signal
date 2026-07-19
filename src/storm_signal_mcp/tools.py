from __future__ import annotations

import os
import uuid
import csv
import hashlib
import io
import json
from math import atan2, cos, pi, sin, sqrt
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
    {
        "name": "rank_markets",
        "description": "Compare 2 to 5 explicitly located candidate markets using multihazard evidence, operating-base proximity, geographic readiness, and missing-input penalties. Outputs are investigation priorities, never leads.",
        "inputSchema": _schema({
            "markets": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
                "type": "object", "additionalProperties": False,
                "required": ["name", "latitude", "longitude"],
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 120},
                    "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                    "longitude": {"type": "number", "minimum": -180, "maximum": 180},
                },
            }},
            "start_at": {"type": "string", "format": "date-time"},
            "end_at": {"type": "string", "format": "date-time"},
            "radius_miles": {"type": "number", "exclusiveMinimum": 0, "maximum": 100, "default": 10},
            "operating_base": {"type": "object", "additionalProperties": False,
                "required": ["latitude", "longitude"], "properties": {
                    "name": {"type": "string", "maxLength": 120},
                    "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                    "longitude": {"type": "number", "minimum": -180, "maximum": 180},
                }},
        }, ["markets", "start_at", "end_at"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "build_field_plan",
        "description": "Build a deterministic field-investigation plan for 2 to 5 covered markets, using the frozen market ranking, crew capacity, and an explicit working window. This preview is not route optimization or a persisted workspace artifact.",
        "inputSchema": _schema({
            "objective": {"type": "string", "minLength": 1, "maxLength": 500},
            "markets": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
                "type": "object", "additionalProperties": False,
                "required": ["name", "latitude", "longitude"],
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 120},
                    "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                    "longitude": {"type": "number", "minimum": -180, "maximum": 180},
                },
            }},
            "teams": {"type": "array", "minItems": 1, "maxItems": 10, "items": {
                "type": "object", "additionalProperties": False, "required": ["name"],
                "properties": {"name": {"type": "string", "minLength": 1, "maxLength": 120}, "members": {"type": "array", "items": {"type": "string"}}},
            }},
            "evidence_start_at": {"type": "string", "format": "date-time"},
            "evidence_end_at": {"type": "string", "format": "date-time"},
            "work_start_at": {"type": "string", "format": "date-time"},
            "work_end_at": {"type": "string", "format": "date-time"},
            "minutes_per_market": {"type": "integer", "minimum": 30, "maximum": 240, "default": 90},
            "radius_miles": {"type": "number", "exclusiveMinimum": 0, "maximum": 100, "default": 10},
            "operating_base": {"type": "object", "additionalProperties": False, "required": ["latitude", "longitude"], "properties": {
                "name": {"type": "string", "maxLength": 120},
                "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                "longitude": {"type": "number", "minimum": -180, "maximum": 180},
            }},
        }, ["objective", "markets", "teams", "evidence_start_at", "evidence_end_at", "work_start_at", "work_end_at"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "prepare_field_brief",
        "description": "Prepare an auditable field brief preview from a Storm Signal field plan, with structured content, Markdown, and priority-area CSV. Public MCP previews are not persisted; PDF and revocable sharing require the authenticated artifact layer.",
        "inputSchema": _schema({
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "field_plan": {"type": "object"},
            "timezone": {"type": "string", "default": "UTC"},
        }, ["title", "field_plan"]),
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
        elif name == "rank_markets":
            result = self._rank_markets(arguments, data_health, coverage)
        elif name == "build_field_plan":
            result = self._build_field_plan(arguments, data_health, coverage)
        elif name == "prepare_field_brief":
            result = self._prepare_field_brief(arguments, data_health, coverage)
        else:
            raise ValueError(f"Unknown tool: {name}")
        return {
            "trace_id": trace_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_health": data_health,
            **result,
        }

    def _build_field_plan(self, a: dict[str, Any], data_health: dict[str, Any], coverage: dict[str, Any]) -> dict[str, Any]:
        ranking = self.call("rank_markets", {
            "markets": a["markets"], "operating_base": a.get("operating_base"),
            "start_at": a["evidence_start_at"], "end_at": a["evidence_end_at"],
            "radius_miles": a.get("radius_miles", 10),
        })
        selected = [market for market in ranking.get("markets", []) if market.get("eligible") and market.get("decision") != "insufficient_evidence"]
        teams, minutes = a["teams"], int(a.get("minutes_per_market", 90))
        work_start = datetime.fromisoformat(str(a["work_start_at"]).replace("Z", "+00:00"))
        work_end = datetime.fromisoformat(str(a["work_end_at"]).replace("Z", "+00:00"))
        team_slots = {team["name"]: 0 for team in teams}
        assignments = []
        for index, market in enumerate(selected):
            team = teams[index % len(teams)]
            slot = team_slots[team["name"]]
            team_slots[team["name"]] += 1
            starts_at = work_start + timedelta(minutes=slot * minutes)
            ends_at = starts_at + timedelta(minutes=minutes)
            scheduled = ends_at <= work_end
            assignments.append({
                "sequence": index + 1, "market": market["name"], "rank": market["rank"],
                "decision": market["decision"], "priority_score": market["final_score"],
                "support_level": market.get("support_level"), "team": team["name"],
                "team_members": team.get("members"), "scheduled": scheduled,
                "starts_at": starts_at.isoformat() if scheduled else None,
                "ends_at": ends_at.isoformat() if scheduled else None,
                "location": market["location"], "rationale": market["rationale"],
                "hazards": market.get("hazards"),
                "verification_questions": [
                    "What weather evidence can the crew verify safely from public access?",
                    "Do field conditions support or contradict the reported location, timing, and hazard type?",
                    "Are access, permission, safety, and local restrictions clear before any property-level activity?",
                ],
            })
        unscheduled = sum(not item["scheduled"] for item in assignments)
        evidence_times = [market.get("evidence_components", {}).get("recency", {}).get("latest_evidence_at") for market in selected]
        latest_evidence = max((value for value in evidence_times if value), default=None)
        return {
            "status": "insufficient_evidence" if not selected else "partial" if unscheduled else "ready",
            "coverage": coverage,
            "methodology": {"id": "storm-signal-field-plan-v1", "version": 1, "ranking_methodology": "storm-signal-market-ranking-v1", "sequence_policy": "Eligible markets are ordered by market rank and assigned round-robin to teams; this is not route optimization."},
            "objective": a["objective"],
            "evidence_window": {"start_at": a["evidence_start_at"], "end_at": a["evidence_end_at"], "latest_evidence_at": latest_evidence},
            "working_window": {"start_at": a["work_start_at"], "end_at": a["work_end_at"], "minutes_per_market": minutes},
            "operating_base": a.get("operating_base"), "ranking_snapshot": ranking.get("markets", []), "assignments": assignments,
            "capacity": {"selected_markets": len(selected), "scheduled_markets": len(assignments) - unscheduled, "unscheduled_markets": unscheduled, "teams": len(teams)},
            "field_signals": {
                "continue": ["Evidence remains consistent with the selected market and field conditions are safe and authorized."],
                "change": ["New official evidence materially changes the market order or field observations contradict the current rationale."],
                "stop": ["Conditions are unsafe, required access or permission is absent, or the evidence does not support continued investigation."],
            },
            "crew_checklist": [
                "Review the evidence time, source class, and market rationale before departure.",
                "Confirm weather, road, access, daylight, and crew-safety conditions.",
                "Record observations without treating them as confirmation of property damage.",
                "Escalate contradictory or corrected evidence before changing the plan.",
            ],
            "missing_data": (["Operating base was not supplied; sequence is priority-based only."] if not a.get("operating_base") else []) + ([f"{unscheduled} selected market(s) exceed the supplied working window."] if unscheduled else []),
            "limitations": [*self._limitations(), "The sequence is priority-based and round-robin; it is not road routing, travel-time estimation, or workforce tracking.", "The plan organizes field verification and does not authorize access or confirm available work."],
        }

    def _prepare_field_brief(self, a: dict[str, Any], data_health: dict[str, Any], coverage: dict[str, Any]) -> dict[str, Any]:
        plan, title, tz = a["field_plan"], str(a["title"]), str(a.get("timezone", "UTC"))
        assignments = plan["assignments"]
        primary = next((item for item in assignments if item.get("scheduled")), assignments[0] if assignments else None)
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["sequence", "market", "rank", "decision", "priority_score", "support_level", "team", "starts_at", "ends_at", "latitude", "longitude"])
        for item in assignments:
            writer.writerow([item.get("sequence"), item.get("market"), item.get("rank"), item.get("decision"), item.get("priority_score"), item.get("support_level"), item.get("team"), item.get("starts_at"), item.get("ends_at"), item.get("location", {}).get("latitude"), item.get("location", {}).get("longitude")])
        generated_at = datetime.now(timezone.utc).isoformat()
        markdown = "\n".join([
            f"# {title}", "", f"Generated: {generated_at} ({tz})", "", f"Objective: {plan['objective']}", "",
            f"Primary decision: {primary['market']} — {primary['decision']}" if primary else "Primary decision: Insufficient evidence for a field assignment", "", "## Field priorities", "",
            *[f"{item['sequence']}. {item['market']} — {item['decision']}; team {item['team']}; " + (f"{item['starts_at']} to {item['ends_at']}." if item.get('scheduled') else "not scheduled within the working window.") for item in assignments],
            "", "## Verify in the field", "", *[f"- {item}" for item in plan.get("crew_checklist", [])],
            "", "## Decision-change factors", "", *[f"- {key}: {value}" for key, values in plan.get("field_signals", {}).items() for value in values],
            "", "## Limitations", "", *[f"- {item}" for item in plan.get("limitations", [])],
        ])
        preview = {
            "artifact_type": "field_brief", "title": title, "generated_at": generated_at, "timezone": tz,
            "source_plan_trace_id": plan.get("trace_id"),
            "methodology": {"id": "storm-signal-field-brief-v1", "version": 1, "field_plan_methodology": plan["methodology"]["id"]},
            "principal_decision": ({"market": primary["market"], "decision": primary["decision"], "priority_score": primary.get("priority_score"), "support_level": primary.get("support_level")} if primary else None),
            "objective": plan["objective"], "operating_base": plan.get("operating_base"), "evidence_window": plan.get("evidence_window"), "working_window": plan.get("working_window"),
            "assignments": assignments, "field_signals": plan.get("field_signals"), "crew_checklist": plan.get("crew_checklist"),
            "sources": {"data_health_checked_at": plan.get("data_health", {}).get("checked_at"), "methodologies": [plan["methodology"]["id"], "storm-signal-market-ranking-v1", "storm-signal-location-multihazard-v1"]},
            "limitations": plan.get("limitations", self._limitations()),
        }
        preview["content_hash"] = hashlib.sha256(json.dumps(preview, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return {
            "status": "preview_ready", "coverage": coverage, "artifact": preview,
            "exports": {"markdown": {"media_type": "text/markdown", "content": markdown}, "priority_areas_csv": {"media_type": "text/csv", "content": stream.getvalue()}, "pdf": {"status": "not_available", "reason": "PDF rendering requires the authenticated persistent artifact service."}},
            "persistence": {"status": "not_persisted", "reason": "Public MCP has no authenticated workspace or tenant context."},
            "sharing": {"status": "not_available", "reason": "Revocable sharing requires persisted tenant-scoped artifacts."},
            "limitations": ["This is a deterministic preview, not a saved workspace artifact.", "The brief supports field investigation and does not confirm property damage, available work, leads, or revenue."],
        }

    def _rank_markets(self, a: dict[str, Any], data_health: dict[str, Any], coverage: dict[str, Any]) -> dict[str, Any]:
        base = a.get("operating_base")
        evaluated = []
        for market in a["markets"]:
            assessment = self.call("assess_location", {
                "latitude": market["latitude"], "longitude": market["longitude"],
                "start_at": a["start_at"], "end_at": a["end_at"],
                "radius_miles": a.get("radius_miles", 10),
            })
            if assessment["status"] != "in_coverage":
                evaluated.append({
                    "name": market["name"],
                    "location": {"latitude": market["latitude"], "longitude": market["longitude"]},
                    "eligible": False, "decision": "insufficient_evidence",
                    "final_score": None, "rank": None, "coverage": assessment.get("coverage"),
                    "message": COVERAGE_MESSAGE,
                })
                continue
            base_distance = self._distance_miles(
                float(base["latitude"]), float(base["longitude"]),
                float(market["latitude"]), float(market["longitude"]),
            ) if base else None
            evidence_points = round(float(assessment["score"]) * .7)
            proximity_points = self._operating_proximity(base_distance)
            readiness_points = 10 if (data_health or {}).get("geography", {}).get("queue_status") == "healthy" else 5
            missing_penalty = 0 if base else 5
            final_score = max(0, min(100, evidence_points + proximity_points + readiness_points - missing_penalty))
            decision = "insufficient_evidence" if assessment["support_level"] == "insufficient" else "prioritize" if final_score >= 65 else "monitor" if final_score >= 30 else "insufficient_evidence"
            evaluated.append({
                "name": market["name"],
                "location": {"latitude": market["latitude"], "longitude": market["longitude"], "radius_miles": a.get("radius_miles", 10)},
                "eligible": True, "decision": decision, "final_score": final_score, "rank": None,
                "support_level": assessment["support_level"],
                "components": {
                    "multihazard_evidence": {"score": evidence_points, "max": 70, "source_score": assessment["score"]},
                    "operating_proximity": {"score": proximity_points, "max": 20, "straight_line_miles": round(base_distance, 1) if base_distance is not None else None},
                    "geographic_readiness": {"score": readiness_points, "max": 10},
                    "missing_input_penalty": {"score": -missing_penalty, "operating_base_missing": base is None},
                },
                "evidence_components": assessment["components"], "hazards": assessment["hazards"],
                "missing_data": [*assessment.get("missing_data", []), *(["Operating base was not supplied; operational proximity could not be scored."] if not base else [])],
                "rationale": "Strongest combined support for investigation under the supplied evidence and operating constraints." if decision == "prioritize" else "Some investigation support exists, but the evidence or operating fit is not strong enough to prioritize." if decision == "monitor" else "Current persisted evidence is insufficient for market prioritization.",
            })
        ranked = sorted((item for item in evaluated if item["eligible"]), key=lambda item: (-item["final_score"], item["name"]))
        for index, item in enumerate(ranked, 1): item["rank"] = index
        output = sorted(evaluated, key=lambda item: (item["rank"] if item["rank"] is not None else 999, item["name"]))
        return {
            "status": "in_coverage" if len(ranked) == len(a["markets"]) else "partial" if ranked else "insufficient_evidence",
            "coverage": coverage,
            "methodology": {
                "id": "storm-signal-market-ranking-v1", "version": 1,
                "component_maxima": {"multihazard_evidence": 70, "operating_proximity": 20, "geographic_readiness": 10},
                "decision_thresholds": {"prioritize": 65, "monitor": 30, "insufficient_evidence": 0},
                "distance_interpretation": "Operating proximity uses straight-line distance, not road distance or travel time.",
            },
            "operating_base": base, "markets": output, "count": len(output),
            "limitations": [
                *self._limitations(),
                "Rankings are relative investigation priorities, not leads, confirmed opportunities, route plans, or proof of damage.",
                "NHC forecast evidence is not included in market-ranking points.",
            ],
        }

    @staticmethod
    def _distance_miles(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
        radians = lambda value: value * pi / 180
        d_lat, d_lon = radians(b_lat - a_lat), radians(b_lon - a_lon)
        h = sin(d_lat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(d_lon / 2) ** 2
        return 3958.7613 * 2 * atan2(sqrt(h), sqrt(1 - h))

    @staticmethod
    def _operating_proximity(distance: float | None) -> int:
        if distance is None: return 0
        if distance <= 50: return 20
        if distance <= 100: return 16
        if distance <= 200: return 12
        if distance <= 300: return 8
        if distance <= 500: return 4
        return 0

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
        if name in ("assess_location", "summarize_storm_activity", "rank_markets"):
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
        if name == "rank_markets":
            markets = a.get("markets")
            if not isinstance(markets, list) or not 2 <= len(markets) <= 5:
                raise ValueError("markets must contain between 2 and 5 candidates")
            for market in markets:
                if not isinstance(market, dict) or not str(market.get("name", "")).strip():
                    raise ValueError("every market requires a name")
                if not (-90 <= float(market.get("latitude", 999)) <= 90 and -180 <= float(market.get("longitude", 999)) <= 180):
                    raise ValueError("every market requires valid latitude and longitude")
            base = a.get("operating_base")
            if base and not (-90 <= float(base.get("latitude", 999)) <= 90 and -180 <= float(base.get("longitude", 999)) <= 180):
                raise ValueError("operating_base requires valid latitude and longitude")
        if name == "build_field_plan":
            if not str(a.get("objective", "")).strip():
                raise ValueError("objective is required")
            for key in ("evidence_start_at", "evidence_end_at", "work_start_at", "work_end_at"):
                if key not in a: raise ValueError(f"{key} is required")
                datetime.fromisoformat(str(a[key]).replace("Z", "+00:00"))
            if a["evidence_start_at"] > a["evidence_end_at"]: raise ValueError("evidence_start_at must be before evidence_end_at")
            if a["work_start_at"] >= a["work_end_at"]: raise ValueError("work_start_at must be before work_end_at")
            markets, teams = a.get("markets"), a.get("teams")
            if not isinstance(markets, list) or not 2 <= len(markets) <= 5: raise ValueError("markets must contain between 2 and 5 candidates")
            if not isinstance(teams, list) or not 1 <= len(teams) <= 10: raise ValueError("teams must contain between 1 and 10 teams")
            if len({str(team.get("name", "")).strip() for team in teams}) != len(teams) or any(not str(team.get("name", "")).strip() for team in teams):
                raise ValueError("every team requires a unique name")
            for market in markets:
                if not str(market.get("name", "")).strip() or not (-90 <= float(market.get("latitude", 999)) <= 90 and -180 <= float(market.get("longitude", 999)) <= 180):
                    raise ValueError("every market requires a name and valid coordinates")
            minutes = int(a.get("minutes_per_market", 90))
            if not 30 <= minutes <= 240: raise ValueError("minutes_per_market must be between 30 and 240")
            base = a.get("operating_base")
            if base and not (-90 <= float(base.get("latitude", 999)) <= 90 and -180 <= float(base.get("longitude", 999)) <= 180):
                raise ValueError("operating_base requires valid latitude and longitude")
        if name == "prepare_field_brief":
            plan = a.get("field_plan")
            if not str(a.get("title", "")).strip(): raise ValueError("title is required")
            if not isinstance(plan, dict) or plan.get("methodology", {}).get("id") != "storm-signal-field-plan-v1" or not isinstance(plan.get("assignments"), list):
                raise ValueError("field_plan must be a valid Storm Signal field plan")
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
