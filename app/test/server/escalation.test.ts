// CAPABILITY ESCALATION — the softcode-privilege cases (GENMURK-EPIC1-08,
// GM-R15), stack-free. The prompt's sharp question: can an object owned by a
// BUILDER wield WIZARD power via a trigger a wizard sets off? The answer must
// be no, by construction, and this proves the invariant at the layer where it
// lives — the world-API capability check over a REAL WorldModel, driven by the
// REAL trigger/$-command collection (softcode.ts) and the REAL engine.
//
// The rule (decisions.md, "Softcode capability attribution"): a program runs
// AS its object (base `player` power — objects never carry a tier) and commits
// under its OWNER's authority; the ENACTOR who set it off contributes DATA
// (%0 name, %1 id), never authority. So the acting authority is the object +
// owner, never the triggering player — the escalation vector is closed before
// it reaches the RPC wall (which is the live-stack escalation.test's job).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, type ObjSpec } from "../world/build.ts";
import { createWorldModel } from "../../src/world/world-api.ts";
import { createEngine } from "../../src/engine/engine.ts";
import {
  collectTriggers,
  matchDollarCommand,
  SOFTCODE_RUN_BUDGET,
  type SoftcodeRun,
} from "../../src/server/softcode.ts";
import type { RunOutcome, WorldMutation } from "../../src/engine/types.ts";
import type { WorldSnapshot } from "../../src/world/types.ts";

const TOWN = "#10";
const WANDA = "#20"; // wizard — the enactor who trips the trap
const ALICE = "#30"; // builder — owns the trap
const TRAP = "#300"; // the builder-owned thing carrying the hostile softcode
const GOD = "#1";
const GOD_LAMP = "#50"; // a god-owned thing co-located in Town

/** The seeded neighborhood, as a plain snapshot (collectTriggers /
 *  matchDollarCommand read a WorldSnapshot; the model wraps it). `trap`
 *  overrides the mimic's attributes per case. */
function seed(trap: ObjSpec): WorldSnapshot {
  return buildSnapshot({
    [GOD]: { type: "player", name: "God", power: "god", location: TOWN },
    [TOWN]: { type: "room", name: "Town Square", owner: GOD },
    [WANDA]: { type: "player", name: "Wanda", power: "wizard", location: TOWN, owner: WANDA },
    [ALICE]: { type: "player", name: "Alice", power: "builder", location: TOWN, owner: ALICE },
    [GOD_LAMP]: { type: "thing", name: "god lamp", owner: GOD, location: TOWN },
    [TRAP]: { type: "thing", name: "a mimic", owner: ALICE, location: TOWN, ...trap },
  });
}

function runAll(runs: SoftcodeRun[], snap: WorldSnapshot): { outcomes: RunOutcome[]; mutations: WorldMutation[] } {
  const w = createWorldModel(snap);
  const engine = createEngine();
  const outcomes = engine.runMany(
    runs.map((r) => ({
      actor: r.actor,
      owner: r.owner,
      program: r.program,
      args: r.args,
      budget: SOFTCODE_RUN_BUDGET,
    })),
    w,
  );
  return { outcomes, mutations: w.mutations };
}

test("a trigger runs AS its object and is billed to its OWNER — never the enactor", () => {
  const snap = seed({ attrs: { ON_ARRIVE: 'obj.setAttr(me, "SEEN", %0)' } });
  const runs = collectTriggers(snap, "arrive", TOWN, { id: WANDA, name: "Wanda" });
  const trapRun = runs.find((r) => r.actor === TRAP);
  assert.ok(trapRun, "the builder-owned trap's ON_ARRIVE was collected");
  assert.equal(trapRun.actor, TRAP, "runs AS the object (base power), not the enactor");
  assert.equal(trapRun.owner, ALICE, "billed to the object's OWNER (the builder)");
  assert.notEqual(trapRun.owner, WANDA, "NOT the wizard enactor — no borrowed authority");
  assert.deepEqual(trapRun.args, ["Wanda", WANDA], "the enactor is DATA (%0 name, %1 id), never authority");
});

test("a builder-owned trigger cannot write the wizard enactor OR a god-owned object", () => {
  const snap = seed({
    attrs: { ON_ARRIVE: 'obj.setAttr(%1, "PWNED", "1"); obj.setAttr("#50", "PWNED", "1")' },
  });
  const runs = collectTriggers(snap, "arrive", TOWN, { id: WANDA, name: "Wanda" });
  const { outcomes, mutations } = runAll(runs, snap);

  // the write is a capability DENIAL (GM-R14: a typed refusal, never a crash),
  // and journals ZERO cross-ownership writes.
  const trapOutcome = outcomes[0]!;
  assert.equal(trapOutcome.status, "refused", "the cross-ownership write is refused, not silently applied");
  assert.equal(trapOutcome.refusalCode, "PERMISSION_DENIED", "refused on CAPABILITY, not some other error");
  assert.ok(
    !mutations.some((m) => m.target === WANDA),
    "the wizard enactor was NOT written — the object has no power over it",
  );
  assert.ok(
    !mutations.some((m) => m.target === GOD_LAMP),
    "the god-owned lamp was NOT written — cross-ownership is denied at the world-API",
  );
});

test("the same object CAN keep state on ITSELF — self-control is its own boundary, no one else's", () => {
  const snap = seed({ attrs: { ON_ARRIVE: 'obj.setAttr(me, "LAST_VISITOR", %0)' } });
  const runs = collectTriggers(snap, "arrive", TOWN, { id: WANDA, name: "Wanda" });
  const { outcomes, mutations } = runAll(runs, snap);
  assert.ok(outcomes.every((o) => o.status === "completed"));
  assert.ok(
    mutations.some((m) => m.op === "setAttr" && m.target === TRAP),
    "a run may write its own object (self-control): the deny above is about ownership, not a dead engine",
  );
});

test("a $-command owned by a builder also runs at base power — GOD as typist grants it nothing", () => {
  const snap = seed({ attrs: { CMD: '$pull *:obj.setAttr("#50", "PULLED", %0)' } });
  // God (the enactor/typist) pulls the builder's lever — but the lever acts as ITSELF.
  const match = matchDollarCommand(snap, GOD, "pull hard");
  assert.ok(match, "the $-command matched");
  assert.equal(match.actor, TRAP, "the $-command runs AS its object, not as god the typist");
  assert.equal(match.owner, ALICE, "billed to the builder owner");
  const { outcomes, mutations } = runAll([match], snap);
  assert.equal(outcomes[0]!.refusalCode, "PERMISSION_DENIED", "capability denial, not god-borrowed power");
  assert.ok(
    !mutations.some((m) => m.target === GOD_LAMP),
    "even with GOD as the typist, the builder's object cannot write the god-owned lamp",
  );
});
