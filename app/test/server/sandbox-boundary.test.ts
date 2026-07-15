// SANDBOX BOUNDARY (GM-R14, acceptance criterion 4): softcode cannot reach
// the transport except through world-API-mediated speech acts. Four walls,
// each asserted:
//   1. module-graph independence — no engine source imports server code;
//   2. the capability handle the engine receives has no transport-shaped
//      surface (escape is ABSENT, not denied);
//   3. a hostile program that reaches for transport-ish functions gets an
//      UNKNOWN_FUNCTION refusal, spending only its own fuel;
//   4. the one sanctioned door — WorldAPI.emit → buffered PendingEmit →
//      SERVER-routed routeEmits — lands room-scoped in the room's ordering
//      domain, and nowhere else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../../src/engine/engine.ts";
import { createWorldModel } from "../../src/world/world-api.ts";
import { buildSnapshot } from "../world/build.ts";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { routeEmits } from "../../src/server/server.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";
import { BUDGET } from "../unit/helpers.ts";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("wall 1: no engine module imports server code — the transport is unreachable in the module graph", () => {
  const engineDir = join(APP_ROOT, "src", "engine");
  for (const file of readdirSync(engineDir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(engineDir, file), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*\/server\//,
      `src/engine/${file} must not import from src/server/`,
    );
    assert.doesNotMatch(
      source,
      /\bimport\s+["'][^"']*\/server\//,
      `src/engine/${file} must not side-effect-import src/server/`,
    );
  }
});

test("wall 2: the WorldAPI handle has exactly the world surface — nothing transport-shaped", () => {
  const world = createWorldModel(
    buildSnapshot({
      "#10": { type: "room", name: "Town" },
      "#1": { type: "player", name: "Alice", location: "#10", power: "builder" },
    }),
  );
  // the six WorldAPI methods the engine seam declares (src/engine/types.ts),
  // plus the world-model hooks the SERVER uses after a run — none of which
  // are sockets, channels, or send primitives
  const transportShaped = [
    "send", "broadcast", "connect", "socket", "channel", "subscribe",
    "publish", "page", "announce", "fetch", "open",
  ];
  const surface = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(world);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) surface.add(k);
    proto = Object.getPrototypeOf(proto);
  }
  for (const name of transportShaped) {
    assert.ok(!surface.has(name), `WorldAPI surface must not expose "${name}"`);
  }
});

test("wall 3: hostile programs reaching for a transport get UNKNOWN_FUNCTION, not a connection", () => {
  const engine = createEngine();
  const world = createWorldModel(
    buildSnapshot({
      "#10": { type: "room", name: "Town" },
      "#1": { type: "player", name: "Alice", location: "#10", power: "builder" },
    }),
  );
  for (const program of [
    'net.connect("ws://127.0.0.1:8787")',
    'transport.send("#10", "smuggled")',
    'room.broadcast("smuggled")',
    'ws.open("ws://evil.example")',
    'coordinator.announce("smuggled")',
  ]) {
    const outcome = engine.run({ actor: "#1", program, budget: BUDGET }, world);
    assert.equal(outcome.status, "refused", program);
    assert.equal(outcome.refusalCode, "UNKNOWN_FUNCTION", program);
  }
  // and nothing was buffered for the transport
  assert.equal(world.emits.length, 0);
});

test("wall 4: the sanctioned door — out.emit lands room-scoped via the server, nowhere else", () => {
  const engine = createEngine();
  const world = createWorldModel(
    buildSnapshot({
      "#10": { type: "room", name: "Town" },
      "#20": { type: "room", name: "Cave" },
      "#1": { type: "player", name: "Alice", location: "#10", power: "builder" },
      "#2": { type: "player", name: "Zoe", location: "#20" },
    }),
  );

  const outcome = engine.run(
    { actor: "#1", program: 'out.emit("the lantern flickers")', budget: BUDGET },
    world,
  );
  assert.equal(outcome.status, "completed");
  assert.equal(world.emits.length, 1);
  assert.equal(world.emits[0]!.roomId, "#10", "the emit is bound to the actor's room");

  // the server routes the buffered emit; sinks record what each session gets
  const coordinator = new RoomCoordinator();
  const townInbox: ServerMessage[] = [];
  const caveInbox: ServerMessage[] = [];
  coordinator.join("town-session", {
    playerId: "#3",
    playerName: "Bob",
    power: "player",
    roomId: "#10",
    roomName: "Town",
    sink: { send: (m) => townInbox.push(m) },
  });
  coordinator.join("cave-session", {
    playerId: "#2",
    playerName: "Zoe",
    power: "player",
    roomId: "#20",
    roomName: "Cave",
    sink: { send: (m) => caveInbox.push(m) },
  });
  const townBefore = townInbox.length;
  const caveBefore = caveInbox.length;

  routeEmits(coordinator, world.emits, () => "Alice");

  const townEmits = townInbox.slice(townBefore).filter((m) => m.type === "event");
  assert.equal(townEmits.length, 1);
  assert.equal(townEmits[0]!.type, "event");
  if (townEmits[0]!.type === "event") {
    assert.equal(townEmits[0]!.kind, "emit");
    assert.equal(townEmits[0]!.text, "the lantern flickers");
    assert.ok(townEmits[0]!.roomSeq >= 1, "softcode output enters the room's ordering domain");
  }
  // the other room: ZERO
  assert.equal(caveInbox.slice(caveBefore).filter((m) => m.type === "event").length, 0);
});
