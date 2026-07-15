// PRE-CAPTURE PLACEHOLDER VERBS (GM-R22) — read this before renaming
// anything. The player-facing command surface GenMURK ships is the
// TinyMUSE/MicroMUSE reference command set, which arrives as DATA from the
// airgapped preservation capture (genmurk#9); it is NOT enumerated in this
// repo yet, and inventing it from model memory of MUSH-family systems is the
// clean-room/provenance line in one. So the verb names and syntax below are
// working placeholders drawn ONLY from the vocabulary the requirements of
// record themselves use:
//   - GM-R2/GM-R3 name "say", "emote", "page", "whisper", "announce";
//   - GM-R7 names the building verbs "dig", "open", "create", "set", "name",
//     "describe";
//   - GM-R6 names movement — "movement updates location and fires presence";
//     the plain-English "go"/"enter"/"leave" express exit traversal and
//     containment moves;
//   - GM-R8 names the lock kinds "use", "entry" (→ enter), "pickup";
//   - GM-R12 names the resolution keywords "me", "here", partial names,
//     "#dbref";
//   - plus plain English (`look`, `quit`).
// The MECHANICS behind them (room fan-out, world-of-record mutation, name
// matching, lock gating) are this prompt's deliverable and survive the
// capture; the SURFACES (exact names, any `@`-prefix or `/switch` convention
// the reference used, argument punctuation) finalize under GM-R22 in later
// prompts, dropped in as data against the compatibility harness in
// app/gm-r22/. Not a single name here comes from memory of the wider MUSH
// family — that is the clean-room line, and the GM-R22 harness reports every
// one of these as a PROVISIONAL entry until the capture confirms it.
//
// Argument punctuation note (provisional): building verbs that take a target
// plus a payload use `=` as the separator (`open north = Kitchen`,
// `set lantern = desc:brass`) so target names may contain spaces; the exact
// reference punctuation is a capture question, tracked as a divergence-class
// entry in the harness, not asserted here.

export type LockKind = "enter" | "use" | "pickup";

export type ParsedCommand =
  // presence & speech (GENMURK-EPIC1-05)
  | { verb: "say"; text: string }
  | { verb: "emote"; text: string }
  | { verb: "page"; target: string; text: string }
  | { verb: "whisper"; target: string; text: string }
  | { verb: "announce"; text: string }
  // movement (GM-R6)
  | { verb: "go"; exit: string }
  | { verb: "enter"; target: string }
  | { verb: "leave" }
  | { verb: "look" }
  // building (GM-R7) + locks (GM-R8)
  | { verb: "dig"; name: string }
  | { verb: "open"; exit: string; dest: string }
  | { verb: "create"; name: string }
  | { verb: "set"; target: string; attr: string; value: string }
  | { verb: "name"; target: string; newName: string }
  | { verb: "describe"; target: string; text: string }
  | { verb: "lock"; target: string; lock: LockKind; expr: string }
  // control
  | { verb: "quit" }
  | { verb: "unknown"; input: string }
  | { verb: "empty" };

/** The behavior class a verb belongs to — the axis the GM-R22 conformance
 *  runner asserts against (a canonical command must resolve to the RIGHT class,
 *  not merely parse). Kept here so the surface and its classification live in
 *  one file. */
export type BehaviorClass =
  | "speech" // say/emote — room-scoped (GM-R2)
  | "directed" // page/whisper — cross-room (GM-R3)
  | "broadcast" // announce — privileged (GM-R3)
  | "movement" // go/enter/leave — location change + presence (GM-R6)
  | "look" // observe the room (GM-R1 presence surface)
  | "build" // dig/open/create/set/name/describe/lock — world mutation (GM-R7/R8)
  | "session"; // quit

/** Split a "target = payload" line on the FIRST `=`. Returns null when there
 *  is no separator. Target keeps its internal spaces (so "brass lantern"
 *  resolves as one name). */
