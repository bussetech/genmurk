// THE WIRE BYTES (GM-R13 acceptance): a real WebSocket server (localhost,
// port 0), real client sockets, and assertions on the RAW FRAME STRINGS —
// not on any rendered view. Legitimate styling arrives as inert markup
// tokens; a raw escape byte — typed in a line, or emitted by softcode from
// attribute data — never survives the outbound boundary.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type ServerHandle } from "../../src/server/server.ts";
import { FixtureGateway } from "../../src/server/gateway.ts";

const ESC = "\u001b";
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/;

let handle: ServerHandle;

before(async () => {
  handle = await startServer(
    new FixtureGateway({
      rooms: { "#10": { name: "Town Square" } },
      exits: [],
      players: { Alice: { room: "#10" }, Bob: { room: "#10" } },
      things: [
        {
          name: "mood lamp",
          owner: "Alice",
          room: "#10",
          attrs: {
            GLOW: '$glow:out.emit(out.style("a warm glow", "color:yellow"))',
            // hostile: attribute data carrying a raw escape byte
            FLARE: `$flare:out.emit("${ESC}[2Jflare")`,
          },
        },
      ],
    }),
    { port: 0 },
  );
});

after(async () => {
  await handle.close();
});

interface Wire {
  frames: string[];
  send(line: string): void;
  until(pred: (raw: string) => boolean): Promise<string>;
  close(): void;
}

async function connect(token: string): Promise<Wire> {
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`);
  const frames: string[] = [];
  const waiters: { pred: (raw: string) => boolean; resolve: (raw: string) => void }[] = [];
  ws.addEventListener("message", (ev) => {
    const raw = String(ev.data);
    frames.push(raw);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(raw)) {
        waiters[i]!.resolve(raw);
        waiters.splice(i, 1);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("connect failed")));
  });
  const wire: Wire = {
    frames,
    send: (line) => ws.send(JSON.stringify({ type: "command", line })),
    until: (pred) =>
      new Promise((resolve, reject) => {
        const hit = frames.find(pred);
        if (hit) return resolve(hit);
        const t = setTimeout(() => reject(new Error("frame never arrived")), 4000);
        waiters.push({
          pred,
          resolve: (raw) => {
            clearTimeout(t);
            resolve(raw);
          },
        });
      }),
    close: () => ws.close(),
  };
  ws.send(JSON.stringify({ type: "hello", token }));
  await wire.until((raw) => raw.includes('"welcome"'));
  return wire;
}

test("legitimate styling crosses the wire as markup tokens — zero escape bytes in the raw frame", async () => {
  const alice = await connect("stub:Alice");
  const bob = await connect("stub:Bob");
  try {
    bob.send("glow");
    const raw = await alice.until((r) => r.includes("warm glow"));
    assert.ok(raw.includes("[[color:yellow]]a warm glow[[/]]"), "tokens intact");
    assert.ok(!CONTROL.test(raw), "no control byte in the raw frame");
  } finally {
    alice.close();
    bob.close();
  }
});

test("a raw escape byte in softcode-emitted attribute data is stripped at the boundary", async () => {
  const alice = await connect("stub:Alice");
  const bob = await connect("stub:Bob");
  try {
    bob.send("flare");
    const raw = await alice.until((r) => r.includes("flare") && r.includes('"emit"'));
    assert.ok(raw.includes("[2Jflare"), "the payload arrived as harmless text");
    assert.ok(!CONTROL.test(raw), "the ESC byte did not survive");
  } finally {
    alice.close();
    bob.close();
  }
});

test("a raw escape byte in a TYPED line is stripped before it reaches any other client", async () => {
  const alice = await connect("stub:Alice");
  const bob = await connect("stub:Bob");
  try {
    bob.send(`say watch this ${ESC}[31m trick`);
    const raw = await alice.until((r) => r.includes("watch this"));
    assert.ok(!CONTROL.test(raw), "typed control bytes never fan out");
  } finally {
    alice.close();
    bob.close();
  }
});
