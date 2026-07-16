// GM-R19 ops substrate, stack-free: /healthz honours the eaap contract
// (unauthenticated, cheap, side-effect-free, status + build id, never tenant
// data) and the structured logger emits parseable JSON-lines with the
// privacy line held (identifiers only — no tokens, no typed lines).

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, type ServerHandle } from "../../src/server/server.ts";
import { jsonLineLogger } from "../../src/server/log.ts";
import { fixtureGateway, TestClient } from "./helpers.ts";

test("/healthz returns ok + build id, JSON, no auth", async () => {
  const handle: ServerHandle = await startServer(fixtureGateway(), { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res.json()) as { status: string; build: string };
    assert.equal(body.status, "ok");
    // a bare dev run reports "dev"; a stamped run reports GENMURK_BUILD_ID
    assert.equal(body.build, process.env["GENMURK_BUILD_ID"] ?? "dev");
    assert.deepEqual(Object.keys(body).sort(), ["build", "status"]);
  } finally {
    await handle.close();
  }
});

test("any other HTTP path stays a 404 (WebSocket-only surface)", async () => {
  const handle = await startServer(fixtureGateway(), { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/anything`);
    assert.equal(res.status, 404);
  } finally {
    await handle.close();
  }
});

test("structured log: JSON-lines, identifiers only, no secret material", async () => {
  const lines: string[] = [];
  const handle = await startServer(fixtureGateway(), {
    port: 0,
    log: jsonLineLogger((line) => lines.push(line)),
  });
  try {
    const alice = await TestClient.connect(handle.port, "Alice");
    alice.command("say the log must never see this line");
    await alice.waitFor((m) => m.type === "event");
    alice.close();
    // the socket close lands asynchronously — wait for its log line, bounded
    const deadline = Date.now() + 5000;
    while (!lines.some((l) => l.includes('"session.close"'))) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const e of events) {
      assert.equal(typeof e["ts"], "string");
      assert.equal(typeof e["event"], "string");
    }
    assert.ok(events.some((e) => e["event"] === "session.join"));
    assert.ok(events.some((e) => e["event"] === "session.close"));
    // the privacy line: typed command content and tokens never reach the log
    const flat = lines.join("");
    assert.ok(!flat.includes("must never see"));
    assert.ok(!flat.includes("fixture-principal"));
  } finally {
    await handle.close();
  }
});
