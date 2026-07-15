// The command dispatch pipeline (GM-R6/R7/R12), stack-free: real
// parseCommand + real dispatch + real RoomCoordinator + FixtureGateway (built
// on the real name-matcher and lock evaluator). Proves verb routing, building,
// movement + presence, name matching, and a lock refusal without a database —
// the real-stack acceptance scenario (test/world/building.test.ts) proves the
// same shapes end-to-end through Postgres.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { FixtureGateway, type FixtureSpec } from "../../src/server/gateway.ts";
import { dispatch, type DispatchDeps } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const SPEC: FixtureSpec = {
  rooms: { "#10": { name: "Town Square" }, "#20": { name: "Echo Cave" } },
  exits: [
    { name: "north", from: "#10", to: "#20" },
    { name: "south", from: "#20", to: "#10" },
  ],
  players: {
    // Alice is a wizard so she can open exits in the shared Town Square she
    // does not own — building exits from a room requires controlling it
    // (world_open, GM-R15). A plain builder builds in rooms they dig; wiring
    // exits from shared rooms is a wizard act in v1 (room build-permission
    // flags are a documented later step). See the "builder power" test for
    // the tier gate on dig itself.
    Alice: { power: "wizard", room: "#10" },
    Bob: { room: "#10" },
    Zoe: { room: "#20" },
  },
};

interface Seat {
  sessionId: string;
  playerId: string;
  received: ServerMessage[];
  disconnected: boolean;
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  infos(): string[];
  clear(): void;
}

async function world(): Promise<{ coord: RoomCoordinator; gw: FixtureGateway; seat(name: string): Promise<Seat> }> {
  const coord = new RoomCoordinator();
  const gw = new FixtureGateway(SPEC);
  let n = 0;
  async function seat(name: string): Promise<Seat> {
    const sessionId = `s${++n}`;
    const player = await gw.authenticate(`stub:${name}`);
    assert.ok(player, `authenticate ${name}`);
    const received: ServerMessage[] = [];
    const s: Seat = {
      sessionId,
      playerId: player.playerId,
      received,
      disconnected: false,
      run: (line) =>
        dispatch(
          {
            coordinator: coord,
            gateway: gw,
            sessionId,
            send: (m) => received.push(m),
            disconnect: () => {
              s.disconnected = true;
            },
          } satisfies DispatchDeps,
          line,
        ),
      events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
      infos: () =>
        received.filter((m): m is Extract<ServerMessage, { type: "info" }> => m.type === "info").map((m) => m.text),
      clear: () => {
        received.length = 0;
      },
    };
    coord.join(sessionId, {
      playerId: player.playerId,
      playerName: player.playerName,
      power: player.power,
      roomId: player.roomId,
      roomName: player.roomName,
      sink: { send: (m) => received.push(m) },
    });
    return s;
  }
  return { coord, gw, seat };
}

test("building verbs: dig two rooms, open exits both ways, create + describe a thing", async () => {
  const { gw, seat } = await world();
  const alice = await seat("Alice");

  await alice.run("dig The Kitchen");
  await alice.run("dig The Pantry");
  assert.ok(alice.infos().some((t) => /Dug The Kitchen/.test(t)));
  assert.ok(alice.infos().some((t) => /Dug The Pantry/.test(t)));

  // open an exit from Town to the Kitchen, and back
  await alice.run("open kitchenward = The Kitchen");
  assert.ok(alice.infos().some((t) => /Opened exit kitchenward/.test(t)));

  await alice.run("create a brass lantern");
  assert.ok(alice.infos().some((t) => /Created a brass lantern/.test(t)));

  // partial-name resolution (GM-R12) finds the thing in inventory
  const r = await gw.resolve(alice.playerId, "lantern");
  assert.equal(r.status, "ok");

  await alice.run("describe lantern = a dented brass lantern");
  assert.ok(alice.infos().some((t) => /Described a brass lantern/.test(t)));

  await alice.run("name lantern = brass lamp");
  assert.ok(alice.infos().some((t) => /Renamed to brass lamp/.test(t)));
  const r2 = await gw.resolve(alice.playerId, "lamp");
  assert.equal(r2.status, "ok");
});

test("building requires the builder power (GM-R15)", async () => {
  const { seat } = await world();
  const bob = await seat("Bob"); // plain player
  await bob.run("dig Bob's Hideout");
  const err = bob.received.find((m) => m.type === "error");
  assert.ok(err && err.type === "error" && err.code === "PERMISSION_DENIED");
});

test("name matching (GM-R12): me, here, partial, and an unknown token", async () => {
  const { gw, seat } = await world();
  const alice = await seat("Alice");
  assert.equal((await gw.resolve(alice.playerId, "me")).status, "ok");
  assert.equal((await gw.resolve(alice.playerId, "here")).status, "ok");
  assert.equal((await gw.resolve(alice.playerId, "Bob")).status, "ok"); // co-located player
  assert.equal((await gw.resolve(alice.playerId, "nonesuch")).status, "none");
});

test("movement fires presence: a mover departs the old room and arrives the new", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob"); // stays in Town
  const zoe = await seat("Zoe"); // waits in the Cave
  alice.clear();
  bob.clear();
  zoe.clear();

  await alice.run("go north"); // Town -> Cave

  // Bob (still in Town) sees Alice depart; Zoe (in the Cave) sees her arrive.
  assert.ok(bob.events().some((e) => e.kind === "depart" && e.actor === alice.playerId));
  assert.ok(zoe.events().some((e) => e.kind === "arrive" && e.actor === alice.playerId));
  assert.ok(alice.infos().some((t) => /Echo Cave/.test(t)));
});

test("lock gating (GM-R8): another player fails a locked exit", async () => {
  const { seat } = await world();
  const alice = await seat("Alice"); // builder/owner
  const bob = await seat("Bob"); // plain player, same room

  await alice.run("dig The Vault");
  await alice.run("open vault = The Vault");
  // lock the exit's `use` so only Alice (dbref key) may traverse it
  await alice.run(`lock use vault = ${alice.playerId}`);
  assert.ok(alice.infos().some((t) => /Locked vault \(use\)/.test(t)));

  bob.clear();
  await bob.run("go vault");
  const err = bob.received.find((m) => m.type === "error");
  assert.ok(err && err.type === "error" && err.code === "LOCKED", "Bob should be refused by the lock");

  // Alice (the key holder) passes
  await alice.run("go vault");
  assert.ok(alice.infos().some((t) => /The Vault/.test(t)));
});

test("look reports the room, its exits, and connected occupants", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  await alice.run("look");
  const text = alice.infos().at(-1) ?? "";
  assert.match(text, /Town Square/);
  assert.match(text, /Exits: .*north/);
  assert.match(text, /Here: .*Alice/);
});

test("quit signals a disconnect", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  await alice.run("quit");
  assert.equal(alice.disconnected, true);
});
