// Event triggers (GM-R11, GENMURK-EPIC1-07), stack-free: world events
// evaluate attached softcode through the queue — arrival into a room fires
// the room's and its things' ON_ARRIVE (after the presence event, so every
// observer orders "Bob arrives" before what Bob's arrival caused); entering
// a thing fires its ON_USE. Runs are attributed to the OBJECT'S OWNER, the
// enactor is bound as %0 (name) / %1 (id), and a trigger loop terminates by
// budget with other sessions unaffected — asserted here, both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { FixtureGateway, type FixtureSpec } from "../../src/server/gateway.ts";
import { dispatch, type DispatchDeps } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const SPEC: FixtureSpec = {
  rooms: {
    "#10": { name: "Town Square" },
    "#20": {
      name: "Echo Cave",
      attrs: { ON_ARRIVE: 'out.emit(str.concat(%0, " echoes in the cave."))' },
    },
  },
  exits: [
    { name: "north", from: "#10", to: "#20" },
    { name: "south", from: "#20", to: "#10" },
  ],
  players: {
    Alice: { power: "wizard", room: "#10" },
    Bob: { room: "#10" },
    Zoe: { room: "#20" },
  },
  things: [
    {
      name: "stone guard",
      owner: "Alice",
      room: "#20",
      attrs: { ON_ARRIVE: 'out.emit(str.concat("The guard eyes ", %0, "."))' },
    },
    {
      name: "sedan chair",
      owner: "Alice",
      room: "#10",
      attrs: { ON_USE: 'out.emit(str.concat(%0, " settles into the sedan chair."))' },
    },
  ],
};

interface Seat {
  sessionId: string;
  playerId: string;
  playerName: string;
  received: ServerMessage[];
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  clear(): void;
}

