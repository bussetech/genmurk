// Worker entry: load ONE engine build, run ONE fixture's programs against a
// fresh recording world, and post the outcomes back. The worker is the
// isolation boundary — the main thread terminates it on timeout, so a hung
// engine is caught from OUTSIDE (a hang cannot be self-reported). Nothing
// here trusts the engine to be well-behaved.

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { RecordingWorld } from "./world.ts";
import { createSeedWorld } from "./seed-world.ts";
import type { WorldAPI } from "../../src/engine/types.js";
import type {
  CreateEngine,
  RunOutcome,
  RunRequest,
} from "../../src/engine/types.js";
import type { Fixture } from "./types.ts";

interface WorkerInput {
  fixture: Fixture;
  engineModulePath: string;
  /** run against the REAL world model (src/world) instead of the toy — AC4. */
  realWorld?: boolean;
}

// A world impl that exposes the journaled mutations both worlds carry.
type ProofWorld = WorldAPI & { readonly mutations: { op: string; target: string; detail: string }[] };

function makeWorld(fixture: Fixture, real: boolean): ProofWorld {
  return real ? createSeedWorld(fixture.world) : new RecordingWorld(fixture.world);
}

interface WorkerResult {
  outcomes: RunOutcome[];
  mutations: { op: string; target: string; detail: string }[];
  integrity?: RunOutcome;
  error?: string;
}

const { fixture, engineModulePath, realWorld } = workerData as WorkerInput;

async function main(): Promise<void> {
  const mod = (await import(pathToFileURL(engineModulePath).href)) as {
    createEngine: CreateEngine;
  };
  const engine = mod.createEngine({ instrumentation: true });
  const world = makeWorld(fixture, realWorld ?? false);

  const requests: RunRequest[] = fixture.runs.map((r) => ({
    actor: r.actor,
    program: r.program,
    args: r.args,
    budget: fixture.budget,
  }));

  const outcomes =
    requests.length > 1
      ? engine.runMany(requests, world)
      : [engine.run(requests[0], world)];

  const result: WorkerResult = {
    outcomes,
    mutations: world.mutations,
  };

  if (fixture.integrityProbe) {
    const probeWorld = makeWorld({ ...fixture, world: undefined }, realWorld ?? false);
    result.integrity = engine.run(
      {
        actor: "#1",
        program: 'out.emit(num.add(1, 1))',
        budget: fixture.budget,
      },
      probeWorld,
    );
  }

  parentPort!.postMessage(result);
}

main().catch((err: unknown) => {
  const result: WorkerResult = {
    outcomes: [],
    mutations: [],
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  };
  parentPort!.postMessage(result);
});
