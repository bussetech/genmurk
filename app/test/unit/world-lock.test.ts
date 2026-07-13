// Boolean locks (GM-R8): the expression grammar evaluates correctly, fails
// CLOSED on malformed input, and runs through the world-API's canPickup/
// canEnter/canUse hooks — including the deny cases (AC2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { evalLock, parseLock, LockSyntaxError, type LockWorld } from "../../src/world/lock.ts";
import { buildWorld } from "../world/build.ts";

function lw(
  actorId: string,
  carrying: string[],
  attrs: Record<string, string>,
): LockWorld {
  return {
    actorId,
    carrying: () => carrying,
    attr: (_id, name) => attrs[name.toUpperCase()] ?? "",
  };
}

test("constants, negation, and precedence", () => {
  assert.equal(evalLock("true", lw("#1", [], {})).ok, true);
  assert.equal(evalLock("false", lw("#1", [], {})).ok, false);
  assert.equal(evalLock("!false", lw("#1", [], {})).ok, true);
  // & binds tighter than |
  assert.equal(evalLock("false&true|true", lw("#1", [], {})).ok, true);
  assert.equal(evalLock("false&(true|true)", lw("#1", [], {})).ok, false);
});

test("#dbref key: the actor IS the object, or carries it", () => {
  assert.equal(evalLock("#5", lw("#5", [], {})).ok, true, "actor is #5");
  assert.equal(evalLock("#5", lw("#1", ["#5"], {})).ok, true, "actor carries #5");
  assert.equal(evalLock("#5", lw("#1", ["#9"], {})).ok, false, "no key");
});

test("attribute predicate with glob", () => {
  assert.equal(evalLock("RANK:gold", lw("#1", [], { RANK: "gold" })).ok, true);
  assert.equal(evalLock("RANK:gold", lw("#1", [], { RANK: "silver" })).ok, false);
  assert.equal(evalLock("RANK:g*", lw("#1", [], { RANK: "gold" })).ok, true);
  assert.equal(evalLock("!RANK:gold", lw("#1", [], { RANK: "silver" })).ok, true);
});

test("compound expressions with parentheses", () => {
  const w = (rank: string, keys: string[]) => lw("#1", keys, { RANK: rank });
  assert.equal(evalLock("RANK:gold&#5", w("gold", ["#5"])).ok, true);
  assert.equal(evalLock("RANK:gold&#5", w("gold", [])).ok, false);
  assert.equal(evalLock("RANK:gold|#5", w("bronze", ["#5"])).ok, true);
  assert.equal(evalLock("(RANK:gold|RANK:silver)&#5", w("silver", ["#5"])).ok, true);
  assert.equal(evalLock("(RANK:gold|RANK:silver)&#5", w("bronze", ["#5"])).ok, false);
});

test("malformed locks fail CLOSED, never throw into the caller", () => {
  for (const bad of ["#", "foo bar", "(RANK:gold", "RANK:gold&", "&", ""]) {
    const r = evalLock(bad, lw("#1", [], { RANK: "gold" }));
    assert.equal(r.ok, false, `"${bad}" must deny`);
    assert.ok(r.error, `"${bad}" must report a parse error`);
  }
});

test("parseLock throws LockSyntaxError on malformed input", () => {
  assert.throws(() => parseLock("RANK:gold&"), LockSyntaxError);
  assert.throws(() => parseLock("#"), LockSyntaxError);
});

// ---- through the world-API (AC2: evaluated via the world-API, deny cases) --

test("locks evaluate through the world-API hooks, allow and deny", () => {
  const w = buildWorld({
    "#0": { type: "room", name: "Vault Room", location: null },
    "#1": { type: "player", name: "Alice", location: "#0", attrs: { RANK: "gold" } },
    "#2": { type: "player", name: "Bob", location: "#0", attrs: { RANK: "bronze" } },
    // the brass key sits in Alice's inventory (location = Alice)
    "#5": { type: "thing", name: "a brass key", owner: "#1", location: "#1" },
    // the chest: pickup needs gold rank, enter needs the key, use is barred
    "#10": {
      type: "thing",
      name: "an iron chest",
      owner: "#1",
      location: "#0",
      locks: { pickup: "RANK:gold", enter: "#5", use: "false" },
    },
  });

  // pickup: Alice (gold) passes, Bob (bronze) is denied
  assert.equal(w.canPickup("#1", "#10"), true);
  assert.equal(w.canPickup("#2", "#10"), false);
  // enter: Alice carries the key, Bob does not
  assert.equal(w.canEnter("#1", "#10"), true);
  assert.equal(w.canEnter("#2", "#10"), false);
  // use: locked shut for everyone
  assert.equal(w.canUse("#1", "#10"), false);
  // an object with NO lock is open by default (reference behavior)
  assert.equal(w.canPickup("#2", "#0"), true);
});
