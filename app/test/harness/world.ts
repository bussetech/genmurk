// The recording in-memory world the fixtures run against — never the real
// world model. Attributes live in Maps (not object properties), so
// prototype-pollution payloads are inert data. Permission rule (toy GM-R15):
// an actor may read/write only objects it owns; everything else is a
// PERMISSION_DENIED world refusal. Every write is journaled.

import type { WorldAPI, WorldMutation, WorldRefusal } from "../../src/engine/types.js";

export interface SeedObject {
  owner: string;
  attrs?: Record<string, string>;
}

export interface WorldSeed {
  objects?: Record<string, SeedObject>;
}

interface WorldObject {
  owner: string;
  attrs: Map<string, string>;
}

const DEFAULT_SEED: WorldSeed = {
  objects: {
    "#1": { owner: "#1", attrs: {} },
    "#2": { owner: "#2", attrs: {} },
    "#900": { owner: "#902", attrs: { SECRET: "swordfish" } },
  },
};

export class RecordingWorld implements WorldAPI {
  private objects = new Map<string, WorldObject>();
  readonly mutations: WorldMutation[] = [];

  constructor(seed?: WorldSeed) {
    this.applySeed(DEFAULT_SEED);
    if (seed) this.applySeed(seed);
  }

  private applySeed(seed: WorldSeed): void {
    for (const [id, obj] of Object.entries(seed.objects ?? {})) {
      const existing = this.objects.get(id);
      const attrs = existing?.attrs ?? new Map<string, string>();
      for (const [k, v] of Object.entries(obj.attrs ?? {})) attrs.set(k, v);
      this.objects.set(id, { owner: obj.owner, attrs });
    }
  }

  private owns(actor: string, target: string): boolean {
    const obj = this.objects.get(target);
    return !!obj && obj.owner === actor;
  }

  getAttr(actor: string, target: string, attr: string): string | WorldRefusal {
    if (!this.owns(actor, target)) return { refused: "PERMISSION_DENIED" };
    return this.objects.get(target)!.attrs.get(attr) ?? "";
  }

  setAttr(
    actor: string,
    target: string,
    attr: string,
    value: string,
  ): true | WorldRefusal {
    if (!this.owns(actor, target)) return { refused: "PERMISSION_DENIED" };
    this.objects.get(target)!.attrs.set(attr, value);
    this.mutations.push({ op: "setAttr", target, detail: `${attr}=${value}` });
    return true;
  }

  emit(_actor: string, _text: string): void {
    // Output is collected by the engine into RunOutcome.output; a real
    // world would fan this to room occupants. The harness reads outcomes,
    // so this is intentionally a no-op sink at the world boundary.
  }

  // Toy visibility for the seam extension (GENMURK-EPIC1-03): names and
  // locations are public in this world; real GM-R15 semantics arrive with
  // the world model (04). Names come from a NAME attr when seeded, else the
  // object's id — enough to give the engine's fuel-charged GM-R12 matching
  // real candidates.

  name(_actor: string, target: string): string | WorldRefusal {
    const obj = this.objects.get(target);
    if (!obj) return { refused: "PERMISSION_DENIED" };
    return obj.attrs.get("NAME") ?? target;
  }

  location(_actor: string, target: string): string | WorldRefusal {
    const obj = this.objects.get(target);
    if (!obj) return { refused: "PERMISSION_DENIED" };
    return obj.attrs.get("LOCATION") ?? "#0";
  }

  visibleObjects(_actor: string): { id: string; name: string }[] {
    return [...this.objects.entries()].map(([id, obj]) => ({
      id,
      name: obj.attrs.get("NAME") ?? id,
    }));
  }
}
