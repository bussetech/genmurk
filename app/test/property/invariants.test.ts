// The property/fuzz layer. Generative tests over random programs assert the
// invariants that matter (design record §3/§4):
//   1. every program terminates or is terminated within budget — the engine
//      RETURNS, never throws, and a completed run used at most its fuel;
//   2. a terminated program's world-writes are bounded to spec — every
//      journaled write hit an actor-owned object through the WorldAPI;
//   3. two programs on the queue cannot starve each other — a victim's
//      trivial run completes whatever the attacker submits;
//   4. totality on garbage — random byte strings never crash the engine.
//
// Determinism: CI runs a FIXED seed corpus. Local fuzz mode is documented in
// the README: FUZZ_SEED=<n> FUZZ_RUNS=<n> npm run unit
// (a failing seed goes into SEED_CORPUS as a regression, and the pack gets
// a fixture when the failure is an attack shape).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import { RecordingWorld } from "../harness/world.ts";
import type { Budget } from "../../src/engine/types.js";

const SEED_CORPUS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const ENV_SEED = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : null;
const SEEDS = ENV_SEED ?? SEED_CORPUS;
const RUNS_PER_SEED = Number(process.env.FUZZ_RUNS ?? 40);

const FUZZ_BUDGET: Budget = {
  steps: 2000,
  recursionDepth: 16,
  enqueuePerRun: 4,
  queueDepthPerOwner: 8,
  allocationBytes: 65536,
  wallClockMs: 500,
};

// mulberry32 — tiny deterministic PRNG, seeded per test
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

const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

/** Random softcode over the real grammar — leaves and calls, bounded depth. */
function genExpr(r: () => number, depth: number): string {
  if (depth <= 0 || r() < 0.3)
    return pick(r, [
      '"word"',
      '"a b c d"',
      "12",
      "-3.5",
      "0",
      "#900",
      "me",
      "%0",
      "%1",
      '""',
    ]);
  const e = (): string => genExpr(r, depth - 1);
  return pick(r, [
    () => `str.concat(${e()}, ${e()})`,
    () => `str.repeat(${pick(r, ['"x"', '"ab"'])}, ${Math.floor(r() * 50)})`,
    () => `str.upper(${e()})`,
    () => `str.slice(${e()}, ${Math.floor(r() * 5)}, ${Math.floor(r() * 5)})`,
    () => `list.append(${e()}, ${e()})`,
    () => `list.item(${e()}, ${1 + Math.floor(r() * 4)})`,
    () => `num.add(${Math.floor(r() * 100)}, ${Math.floor(r() * 100)})`,
    () => `num.mod(${Math.floor(r() * 100)}, ${Math.floor(r() * 10)})`,
    () => `bool.and(${e()}, ${e()})`,
    () => `ctl.if(${e()}, ${e()}, ${e()})`,
    () => `ctl.switch(${e()}, "a*", ${e()}, ${e()})`,
    () => `ctl.iter("a b c", "out.emit(%0)")`,
    () => `ctl.eval(${e()})`,
    () => `obj.getAttr(me, "FN")`,
    () => `obj.callAttr(me, "FN", ${e()})`,
    () => `obj.callAttr(me, "LOOP")`,
    () => `obj.setAttr(me, "SCRATCH", ${e()})`,
    () => `obj.getAttr(#900, "SECRET")`,
    () => `out.emit(${e()})`,
    () => `queue.enqueue(me, "FN", ${e()})`,
    () => `t.burn(${Math.floor(r() * 3000)})`,
  ])();
}

const FUZZ_WORLD = {
  objects: {
    "#1": {
      owner: "#1",
      attrs: {
        FN: 'str.concat("<", %0, ">")',
        LOOP: 'ctl.eval(obj.getAttr(me, "LOOP"))',
      },
    },
  },
};

function genProgram(r: () => number): string {
  const statements = 1 + Math.floor(r() * 3);
  return Array.from({ length: statements }, () => genExpr(r, 3)).join("; ");
}

