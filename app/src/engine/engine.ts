// GenMURK softcode engine v0 — the real implementation of the seam
// (types.ts), per the design record (app/docs/engine-design.md) and gated by
// the adversarial proof harness. createEngine builds the frozen function
// library once; every run is a fresh metered invocation whose only
// capability is the WorldAPI it is handed.

import { buildLibrary } from "./interpreter.ts";
import { Scheduler } from "./scheduler.ts";
import type { CreateEngine, SoftcodeEngine } from "./types.js";

export const createEngine: CreateEngine = (options): SoftcodeEngine => {
  const lib = buildLibrary(options?.instrumentation ?? false);
  const scheduler = new Scheduler(lib);
  return {
    run: (request, world) => scheduler.run(request, world),
    runMany: (requests, world) => scheduler.runMany(requests, world),
  };
};