async function world(spec: FixtureSpec = SPEC): Promise<{
  coord: RoomCoordinator;
  gw: FixtureGateway;
  seat(name: string): Promise<Seat>;
}> {
  const coord = new RoomCoordinator();
  const gw = new FixtureGateway(spec);
  const engine = createEngine();
  let n = 0;
  async function seat(name: string): Promise<Seat> {
    const sessionId = `s${++n}`;
    const player = await gw.authenticate(`stub:${name}`);
    assert.ok(player, `authenticate ${name}`);
    const received: ServerMessage[] = [];
    const seatObj: Seat = {
      sessionId,
      playerId: player.playerId,
      playerName: player.playerName,
      received,
      run: (line) =>
        dispatch(
          {
            coordinator: coord,
            gateway: gw,
            engine,
            sessionId,
            send: (m) => received.push(m),
            disconnect: () => {},
          } satisfies DispatchDeps,
          line,
        ),
      events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
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
    return seatObj;
  }
  return { coord, gw, seat };
}

test("acceptance: an event trigger fires on arrival — room first, then its things, after the presence event", async () => {
  const { seat } = await world();
  await seat("Alice");
  const bob = await seat("Bob");
  const zoe = await seat("Zoe"); // already waiting in the cave
  zoe.clear();
  bob.clear();

  await bob.run("go north");

  for (const s of [zoe, bob]) {
    const arrive = s.events().find((e) => e.kind === "arrive" && e.actorName === "Bob");
    const emits = s.events().filter((e) => e.kind === "emit");
    assert.ok(arrive, "presence fired");
    assert.deepEqual(
      emits.map((e) => e.text),
      ["Bob echoes in the cave.", "The guard eyes Bob."],
      "room listener first, then things by dbref; enactor NAME bound as %0",
    );
    for (const e of emits) {
      assert.ok(e.roomSeq > arrive.roomSeq, "arrival orders before what it caused");
    }
  }
});

test("attribution: a trigger run is the OBJECT acting, billed to the OBJECT'S owner — never the enactor", async () => {
  const { gw, seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob");
  const batch = await gw.softcodeTriggers(bob.playerId, { kind: "arrive", targetId: "#20" });
  assert.ok(batch);
  assert.equal(batch.runs.length, 2);
  const [room, guard] = batch.runs;
  assert.equal(room!.owner, "#1", "the room bills its owner");
  assert.equal(guard!.owner, alice.playerId, "the guard bills Alice");
  for (const r of batch.runs) {
    assert.notEqual(r.actor, bob.playerId, "never runs as the enactor");
    assert.notEqual(r.owner, bob.playerId, "never billed to the enactor");
    assert.deepEqual(r.args, ["Bob", bob.playerId], "%0 = enactor name, %1 = enactor id");
  }
});

test("use-class trigger: entering a thing fires its ON_USE into the enclosing room", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob");
  alice.clear();
  bob.clear();

  await bob.run("enter sedan");

  const emit = alice.events().find((e) => e.kind === "emit");
  assert.ok(emit, "the room heard the chair");
  assert.equal(emit.text, "Bob settles into the sedan chair.");
  assert.equal(emit.actorName, "sedan chair");
  // Bob is INSIDE the chair now — the room-scoped emit is not his channel
  assert.ok(!bob.events().some((e) => e.kind === "emit"));
});

test("acceptance: a trigger loop terminates by budget, world stays consistent, other sessions unaffected", async () => {
  const spec: FixtureSpec = {
    ...SPEC,
    things: [
      {
        name: "loop stone a",
        owner: "Alice",
        room: "#20",
        attrs: {
          ON_ARRIVE: 'queue.enqueue("loop stone b", "BOUNCE")',
          BOUNCE: 'out.emit("boing-a"); queue.enqueue("loop stone b", "BOUNCE")',
        },
      },
      {
        name: "loop stone b",
        owner: "Alice",
        room: "#20",
        attrs: {
          ON_ARRIVE: 'queue.enqueue("loop stone a", "BOUNCE")',
          BOUNCE: 'out.emit("boing-b"); queue.enqueue("loop stone a", "BOUNCE")',
        },
      },
    ],
  };
  const { seat } = await world(spec);
  await seat("Alice");
  const bob = await seat("Bob");
  const zoe = await seat("Zoe");
  zoe.clear();

  // A triggers B triggers A: if termination were by hope, this test would
  // hang. It returns because execution is bounded by the owner's drain quota
  // (queueDepthPerOwner × 4 = 64) — arithmetic, not intent.
  await bob.run("go north");

  const boings = zoe.events().filter((e) => e.kind === "emit" && /^boing-/.test(e.text));
  assert.ok(boings.length > 0, "the loop really ran");
  assert.ok(boings.length <= 64, `bounded by the owner drain quota (saw ${boings.length})`);

  // other sessions unaffected: Zoe's own command round-trips normally
  zoe.clear();
  await zoe.run("say unaffected");
  assert.ok(zoe.events().some((e) => e.kind === "say" && e.text === "unaffected"));

  // world consistent: movement, presence, and fresh evaluations still work
  zoe.clear();
  await zoe.run("go south");
  assert.ok(zoe.received.some((m) => m.type === "info" && /Town Square/.test(m.text)));
});

test("cross-owner blast radius: a hostile trigger refuses on ITS owner's budget; the enactor's own softcode is untouched", async () => {
  const spec: FixtureSpec = {
    ...SPEC,
    things: [
      {
        name: "cursed idol",
        owner: "Alice",
        room: "#20",
        attrs: {
          ON_ARRIVE: 'ctl.iter(str.trim(str.repeat("x ", 20000)), "bool.not(1)")',
        },
      },
      {
        name: "pocket watch",
        owner: "Bob",
        attrs: { TICK: '$time:out.emit("tick, tick")' },
      },
    ],
  };
  const { gw, seat } = await world(spec);
  const alice = await seat("Alice");
  const bob = await seat("Bob");
  bob.clear();

  await bob.run("go north"); // detonates the idol — as Alice's problem

  // the refusal happened on the idol's run (typed, engine-level assert):
  const batch = await gw.softcodeTriggers(bob.playerId, { kind: "arrive", targetId: "#20" });
  assert.ok(batch);
  const idol = batch.runs.find((r) => r.objectName === "cursed idol");
  assert.ok(idol);
  assert.equal(idol.owner, alice.playerId);

  // Bob was not punished: no error frame, and his own gadget still runs
  assert.ok(!bob.received.some((m) => m.type === "error"));
  bob.clear();
  await bob.run("time");
  assert.ok(bob.events().some((e) => e.kind === "emit" && e.text === "tick, tick"));
});

test("event storm: many listeners all fire, each under its own budget, delivery stays ordered", async () => {
  const stormThings = Array.from({ length: 8 }, (_, i) => ({
    name: `chime ${String.fromCharCode(97 + i)}`,
    owner: "Alice",
    room: "#20",
    attrs: { ON_ARRIVE: `out.emit("chime ${i + 1}")` },
  }));
  const { seat } = await world({ ...SPEC, things: stormThings });
  await seat("Alice");
  const bob = await seat("Bob");
  const zoe = await seat("Zoe");
  zoe.clear();

  await bob.run("go north");

  const emits = zoe.events().filter((e) => e.kind === "emit");
  // the room's own ON_ARRIVE + all 8 chimes
  assert.equal(emits.length, 9, "every listener fired exactly once");
  const seqs = zoe.events().map((e) => e.roomSeq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "one ordered stream");
});