function splitAssign(rest: string): { left: string; right: string } | null {
  const eq = rest.indexOf("=");
  if (eq === -1) return null;
  return { left: rest.slice(0, eq).trim(), right: rest.slice(eq + 1).trim() };
}

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.trim();
  if (trimmed === "") return { verb: "empty" };
  const space = trimmed.indexOf(" ");
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

  switch (head) {
    // --- speech (GM-R2) ---
    case "say":
      return rest === "" ? { verb: "empty" } : { verb: "say", text: rest };
    case "emote":
      return rest === "" ? { verb: "empty" } : { verb: "emote", text: rest };

    // --- directed / broadcast (GM-R3) ---
    case "page":
    case "whisper": {
      const s = rest.indexOf(" ");
      if (s === -1) return { verb: "unknown", input: trimmed };
      return { verb: head, target: rest.slice(0, s), text: rest.slice(s + 1).trim() };
    }
    case "announce":
      return rest === "" ? { verb: "empty" } : { verb: "announce", text: rest };

    // --- movement (GM-R6) ---
    case "go":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "go", exit: rest };
    case "enter":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "enter", target: rest };
    case "leave":
      return { verb: "leave" };
    case "look":
      return { verb: "look" };

    // --- building (GM-R7) ---
    case "dig":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "dig", name: rest };
    case "open": {
      // open <ExitName> = <DestRoomToken>
      const parts = splitAssign(rest);
      if (!parts || parts.left === "" || parts.right === "") {
        return { verb: "unknown", input: trimmed };
      }
      return { verb: "open", exit: parts.left, dest: parts.right };
    }
    case "create":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "create", name: rest };
    case "set": {
      // set <target> = <ATTR>:<value>
      const parts = splitAssign(rest);
      if (!parts || parts.left === "" || parts.right === "") {
        return { verb: "unknown", input: trimmed };
      }
      const colon = parts.right.indexOf(":");
      if (colon === -1) return { verb: "unknown", input: trimmed };
      const attr = parts.right.slice(0, colon).trim();
      const value = parts.right.slice(colon + 1); // value keeps its spaces verbatim
      if (attr === "") return { verb: "unknown", input: trimmed };
      return { verb: "set", target: parts.left, attr, value };
    }
    case "name": {
      // name <target> = <NewName>
      const parts = splitAssign(rest);
      if (!parts || parts.left === "" || parts.right === "") {
        return { verb: "unknown", input: trimmed };
      }
      return { verb: "name", target: parts.left, newName: parts.right };
    }
    case "describe": {
      // describe <target> = <text>
      const parts = splitAssign(rest);
      if (!parts || parts.left === "" || parts.right === "") {
        return { verb: "unknown", input: trimmed };
      }
      return { verb: "describe", target: parts.left, text: parts.right };
    }
    case "lock": {
      // lock <type> <target> = <expr>  (type ∈ enter|use|pickup, GM-R8)
      const typeSpace = rest.indexOf(" ");
      if (typeSpace === -1) return { verb: "unknown", input: trimmed };
      const type = rest.slice(0, typeSpace).toLowerCase();
      if (type !== "enter" && type !== "use" && type !== "pickup") {
        return { verb: "unknown", input: trimmed };
      }
      const parts = splitAssign(rest.slice(typeSpace + 1).trim());
      if (!parts || parts.left === "" || parts.right === "") {
        return { verb: "unknown", input: trimmed };
      }
      return { verb: "lock", target: parts.left, lock: type, expr: parts.right };
    }

    // --- control ---
    case "quit":
      return { verb: "quit" };
    default:
      return { verb: "unknown", input: trimmed };
  }
}

/** The behavior class each parsed verb dispatches to — the GM-R22 axis. */
export function behaviorClass(verb: ParsedCommand["verb"]): BehaviorClass | null {
  switch (verb) {
    case "say":
    case "emote":
      return "speech";
    case "page":
    case "whisper":
      return "directed";
    case "announce":
      return "broadcast";
    case "go":
    case "enter":
    case "leave":
      return "movement";
    case "look":
      return "look";
    case "dig":
    case "open":
    case "create":
    case "set":
    case "name":
    case "describe":
    case "lock":
      return "build";
    case "quit":
      return "session";
    case "unknown":
    case "empty":
      return null;
  }
}
