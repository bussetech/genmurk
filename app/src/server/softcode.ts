// Softcode meets the world (GENMURK-EPIC1-07, GM-R11/R12): the `$`-command
// scan and the event-trigger collection, both over the actor's neighborhood
// snapshot — the attribute-enumeration work design record §9.8 deferred to
// the world model.
//
// THE SHAPE OF THE DATA. A `$`-command is an attribute whose value is
//   $<pattern>:<program>
// — the `$` sigil is requirement-of-record vocabulary (decomposition D3 and
// backlog item 5 both name "`$`-commands"); the `:` separator is provisional
// pending the GM-R22 capture, like all argument punctuation. `<pattern>` is a
// GM-R12 wildcard pattern matched against the WHOLE typed line; its captures
// become the program's substitution registers %0..%9. An event trigger is an
// attribute with a RESERVED NAME (ON_ARRIVE, ON_USE — GenMURK-internal names
// per the library naming law) whose value is a plain program.
//
// THE BUDGET STORY (GM-R14). Matching is work, and this module meters it:
// every candidate object's patterns are matched under a per-object match
// allowance drawn through the engine's own Meter, so a hostile pattern
// exhausts ITS object's allowance (that candidate is skipped — fail-safe,
// nothing fires) and cannot starve the scan for other objects in the room,
// and a room full of hostile patterns costs a typed line at most
// (#objects × MATCH allowance) units, ever. The matched program then runs
// through the sandboxed engine under SOFTCODE_RUN_BUDGET, AS the object,
// ATTRIBUTED to the object's owner (RunRequest.owner) for queue depth, drain
// quota, and scheduler fairness.
//
// PRECEDENCE (decided, requirements silent — decisions.md): built-ins ALWAYS
// win. The dispatcher only reaches this scan for lines no built-in claims, so
// player softcode can never shadow `go`, `lock`, `quit`, … — an object in a
// room must never be able to intercept another player's fixed verbs (the
// spoofing/phishing class). If the capture shows the reference allowed
// shadowing, that becomes a recorded divergence: the safe behavior wins.

import { Meter } from "../engine/meter.ts";
import { RefusalSignal } from "../engine/refusal.ts";
import { globMatch } from "../engine/match.ts";
import type { Budget } from "../engine/types.ts";
import type { WorldSnapshot, SnapObject } from "../world/types.ts";

/** The standard per-invocation budget for world-attached softcode (v1). */
export const SOFTCODE_RUN_BUDGET: Budget = {
  steps: 10000,
  recursionDepth: 32,
  enqueuePerRun: 8,
  queueDepthPerOwner: 16,
  allocationBytes: 262144,
  wallClockMs: 500,
};

/** Match-scan allowance per candidate object: fuel for pattern matching only.
 *  A pattern set that exhausts it skips ITS object and the scan continues —
 *  one hostile object cannot deny `$`-commands to the rest of the room. */
export const MATCH_STEPS_PER_OBJECT = 512;

/** Trigger kinds in the ruled v1 scope. `arrive` fires when a player moves
 *  into a ROOM (the room and its co-located things listen); `use` fires on a
 *  successfully entered THING (the container listens). Drop-class triggers
 *  arrive with the get/drop verb surface (capture-gated) — documented, not
 *  invented here. */
export type TriggerKind = "arrive" | "use";

export const TRIGGER_ATTRS: Record<TriggerKind, string> = {
  arrive: "ON_ARRIVE",
  use: "ON_USE",
};

/** One softcode evaluation ready for the engine: runs AS `actor` (the object),
 *  billed to `owner` (the object's owner). */
export interface SoftcodeRun {
  actor: string;
  owner: string;
  objectName: string;
  /** the attribute the program came from (diagnostics) */
  attr: string;
  program: string;
  /** substitution registers %0.. — `$`-captures, or the trigger's enactor */
  args: string[];
}

const byDbref = (a: SnapObject, b: SnapObject): number => a.dbref - b.dbref;

/** `$`-command candidates, in the decided deterministic order: the room the
 *  actor stands in, then co-located things by ascending dbref, then the
 *  actor's inventory things by ascending dbref. Things and rooms only —
 *  players and exits do not carry `$`-commands in v1 (decisions.md). */