test("random programs terminate in budget: engine returns, never throws", () => {
  const engine = createEngine({ instrumentation: true });
  for (const seed of SEEDS) {
    const r = prng(seed);
    for (let i = 0; i < RUNS_PER_SEED; i++) {
      const program = genProgram(r);
      const world = new RecordingWorld(FUZZ_WORLD);
      const started = performance.now();
      const outcome = engine.run(
        { actor: "#1", program, args: ["arg0", "arg1"], budget: FUZZ_BUDGET },
        world,
      );
      const elapsed = performance.now() - started;
      assert.ok(
        outcome.status === "completed" || outcome.status === "refused",
        `seed ${seed}#${i}: bad status`,
      );
      if (outcome.status === "completed")
        assert.ok(
          outcome.stepsUsed <= FUZZ_BUDGET.steps,
          `seed ${seed}#${i}: completed over budget (${outcome.stepsUsed})`,
        );
      // generous wall bound: budget backstop is 500ms; a hang would blow this
      assert.ok(elapsed < 5000, `seed ${seed}#${i}: took ${elapsed}ms — unbounded?`);
      // internal-defect refusals surface here so fuzzing finds real bugs
      if (outcome.detail?.startsWith("internal:"))
        assert.fail(`seed ${seed}#${i}: internal defect on ${program}: ${outcome.detail}`);
    }
  }
});

test("world-writes are bounded to spec: only actor-owned targets, journaled", () => {
  const engine = createEngine({ instrumentation: true });
  for (const seed of SEEDS) {
    const r = prng(seed);
    for (let i = 0; i < RUNS_PER_SEED; i++) {
      const world = new RecordingWorld(FUZZ_WORLD);
      engine.run(
        { actor: "#1", program: genProgram(r), args: ["a"], budget: FUZZ_BUDGET },
        world,
      );
      for (const m of world.mutations) {
        assert.equal(m.op, "setAttr");
        assert.equal(m.target, "#1", `write escaped ownership: ${JSON.stringify(m)}`);
      }
    }
  }
});

test("fairness: a victim's run completes whatever the attacker submits", () => {
  const engine = createEngine({ instrumentation: true });
  for (const seed of SEEDS) {
    const r = prng(seed);
    for (let i = 0; i < 10; i++) {
      const world = new RecordingWorld(FUZZ_WORLD);
      const outcomes = engine.runMany(
        [
          { actor: "#1", program: genProgram(r), budget: FUZZ_BUDGET },
          { actor: "#2", program: 'out.emit("alive")', budget: FUZZ_BUDGET },
        ],
        world,
      );
      assert.equal(outcomes[1].status, "completed", `seed ${seed}#${i}: victim starved`);
      assert.deepEqual(outcomes[1].output, ["alive"]);
    }
  }
});

test("totality on garbage: random byte strings never crash the engine", () => {
  const engine = createEngine({ instrumentation: true });
  const CHARS =
    'abz019 %#()",;.\\*?\n\t{}[]$@!`\'~^&|<>=+-_' + String.fromCharCode(0, 7, 27, 155, 0xd800);
  for (const seed of SEEDS) {
    const r = prng(seed);
    for (let i = 0; i < RUNS_PER_SEED; i++) {
      const len = Math.floor(r() * 80);
      const junk = Array.from({ length: len }, () => CHARS[Math.floor(r() * CHARS.length)]).join("");
      const world = new RecordingWorld();
      const outcome = engine.run({ actor: "#1", program: junk, budget: FUZZ_BUDGET }, world);
      assert.ok(outcome.status === "completed" || outcome.status === "refused");
      if (outcome.detail?.startsWith("internal:"))
        assert.fail(`seed ${seed}#${i}: internal defect on ${JSON.stringify(junk)}: ${outcome.detail}`);
    }
  }
});

test("host-stack headroom: max nesting times max frames is a typed outcome", () => {
  // the worst legal shape: parse-depth-cap nesting inside a recursion chain
  // at the engine ceiling — must refuse (or complete), never crash the host
  const engine = createEngine({ instrumentation: true });
  const nested = "str.length(".repeat(31) + '"x"' + ")".repeat(31);
  const world = new RecordingWorld({
    objects: {
      "#1": {
        owner: "#1",
        attrs: { DEEP: `${nested}; obj.callAttr(me, "DEEP")` },
      },
    },
  });
  const outcome = engine.run(
    {
      actor: "#1",
      program: 'obj.callAttr(me, "DEEP")',
      budget: { ...FUZZ_BUDGET, steps: 10000000, recursionDepth: 1000000, wallClockMs: 10000 },
    },
    world,
  );
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.refusalCode, "RECURSION_LIMIT_EXCEEDED");
  assert.ok(!outcome.detail?.startsWith("internal:"), `host stack blew: ${outcome.detail}`);
});
