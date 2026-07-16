// Boolean locks — the full ruled scope (GM-R8, GENMURK-EPIC1-09): the
// OWNERSHIP predicate `owner(#N)` alongside attribute predicates, and the
// sandbox-by-construction bounds (GM-R14) proven against hostile expressions.
// A stored lock is untrusted input; its evaluation must terminate fast and
// FAIL CLOSED on anything pathological.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evalLock,
  parseLock,
  LockSyntaxError,
  LOCK_EVAL_STEPS,
  type LockWorld,
} from "../../src/world/lock.ts";
import { buildWorld } from "../world/build.ts";

function lw(
  actorId: string,
  carrying: string[],
  attrs: Record<string, string>,
  owners: Record<string, string> = {},
): LockWorld {
  return {
    actorId,
    carrying: () => carrying,
    attr: (_id, name) => attrs[name.toUpperCase()] ?? "",
    ownerOf: (id) => owners[id] ?? null,
  };
}

// ---- ownership predicate (GM-R8: "attribute/ownership predicates") ----------

test("owner(#N): passes iff the actor owns object #N", () => {
  // #5 is owned by #1 (the actor) → open; by #9 → closed
  assert.equal(evalLock("owner(#5)", lw("#1", [], {}, { "#5": "#1" })).ok, true);
  assert.equal(evalLock("owner(#5)", lw("#1", [], {}, { "#5": "#9" })).ok, false);
  // unknown owner denies
  assert.equal(evalLock("owner(#5)", lw("#1", [], {}, {})).ok, false);
});

test("owner() composes with the boolean operators", () => {
  const w = lw("#1", ["#7"], { RANK: "gold" }, { "#5": "#1" });
  assert.equal(evalLock("owner(#5)&RANK:gold", w).ok, true);
  assert.equal(evalLock("owner(#5)&#7", w).ok, true, "owns #5 and carries #7");
  assert.equal(evalLock("owner(#99)|RANK:gold", w).ok, true, "falls through to the rank");
  assert.equal(evalLock("!owner(#5)", w).ok, false);
});

test("owner() malformations fail closed with a parse error", () => {
  for (const bad of ["owner(", "owner()", "owner(5)", "owner(#5", "owner#5)"]) {
    const r = evalLock(bad, lw("#1", [], {}, {}));
    assert.equal(r.ok, false, `"${bad}" must deny`);
    assert.ok(r.error, `"${bad}" must report a parse error`);
  }
});

test("owner() evaluates through the world-API over the real snapshot", () => {
  const w = buildWorld({
    "#0": { type: "room", name: "Hall", location: null },
    "#1": { type: "player", name: "Alice", location: "#0" },
    "#2": { type: "player", name: "Bob", location: "#0" },
    // the charter #5 belongs to Alice; the door opens for whoever owns it
    "#5": { type: "thing", name: "the guild charter", owner: "#1", location: "#0" },
    "#10": {
      type: "thing",
      name: "the guild door",
      owner: "#1",
      location: "#0",
      locks: { use: "owner(#5)" },
    },
  });
  assert.equal(w.canUse("#1", "#10"), true, "Alice owns the charter → passes");
  assert.equal(w.canUse("#2", "#10"), false, "Bob does not → denied");
});

// ---- sandbox by construction (GM-R14): hostile expressions ------------------

test("a nesting bomb is refused (depth cap), fails closed", () => {
  const deep = "(".repeat(500) + "true" + ")".repeat(500);
  assert.throws(() => parseLock(deep), LockSyntaxError);
  const r = evalLock(deep, lw("#1", [], {}));
  assert.equal(r.ok, false, "an over-nested lock denies");
  assert.ok(/nested too deeply/.test(r.error ?? ""), "reports the depth refusal");
});

test("a '!' chain past the depth cap is refused", () => {
  const bangs = "!".repeat(500) + "true";
  const r = evalLock(bangs, lw("#1", [], {}));
  assert.equal(r.ok, false);
  assert.ok(/nested too deeply/.test(r.error ?? ""));
});

test("an over-length lock is refused before parsing", () => {
  const huge = "true|".repeat(500) + "true"; // > 1024 chars
  assert.ok(huge.length > 1024);
  const r = evalLock(huge, lw("#1", [], {}));
  assert.equal(r.ok, false);
  assert.ok(/too long/.test(r.error ?? ""));
});

test("a catastrophic-glob attempt terminates fast and does not match", () => {
  // the glob compiler is backtrack-free, so `*a*a*…` against a long
  // non-matching string cannot go super-linear — assert both correctness and
  // that it returns well under a generous wall-clock bound.
  const pattern = "RANK:" + "*a".repeat(200);
  const victim = "b".repeat(2000);
  const start = performance.now();
  const r = evalLock(pattern, lw("#1", [], { RANK: victim }));
  const elapsed = performance.now() - start;
  assert.equal(r.ok, false, "the hostile pattern does not match");
  assert.ok(elapsed < 500, `evaluated in ${elapsed.toFixed(1)}ms (bounded, not backtracking)`);
});

test("the largest legal expression still evaluates within the step budget", () => {
  // a maximal `&` chain under the length cap has ~2·terms nodes — comfortably
  // under LOCK_EVAL_STEPS, proving the budget is sized above the worst case a
  // length- and depth-capped lock can produce (it is a backstop, not a limit
  // a legitimate lock ever reaches).
  const terms = Math.floor(1000 / "true&".length);
  const chain = Array(terms).fill("true").join("&");
  assert.ok(chain.length <= 1024);
  const r = evalLock(chain, lw("#1", [], {}));
  assert.equal(r.ok, true, "a maximal legal chain evaluates");
  assert.ok(terms * 2 < LOCK_EVAL_STEPS, "worst-case node count is under the budget");
});
