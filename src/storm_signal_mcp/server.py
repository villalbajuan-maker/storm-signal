from __future__ import annotations

import json
import os
import uuid
from typing import Any, Awaitable, Callable

from .tools import TOOL_DEFINITIONS, StormSignalTools

PROTOCOL_VERSION = "2025-11-25"
SERVER_INFO = {
    "name": "storm-signal",
    "title": "Storm Signal",
    "version": "0.1.0",
    "description": "Persistent severe-weather intelligence for operational analysis.",
    "websiteUrl": "https://vectoros.co",
    "icons": [{
        "src": "https://mcp.vectoros.co/favicon.png",
        "mimeType": "image/png",
        "sizes": ["500x500"],
    }],
}


class MCPApplication:
    """Small stateless ASGI Streamable HTTP transport with Claude-safe sessions."""
    def __init__(self, tools: StormSignalTools | None = None):
        self._tools = tools
        self.allowed_origins = {x.strip() for x in os.getenv("MCP_ALLOWED_ORIGINS", "").split(",") if x.strip()}

    @property
    def tools(self) -> StormSignalTools:
        if self._tools is None:
            self._tools = StormSignalTools.from_environment()
        return self._tools

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Awaitable[dict]], send: Callable[..., Awaitable[None]]) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup": await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"}); return
            return
        path, method = scope.get("path"), scope.get("method", "GET")
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        if not self._origin_allowed(headers.get("origin")):
            await self._respond(send, 403, {"error": "Origin not allowed"}); return
        if path == "/health" and method == "GET":
            await self._respond(send, 200, {"status": "ok", "server": SERVER_INFO}); return
        if path != "/mcp":
            await self._respond(send, 404, {"error": "Not found"}); return
        if method == "OPTIONS":
            await self._respond(send, 204, None); return
        if method == "GET":
            await self._respond(send, 405, {"error": "SSE stream not supported"}, [(b"allow", b"POST, OPTIONS")]); return
        if method != "POST":
            await self._respond(send, 405, {"error": "Method not allowed"}); return
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"): break
        try:
            request = json.loads(body)
            if not isinstance(request, dict): raise ValueError()
        except (json.JSONDecodeError, ValueError):
            await self._respond(send, 400, self._error(None, -32700, "Parse error")); return
        response, session = self._dispatch(request)
        extra = [(b"mcp-session-id", session.encode())] if session else []
        if response is None:
            await self._respond(send, 202, None, extra); return
        await self._respond(send, 200, response, extra)

    def _dispatch(self, request: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        request_id, method = request.get("id"), request.get("method")
        if request.get("jsonrpc") != "2.0" or not isinstance(method, str):
            return self._error(request_id, -32600, "Invalid Request"), None
        if request_id is None:
            return None, None
        if method == "initialize":
            result = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
                "instructions": "Use persisted weather evidence conservatively. Never infer property impact or damage.",
            }
            return {"jsonrpc": "2.0", "id": request_id, "result": result}, str(uuid.uuid4())
        if method == "ping":
            return {"jsonrpc": "2.0", "id": request_id, "result": {}}, None
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOL_DEFINITIONS}}, None
        if method == "tools/call":
            params = request.get("params") or {}
            try:
                output = self.tools.call(params.get("name", ""), params.get("arguments") or {})
                text = f"Storm Signal completed {params.get('name')} (trace {output['trace_id']})."
                result = {"content": [{"type": "text", "text": text}], "structuredContent": output, "isError": False}
            except Exception as exc:
                trace = str(uuid.uuid4())
                result = {"content": [{"type": "text", "text": f"Tool call failed: {exc}"}], "structuredContent": {"trace_id": trace, "error": str(exc)}, "isError": True}
            return {"jsonrpc": "2.0", "id": request_id, "result": result}, None
        return self._error(request_id, -32601, "Method not found"), None

    def _origin_allowed(self, origin: str | None) -> bool:
        return origin is None or not self.allowed_origins or origin in self.allowed_origins

    @staticmethod
    def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}

    async def _respond(self, send: Callable[..., Awaitable[None]], status: int, body: Any, extra: list[tuple[bytes, bytes]] | None = None) -> None:
        headers = [
            (b"content-type", b"application/json"),
            (b"access-control-allow-origin", b"*"),
            (b"access-control-allow-methods", b"POST, GET, OPTIONS"),
            (b"access-control-allow-headers", b"content-type, accept, mcp-session-id, mcp-protocol-version"),
            (b"access-control-expose-headers", b"mcp-session-id"),
        ] + (extra or [])
        payload = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
        headers.append((b"content-length", str(len(payload)).encode()))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})


app = MCPApplication()


def main() -> None:
    import uvicorn
    uvicorn.run("storm_signal_mcp.server:app", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
