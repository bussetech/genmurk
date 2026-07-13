// The honest stub — the walking skeleton the proof harness can fail.
// It implements the engine seam and refuses every program with
// ENGINE_NOT_IMPLEMENTED: zero output, zero mutations, zero pretence.
// While app/engine-status.json says "stub", the harness asserts exactly
// this behavior (proving the plumbing) and reports SANDBOX NOT PROVEN.

import type {
  RunOutcome,
  RunRequest,
  SoftcodeEngine,
  WorldAPI,
  EngineOptions,
} from "./types.js";

const refuse = (): RunOutcome => ({
  status: "refused",
  refusalCode: "ENGINE_NOT_IMPLEMENTED",
  output: [],
  mutations: [],
  stepsUsed: 0,
});

export const createEngine = (_options?: EngineOptions): SoftcodeEngine => ({
  run(_request: RunRequest, _world: WorldAPI): RunOutcome {
    return refuse();
  },
  runMany(requests: RunRequest[], _world: WorldAPI): RunOutcome[] {
    return requests.map(() => refuse());
  },
});
