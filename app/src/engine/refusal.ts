// The internal refusal signal. Budget violations and typed errors travel as
// this exception INSIDE the engine only; the run boundary (engine.ts)
// converts it to a RunOutcome value. It must never cross the SoftcodeEngine
// interface — refusals are values, never throws (design record §3).

import type { RefusalCode } from "./types.js";

export class RefusalSignal extends Error {
  readonly code: RefusalCode;

  constructor(code: RefusalCode, detail?: string) {
    super(detail ?? code);
    this.name = "RefusalSignal";
    this.code = code;
  }
}