export function dollarCandidates(snap: WorldSnapshot, actorId: string): SnapObject[] {
  const me = snap.objects.get(actorId);
  if (!me) return [];
  const out: SnapObject[] = [];
  const room = me.locationId ? snap.objects.get(me.locationId) : undefined;
  if (room && room.type === "room") out.push(room);
  const coLocated: SnapObject[] = [];
  const inventory: SnapObject[] = [];
  for (const o of snap.objects.values()) {
    if (o.type !== "thing") continue;
    if (room && o.locationId === room.id) coLocated.push(o);
    else if (o.locationId === actorId) inventory.push(o);
  }
  out.push(...coLocated.sort(byDbref), ...inventory.sort(byDbref));
  return out;
}

/** Parse a `$pattern:program` attribute value; null when it isn't one. */
export function parseDollarValue(value: string): { pattern: string; program: string } | null {
  if (!value.startsWith("$")) return null;
  const colon = value.indexOf(":", 1);
  if (colon === -1) return null;
  const pattern = value.slice(1, colon).trim();
  const program = value.slice(colon + 1).trim();
  if (pattern === "" || program === "") return null;
  return { pattern, program };
}

/**
 * Scan the actor's neighborhood for a `$`-command matching the typed line.
 * FIRST deterministic match wins (single-fire — decisions.md); attribute
 * names are visited in sorted order so the scan is stable. Match work is
 * fuel-charged per object under MATCH_STEPS_PER_OBJECT.
 */
export function matchDollarCommand(
  snap: WorldSnapshot,
  actorId: string,
  line: string,
): SoftcodeRun | null {
  const input = line.trim();
  if (input === "") return null;
  for (const obj of dollarCandidates(snap, actorId)) {
    const bag = snap.attrs.get(obj.id);
    if (!bag) continue;
    const meter = new Meter({ ...SOFTCODE_RUN_BUDGET, steps: MATCH_STEPS_PER_OBJECT });
    try {
      for (const attr of [...bag.keys()].sort()) {
        const parsed = parseDollarValue(bag.get(attr)!.value);
        if (!parsed) continue;
        const m = globMatch(parsed.pattern, input, meter);
        if (m.matched) {
          return {
            actor: obj.id,
            owner: obj.ownerId,
            objectName: obj.name,
            attr,
            program: parsed.program,
            args: m.captures,
          };
        }
      }
    } catch (err) {
      // this object's match allowance is spent (or its pattern set is
      // otherwise refused): skip IT, keep scanning the rest — fail-safe
      if (!(err instanceof RefusalSignal)) throw err;
    }
  }
  return null;
}

/**
 * Collect the event-trigger programs for a world event. For `arrive` into a
 * room: the room itself, then its co-located things by ascending dbref (the
 * arriving player and other players never fire). For `use` of an entered
 * thing: that thing only. Each program runs with the ENACTOR bound as
 * %0 = display name, %1 = object id (decisions.md).
 */
export function collectTriggers(
  snap: WorldSnapshot,
  kind: TriggerKind,
  targetId: string,
  enactor: { id: string; name: string },
): SoftcodeRun[] {
  const attrName = TRIGGER_ATTRS[kind];
  const listeners: SnapObject[] = [];
  const target = snap.objects.get(targetId);
  if (!target) return [];
  if (kind === "arrive") {
    if (target.type !== "room") return [];
    listeners.push(target);
    const things: SnapObject[] = [];
    for (const o of snap.objects.values()) {
      if (o.type === "thing" && o.locationId === target.id) things.push(o);
    }
    listeners.push(...things.sort(byDbref));
  } else {
    if (target.type !== "thing") return [];
    listeners.push(target);
  }
  const runs: SoftcodeRun[] = [];
  for (const obj of listeners) {
    const program = snap.attrs.get(obj.id)?.get(attrName)?.value;
    if (!program || program.trim() === "" || program.startsWith("$")) continue;
    runs.push({
      actor: obj.id,
      owner: obj.ownerId,
      objectName: obj.name,
      attr: attrName,
      program,
      args: [enactor.name, enactor.id],
    });
  }
  return runs;
}
