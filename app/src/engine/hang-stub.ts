// A deliberately broken engine that hangs forever. Exists ONLY for the
// harness's watchdog self-test: the harness must detect and kill a hung
// engine from outside, or "never a hang" would be an assertion by the
// engine about itself. Never imported by production code.

import type {
  RunOutcome,
  RunRequest,
  SoftcodeEngine,
  WorldAPI,
  EngineOptions,
} from "./types.js";

const hangForever = (): never => {
  for (;;) {
    // busy-wait: the exact failure mode GM-R14 exists to prevent
  }
};

export const createEngine = (_options?: EngineOptions): SoftcodeEngine => ({
  run(_request: RunRequest, _world: WorldAPI): RunOutcome {
    return hangForever();
  },
  runMany(_requests: RunRequest[], _world: WorldAPI): RunOutcome[] {
    return hangForever();
  },
});
