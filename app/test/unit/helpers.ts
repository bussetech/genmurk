// Shared helpers for the unit/property layers: build a real engine (with
// instrumentation, like the proof harness does), run one program against a
// fresh recording world, and hand back both.

import { createEngine } from "../../src/engine/engine.ts";
import { RecordingWorld, type WorldSeed } from "../harness/world.ts";
import type { Budget, RunOutcome, RunRequest } from "../../src/engine/types.js";

export const BUDGET: Budget = {
  steps: 100000,
  recursionDepth: 32,
  enqueuePerRun: 8,
  queueDepthPerOwner: 16,
  allocationBytes: 1048576,
  wallClockMs: 2000,
};

export interface RunOptions {
  budget?: Partial<Budget>;
  world?: WorldSeed;
  args?: string[];
  actor?: string;
}

export interface RunResult {
  outcome: RunOutcome;
  world: RecordingWorld;
}

export function run(program: string, opts: RunOptions = {}): RunResult {
  const engine = createEngine({ instrumentation: true });
  const world = new RecordingWorld(opts.world);
  const outcome = engine.run(
    {
      actor: opts.actor ?? "#1",
      program,
      args: opts.args,
      budget: { ...BUDGET, ...opts.budget },
    },
    world,
  );
  return { outcome, world };
}

export function runMany(requests: Omit<RunRequest, "budget">[], opts: RunOptions = {}): {
  outcomes: RunOutcome[];
  world: RecordingWorld;
} {
  const engine = createEngine({ instrumentation: true });
  const world = new RecordingWorld(opts.world);
  const outcomes = engine.runMany(
    requests.map((r) => ({ ...r, budget: { ...BUDGET, ...opts.budget } })),
    world,
  );
  return { outcomes, world };
}

/** Evaluate an expression by emitting it; returns the emitted value. */
export function value(expr: string, opts: RunOptions = {}): string {
  const { outcome } = run(`out.emit(${expr})`, opts);
  if (outcome.status !== "completed")
    throw new Error(`expected completion, got ${outcome.refusalCode}: ${outcome.detail ?? ""}`);
  return outcome.output[0] ?? "";
}

/** Evaluate an expression expecting a typed refusal; returns the code. */
export function refusal(expr: string, opts: RunOptions = {}): string {
  const { outcome } = run(`out.emit(${expr})`, opts);
  if (outcome.status !== "refused")
    throw new Error(`expected refusal, got completion with ${JSON.stringify(outcome.output)}`);
  return outcome.refusalCode ?? "";
}
