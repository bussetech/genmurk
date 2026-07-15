// The property layer, extended to the INTEGRATED STACK (GENMURK-EPIC1-07):
// parseCommand → dispatch → $-scan/triggers → the engine's fair scheduler →
// the coordinator's ordering domain, over the real world model — no database,
// nothing mocked inside the pipeline. The invariants:
//   1. LIVENESS — every dispatched line RETURNS, whatever hostile softcode
//      sits in the room (a hang here is a failed GM-R14 proof at the stack
//      level, caught by the test runner's own timeout);
//   2. FAIRNESS — a victim's trivial softcode completes on every round, and
//      speech round-trips, no matter what a hostile owner's objects do: the
//      runaway exhausts ITS budget and nothing else stutters;
//   3. ORDER — each observer's per-room stream stays strictly monotonic in
//      roomSeq under interleaved softcode/speech/movement load.
//
// Determinism: fixed seed corpus, like test/property/invariants.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { FixtureGateway, type FixtureSpec } from "../../src/server/gateway.ts";
import { dispatch } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const SEEDS = [7, 11, 23, 42, 1979];
const ROUNDS_PER_SEED = 6;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hostile shapes drawn from the adversarial pack's attack classes, attached
// to world objects instead of submitted directly — the world-integrated round.
const HOSTILE_PROGRAMS = [
  // cpu: step bomb
  'ctl.iter(str.trim(str.repeat("x ", 20000)), "bool.not(1)")',
  // recursion: direct self-call
  'obj.callAttr(me, "PAYLOAD")',
  // queue: self-replicating chain
  'queue.enqueue(me, "PAYLOAD"); queue.enqueue(me, "PAYLOAD")',
  // allocation: repeat bomb
  'str.repeat("boom", 999999)',
  // escape reach: unknown function
  'net.connect("ws://127.0.0.1")',
];

function spec(r: () => number): FixtureSpec {
  const hostiles = Array.from({ length: 3 }, (_, i) => {
    const program = HOSTILE_PROGRAMS[Math.floor(r() * HOSTILE_PROGRAMS.length)]!;
    return {
      name: `hazard ${String.fromCharCode(97 + i)}`,
      owner: "Mallory",
      room: "#10",
      attrs: {
        [`H${i}`]: `$hazard${i} *:${program}`,
        PAYLOAD: program,
        ON_ARRIVE: program,
      },
    };
  });
  return {
    rooms: { "#10": { name: "Arena" }, "#20": { name: "Antechamber" } },
    exits: [
      { name: "out", from: "#10", to: "#20" },
      { name: "in", from: "#20", to: "#10" },
    ],
    players: {
      Mallory: { power: "builder", room: "#10" },
      Vic: { room: "#10" },
      Watcher: { room: "#10" },
    },
    things: [
      ...hostiles,
      {
        name: "victim charm",
        owner: "Vic",
        attrs: { PING: '$ping:out.emit("pong")' },
      },
    ],
  };
}

interface Seat {
  received: ServerMessage[];
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
}

async function seatAll(fixture: FixtureSpec, names: string[]): Promise<Map<string, Seat>> {
  const coord = new RoomCoordinator();
  const gw = new FixtureGateway(fixture);
  const engine = createEngine();
  const seats = new Map<string, Seat>();
  let n = 0;
  for (const name of names) {
    const sessionId = `s${++n}`;
    const player = await gw.authenticate(gw.tokenFor(name));
    assert.ok(player, `authenticate ${name}`);
    const received: ServerMessage[] = [];
    seats.set(name, {
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
          },
          line,
        ),
      events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
    });
    coord.join(sessionId, {
      playerId: player.playerId,
      playerName: player.playerName,
      power: player.power,
      roomId: player.roomId,
      roomName: player.roomName,
      sink: { send: (m) => received.push(m) },
    });
  }
  return seats;
}

for (const seed of SEEDS) {
  test(`world-integrated fairness under hostile load (seed ${seed})`, async () => {
    const r = prng(seed);
    const seats = await seatAll(spec(r), ["Mallory", "Vic", "Watcher"]);
    const mallory = seats.get("Mallory")!;
    const vic = seats.get("Vic")!;
    const watcher = seats.get("Watcher")!;

    for (let round = 0; round < ROUNDS_PER_SEED; round++) {
      // Mallory detonates one of her hazards ($-command), or walks out and
      // back (arrival triggers — the event-storm path), seed-chosen:
      const attack =
        r() < 0.5
          ? [mallory.run(`hazard${Math.floor(r() * 3)} now`)]
          : [mallory.run("go out").then(() => mallory.run("go in"))];

      // the victim's trivial softcode and speech, interleaved with the attack
      const before = vic.events().length;
      await Promise.all([...attack, vic.run("ping"), vic.run(`say round ${round}`)]);

      const fresh = vic.events().slice(before);
      assert.ok(
        fresh.some((e) => e.kind === "emit" && e.text === "pong"),
        `round ${round}: the victim's run completed with its output intact`,
      );
      assert.ok(
        fresh.some((e) => e.kind === "say" && e.text === `round ${round}`),
        `round ${round}: speech round-tripped`,
      );
    }

    // ORDER: every observer's per-room stream is strictly monotonic
    for (const [name, seat] of seats) {
      const perRoom = new Map<string, number[]>();
      for (const e of seat.events()) {
        const xs = perRoom.get(e.room) ?? [];
        xs.push(e.roomSeq);
        perRoom.set(e.room, xs);
      }
      for (const [room, seqs] of perRoom) {
        for (let i = 1; i < seqs.length; i++) {
          assert.ok(seqs[i]! > seqs[i - 1]!, `${name}'s ${room} stream is ordered`);
        }
      }
    }
  });
}
