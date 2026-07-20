import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Storm Signal offer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Storm Signal/);
  assert.match(html, /Know which market is worth the/);
  assert.match(html, /free for 7 days/i);
  assert.match(html, /See a real example/);
  assert.match(html, /Know where to start/);
  assert.match(html, /Know what to check/);
  assert.match(html, /Keep everyone on the same page/);
  assert.match(html, /None yet/);
});

test("keeps conversion and workspace routes connected", async () => {
  const [page, layout, start, workspace, workspaceClient, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/start/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace/WorkspaceClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /href="\/start"/);
  assert.match(start, /fetch\("\/api\/auth\/start"/);
  assert.match(start, /window\.location\.href = "\/verify"/);
  assert.match(workspace, /WorkspaceClient/);
  assert.match(workspaceClient, /ReactMarkdown/);
  assert.match(route, /previousResponseId/);
  assert.match(route, /type:"mcp"/);
  assert.match(route, /require_approval:"never"/);
  assert.match(layout, /Storm Signal/);
});
