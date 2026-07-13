// The per-invocation meter — fuel (steps), allocation account, recursion
// depth, wall-clock backstop. Every unit of interpreter work charges here
// BEFORE the work happens; exhaustion is a typed RefusalSignal, never a hang
// (design record §3). One Meter per invocation; queue entries get fresh ones.

import { RefusalSignal } from "./refusal.ts";
import type { Budget } from "./types.js";

/** Wall-clock is checked every this-many fuel charges — cheap, bounded lag. */
const CLOCK_CHECK_INTERVAL = 1024;

/**
 * Engine hard ceiling on recursion depth, independent of the configured
 * budget. Softcode frames nest on the host stack (the walker is recursive),
 * so depth must be bounded by the ENGINE, not only by server config — a
 * misconfigured budget must not be able to blow the host stack (that would
 * be a crash, and a crash is a failed proof).
 */
export const ENGINE_RECURSION_CEILING = 64;

export class Meter {
  readonly budget: Budget;
  private fuelUsed = 0;
  private allocUsed = 0;
  private depth = 0;
  private sinceClockCheck = 0;
  private readonly startedAt: number;
  private readonly effectiveDepthCap: number;

  constructor(budget: Budget) {
    this.budget = budget;
    this.startedAt = performance.now();
    this.effectiveDepthCap = Math.min(
      budget.recursionDepth,
      ENGINE_RECURSION_CEILING,
    );
  }

  get stepsUsed(): number {
    return this.fuelUsed;
  }

  /** Charge n fuel units. Work at the limit completes; the first unit beyond refuses. */
  charge(n = 1): void {
    this.fuelUsed += n;
    if (this.fuelUsed > this.budget.steps)
      throw new RefusalSignal("STEP_BUDGET_EXCEEDED");
    this.sinceClockCheck += n;
    if (this.sinceClockCheck >= CLOCK_CHECK_INTERVAL) {
      this.sinceClockCheck = 0;
      this.checkClock();
    }
  }

  /** Charge the byte account BEFORE constructing — a refused string is never built. */
  chargeAlloc(bytes: number): void {
    this.allocUsed += bytes;
    if (this.allocUsed > this.budget.allocationBytes)
      throw new RefusalSignal("ALLOCATION_BUDGET_EXCEEDED");
  }

  /** The backstop: fuel bounds the work; this defends the slow-host residual. */
  checkClock(): void {
    if (performance.now() - this.startedAt > this.budget.wallClockMs)
      throw new RefusalSignal("WALL_CLOCK_EXCEEDED");
  }

  /**
   * Depth is charged where the FRAME is created (user-function / attribute
   * evaluation), so mutual recursion hits the same wall as direct self-calls.
   */
  enterFrame(): void {
    this.depth += 1;
    if (this.depth > this.effectiveDepthCap)
      throw new RefusalSignal("RECURSION_LIMIT_EXCEEDED");
  }

  exitFrame(): void {
    this.depth -= 1;
  }
}
