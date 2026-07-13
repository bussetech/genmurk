// Performance envelope probe — NOT part of the gate (budgets prove safety;
// this measures cost). Run manually: npm run bench. Numbers land in session
// handoffs so the estimate track sees the envelope move.

import { createEngine } from "../src/engine/engine.ts";
import { RecordingWorld } from "./harness/world.ts";
import type { Budget } from "../src/engine/types.js";

const engine = createEngine({ instrumentation: true });

const BIG: Budget = {
  steps: 100_000_000,
  recursionDepth: 64,
  enqueuePerRun: 8,
  queueDepthPerOwner: 16,
  allocationBytes: 64 * 1024 * 1024,
  wallClockMs: 60_000,
};

function bench(label: string, program: string, world = new RecordingWorld()): void {
  // warm-up
  engine.run({ actor: "#1", program, budget: BIG }, world);
  const started = performance.now();
  const outcome = engine.run({ actor: "#1", program, budget: BIG }, world);
  const ms = performance.now() - started;
  const rate = Math.round(outcome.stepsUsed / (ms / 1000));
  console.log(
    `${label.padEnd(34)} ${outcome.status.padEnd(9)} steps=${String(outcome.stepsUsed).padStart(9)}  ${ms.toFixed(1).padStart(8)}ms  ${String(rate).padStart(10)} steps/s`,
  );
}

console.log("\nGenMURK engine v0 — performance envelope\n");

bench("raw fuel loop (t.burn 5M)", "t.burn(5000000)");
bench(
  "iteration (ctl.iter 20k noops)",
  'ctl.iter(str.trim(str.repeat("x ", 20000)), "t.noop()")',
);
bench(
  "call-heavy (map num.mul over 5k)",
  'list.count(list.map(str.trim(str.repeat("7 ", 5000)), "DOUBLE"))',
  new RecordingWorld({
    objects: { "#1": { owner: "#1", attrs: { DOUBLE: "num.mul(%0, 2)" } } },
  }),
);
bench(
  "recursion chain (depth 60)",
  'obj.callAttr(me, "D", 0)',
  new RecordingWorld({
    objects: {
      "#1": {
        owner: "#1",
        attrs: {
          // recurse while %0 != 60 (num.cmp is 0 exactly at 60)
          D: 'ctl.if(num.cmp(%0, 60), obj.callAttr(me, "D", num.add(%0, 1)), t.noop())',
        },
      },
    },
  }),
);
bench(
  "string work (concat/upper/replace)",
  'str.length(str.replace(str.upper(str.repeat("ab ", 30000)), "AB", "xy"))',
);
