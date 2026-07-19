from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class SupabaseRest:
    def __init__(self, url: str, service_role_key: str, timeout: int = 60):
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_role_key
        self.timeout = timeout

    def headers(self) -> dict[str, str]:
        headers = {
            "apikey": self.key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "storm-signal-ingestor/0.1",
        }
        # Modern sb_secret keys are opaque API keys and must not be sent as JWTs.
        # Legacy service_role keys remain supported during migration.
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self.key}"
        return headers

    def request(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        headers = self.headers()
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                content = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"Supabase {method} {path} failed ({exc.code}): {detail}") from exc
        return json.loads(content) if content else None

    def start_run(self, source: str) -> str:
        rows = self.request(
            "POST", "/ingestion_runs", {"source": source, "status": "running"}, "return=representation"
        )
        return rows[0]["id"]

    def finish_run(self, run_id: str, status: str, received: int, created: int, updated: int, error: str | None = None) -> None:
        body = {
            "status": status,
            "completed_at": "now()",
            "records_received": received,
            "records_created": created,
            "records_updated": updated,
            "error_message": error,
        }
        # PostgREST treats literal now() as text; use a UTC timestamp from the client instead.
        from datetime import datetime, timezone

        body["completed_at"] = datetime.now(timezone.utc).isoformat()
        self.request("PATCH", f"/ingestion_runs?id=eq.{run_id}", body, "return=minimal")

    def existing_event_ids(self, source: str) -> set[str]:
        encoded = urllib.parse.quote(source, safe="")
        rows = self.request("GET", f"/storm_events?source=eq.{encoded}&select=source_record_id")
        return {row["source_record_id"] for row in rows}

    def upsert_records(self, raw_records: list[dict[str, Any]]) -> dict[tuple[str, str, str], str]:
        if not raw_records:
            return {}
        path = "/source_records?on_conflict=source,source_record_id,payload_hash"
        rows = self.request("POST", path, raw_records, "resolution=merge-duplicates,return=representation")
        return {(row["source"], row["source_record_id"], row["payload_hash"]): row["id"] for row in rows}

    def upsert_events(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        path = "/storm_events?on_conflict=source,source_record_id"
        self.request("POST", path, events, "resolution=merge-duplicates,return=minimal")
