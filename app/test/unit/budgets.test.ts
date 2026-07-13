// Budget mechanics beyond what the pack pins: boundary exactness through
// the engine, the engine's own recursion ceiling, wall-clock backstop, and
// queue budget semantics including transactional enqueues and the drain
// quota (design record §3 + §9 deltas).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, runMany } from "./helpers.ts";
import { ENGINE_RECURSION_CEILING } from "../../src/engine/meter.ts";

test("fuel boundary: exactly-at-limit completes, plus-one refuses", () => {
  assert.equal(run("t.burn(50)", { budget: { steps: 50 } }).outcome.status, "completed");
  assert.equal(
    run("t.burn(51)", { budget: { steps: 50 } }).outcome.refusalCode,
    "STEP_BUDGET_EXCEEDED",
  );
});

test("allocation boundary: exactly-at-limit completes, plus-one refuses", () => {
  // parsing charges the account for the held source text, t.alloc for n —
  // so the exact boundary is program.length + n
  const program = "t.alloc(100)";
  const exact = program.length + 100;
  assert.equal(
    run(program, { budget: { allocationBytes: exact } }).outcome.status,
    "completed",
  );
  assert.equal(
    run(program, { budget: { allocationBytes: exact - 1 } }).outcome.refusalCode,
    "ALLOCATION_BUDGET_EXCEEDED",
  );
});

test("the engine clamps recursion depth at its own ceiling, whatever the config", () => {
  // a huge configured depth must not let softcode near the host stack limit
  const world = {
    objects: { "#1": { owner: "#1", attrs: { REC: 'obj.callAttr(me, "REC")' } } },
  };
  const { outcome } = run('obj.callAttr(me, "REC")', {
    world,
    budget: { recursionDepth: 1000000, steps: 10000000 },
  });
  assert.equal(outcome.refusalCode, "RECURSION_LIMIT_EXCEEDED");
  assert.ok(ENGINE_RECURSION_CEILING <= 64);
});

test("refused runs schedule nothing: enqueues are transactional", () => {
  const world = {
    objects: {
      "#1": {
        owner: "#1",
        attrs: { NOTE: 'obj.setAttr(me, "RAN", "1")' },
      },
    },
  };
  // enqueue succeeds, then the run dies on the step budget — the follow-on
  // must never execute, so RAN is never written
  const { outcome, world: w } = run('queue.enqueue(me, "NOTE"); t.burn(999999)', {
    world,
    budget: { steps: 100 },
  });
  assert.equal(outcome.refusalCode, "STEP_BUDGET_EXCEEDED");
  assert.equal(w.mutations.length, 0);
});

test("committed follow-ons execute with their args after the run completes", () => {
  const world = {
    objects: {
      "#1": { owner: "#1", attrs: { NOTE: 'obj.setAttr(me, "GOT", %0)' } },
    },
  };
  const { outcome, world: w } = run('queue.enqueue(me, "NOTE", "payload")', { world });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(w.mutations, [{ op: "setAttr", target: "#1", detail: "GOT=payload" }]);
});

test("a self-replicating chain terminates via the drain quota, bounded work", () => {
  const world = {
    objects: {
      "#1": {
        owner: "#1",
        attrs: { BOMB: 'queue.enqueue(me, "BOMB"); queue.enqueue(me, "BOMB")' },
      },
    },
  };
  const started = performance.now();
  const { outcome } = run('obj.callAttr(me, "BOMB")', {
    world,
    budget: { enqueuePerRun: 2, queueDepthPerOwner: 4 },
  });
  const elapsed = performance.now() - started;
  assert.equal(outcome.status, "completed");
  assert.ok(elapsed < 2000, `drain took ${elapsed}ms`);
});

test("runMany preserves submission order and per-owner fairness", () => {
  const { outcomes } = runMany([
    { actor: "#1", program: "t.burn(999999)" },
    { actor: "#2", program: 'out.emit("victim ok")' },
    { actor: "#1", program: 'out.emit("second")' },
  ], { budget: { steps: 500 } });
  assert.equal(outcomes[0].refusalCode, "STEP_BUDGET_EXCEEDED");
  assert.deepEqual(outcomes[1].output, ["victim ok"]);
  assert.deepEqual(outcomes[2].output, ["second"]);
});

test("wall-clock backstop refuses when fuel would allow more work", () => {
  const { outcome } = run("t.burn(900000000)", {
    budget: { steps: 1000000000, wallClockMs: 100 },
  });
  assert.equal(outcome.refusalCode, "WALL_CLOCK_EXCEEDED");
});
