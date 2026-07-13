// Task-5 proof: the engine speaks ONLY to the WorldAPI interface. A Proxy
// test double records every property the engine touches on its world; a
// battery of programs (including hostile ones) must reach nothing beyond
// the seam's method set, and every value crossing it must be a string.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import type { WorldAPI, WorldRefusal } from "../../src/engine/types.js";
import { BUDGET } from "./helpers.ts";

const WORLD_SURFACE = new Set([
  "getAttr",
  "setAttr",
  "emit",
  "name",
  "location",
  "visibleObjects",
]);

interface Recording {
  touched: Set<string>;
  argsSeen: unknown[];
}

function recordingWorldDouble(): { world: WorldAPI; rec: Recording } {
  const rec: Recording = { touched: new Set(), argsSeen: [] };
  const attrs = new Map<string, string>([
    ["FN", "num.add(%0, 1)"],
    ["REC", 'obj.callAttr(me, "REC")'],
  ]);
  const impl: WorldAPI = {
    getAttr: (_a, _t, attr) => attrs.get(attr) ?? "",
    setAttr: () => true,
    emit: () => undefined,
    name: (_a, t) => t,
    location: () => "#0",
    visibleObjects: () => [{ id: "#1", name: "self" }],
  };
  const world = new Proxy(impl, {
    get(target, prop) {
      rec.touched.add(String(prop));
      const v = target[prop as keyof WorldAPI];
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        rec.argsSeen.push(...args);
        return (v as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return { world, rec };
}

const BATTERY = [
  'out.emit("hello")',
  'obj.setAttr(me, "X", "1"); out.emit(obj.getAttr(me, "X"))',
  'obj.callAttr(me, "FN", 41)',
  'obj.callAttr(me, "REC")', // recursion refusal path
  'obj.resolve("self"); obj.name(me); obj.location(me)',
  'queue.enqueue(me, "FN", "1")', // exercises the drain path
  'ctl.iter("a b c", "out.emit(%0)")',
  "require(\"fs\")", // hostile: unknown function
  "t.burn(999999999)", // hostile: budget refusal mid-run
];

test("softcode reaches nothing beyond the WorldAPI surface", () => {
  const engine = createEngine({ instrumentation: true });
  for (const program of BATTERY) {
    const { world, rec } = recordingWorldDouble();
    engine.run({ actor: "#1", program, budget: { ...BUDGET, steps: 5000 } }, world);
    for (const prop of rec.touched)
      assert.ok(
        WORLD_SURFACE.has(prop),
        `engine touched non-seam world property ${JSON.stringify(prop)} running ${program}`,
      );
    for (const arg of rec.argsSeen)
      assert.equal(
        typeof arg,
        "string",
        `non-string value crossed the seam: ${String(arg)} (${typeof arg})`,
      );
  }
});

test("world refusals surface as typed refusals and leak nothing", () => {
  const engine = createEngine({ instrumentation: true });
  const denyAll: WorldAPI = {
    getAttr: (): WorldRefusal => ({ refused: "PERMISSION_DENIED" }),
    setAttr: (): WorldRefusal => ({ refused: "PERMISSION_DENIED" }),
    emit: () => undefined,
    name: (): WorldRefusal => ({ refused: "PERMISSION_DENIED" }),
    location: (): WorldRefusal => ({ refused: "PERMISSION_DENIED" }),
    visibleObjects: () => [],
  };
  const outcome = engine.run(
    { actor: "#1", program: 'out.emit(obj.getAttr(me, "SECRET"))', budget: BUDGET },
    denyAll,
  );
  assert.equal(outcome.refusalCode, "PERMISSION_DENIED");
  assert.deepEqual(outcome.output, []);
});

test("outcome values are strings all the way down (GM-R11 value model)", () => {
  const engine = createEngine({ instrumentation: true });
  const { world } = recordingWorldDouble();
  const outcome = engine.run(
    { actor: "#1", program: 'out.emit(obj.callAttr(me, "FN", 41))', budget: BUDGET },
    world,
  );
  assert.deepEqual(outcome.output, ["42"]);
  for (const line of outcome.output) assert.equal(typeof line, "string");
});
