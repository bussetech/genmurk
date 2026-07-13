// Fixture + status types shared by the harness and its worker.

import type { Budget, RefusalCode } from "../../src/engine/types.js";
import type { WorldSeed } from "./world.ts";

export interface FixtureRun {
  actor: string;
  program: string;
  /** substitution registers %0..%9 */
  args?: string[];
}

export interface ExpectMutation {
  op: string;
  target: string;
  detail: string;
}

export interface FixtureExpect {
  statusAnyOf: ("completed" | "refused")[];
  refusalCodesAnyOf?: RefusalCode[];
  mutations: ExpectMutation[];
  output?: string[];
  outputMustNotContain?: string[];
}

export interface Fixture {
  name: string;
  attackClass: string;
  description: string;
  budget: Budget;
  world?: WorldSeed;
  runs: FixtureRun[];
  expect: FixtureExpect[];
  integrityProbe?: boolean;
}

export type EngineStatusValue = "stub" | "candidate" | "proven";

export interface EngineStatus {
  status: EngineStatusValue;
  engineModule: string;
}
