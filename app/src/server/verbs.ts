// PLAYER-FACING VERBS (GM-R22) — the capture has LANDED.
//
// The canonical TinyMUSE/MicroMUSE command capture (genmurk#9) is now DATA in
// app/gm-r22/command-surface.yml, and the conformance harness measures this
// parser against it. So the verb names and invocation forms below are no
// longer placeholders drawn only from GM-Rn vocabulary — they are the faithful
// player-facing surface, reconciled against the reference (GENMURK-EPIC2-02).
// Two reconciliations the capture forced, decided and recorded (decisions.md /
// /compatibility/):
//   - The reference PREFIXES its building/admin verbs with `@` (@dig, @open,
//     @create, @describe, @name, @set, @lock, @destroy, @undestroy, @announce)
//     and its mail command with `+` (+mail). GenMURK accepts the FAITHFUL
//     prefixed form for every verb it implements (normalized below) and ALSO
//     keeps the bare form as a documented convenience — a prefixed verb it
//     does NOT reproduce (e.g. @nuke, a wizard server-control command) falls
//     through to `unknown`, like any unclaimed line.
//   - The reference speech verb is `pose` with the single-character tokens
//     `"` → say, `:`/`;` → pose; GenMURK accepts `pose` and those tokens as
//     the faithful surface and keeps `emote` as a convenience alias (they
//     share one speech path). The `;` no-space possessive nuance is a recorded
//     minor divergence.
// The MECHANICS (room fan-out, world-of-record mutation, name matching, lock
// gating, moderation audit) are GenMURK's own clean-room code and the
// interpreter/security model are modernized (GM-R11 / GM-R14); where a
// reference command would conflict with the sandbox the safe behavior wins and
// the divergence is recorded on its surface entry. The remaining reference
// commands (the wizard/god `@`-administration set, channels, economy) are out
// of the GM-R22 player-facing bar and accounted for in command-surface.yml —
// they are not reproduced as in-world verbs (server control is dev-tier ops,
// GM-R19, and the Studio Portal).
//
// Argument punctuation: verbs that take a target plus a payload use `=` as the
// separator (`@open north = Kitchen`, `mail Bob = hi`) so target names may
// contain spaces — the reference's building-verb separator, kept.

export type LockKind = "enter" | "use" | "pickup";

/** Mail sub-commands (GM-R17). Send always carries a `=`; the bare/list/read/
 *  delete forms have none, which is how the parser tells them apart. Subject
 *  lines are a capture question, so v1 mail is body-only from the command line
 *  (the RPC/API carries a subject for later). */
export type MailAction =
  | { kind: "send"; target: string; subject: string; body: string }
  | { kind: "list" }
  | { kind: "read"; n: number }
  | { kind: "delete"; n: number };

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
  // observing (GM-R1/R6): look at the room or a target; examine a target's
  // full detail; list your own inventory (GENMURK-EPIC2-02 gap fill)
  | { verb: "look"; target?: string }
  | { verb: "examine"; target: string }
  | { verb: "inventory" }
  // presence roster (GM-R1): who is connected server-wide (GENMURK-EPIC2-02)
  | { verb: "who" }
  // containment: take a thing from the room / drop it back (GM-R6 + pickup lock GM-R8)
  | { verb: "get"; target: string }
  | { verb: "drop"; target: string }
  // building (GM-R7) + locks (GM-R8)
  | { verb: "dig"; name: string }
  | { verb: "open"; exit: string; dest: string }
  | { verb: "create"; name: string }
  | { verb: "set"; target: string; attr: string; value: string }
  | { verb: "name"; target: string; newName: string }
  | { verb: "describe"; target: string; text: string }
  | { verb: "lock"; target: string; lock: LockKind; expr: string }
  // recoverable destruction (GM-R9)
  | { verb: "destroy"; target: string }
  | { verb: "undestroy"; target: string }
  // in-world mail (GM-R17)
  | { verb: "mail"; mail: MailAction }
  // moderation (GM-R16)
  | { verb: "warn"; target: string; reason: string }
  | { verb: "boot"; target: string; reason: string }
  | { verb: "silence"; target: string; minutes: number | null }
  | { verb: "unsilence"; target: string }
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
  | "look" // observe the room or a target (GM-R1 presence surface)
  | "inspect" // examine/inventory — detail of a thing or your own carry (GM-R1)
  | "roster" // who — the server-wide connected-player list (GM-R1)
  | "interact" // use — activate a thing (fires its use-trigger); a capture gap
  | "containment" // get/drop — take a thing from / return it to the room (GM-R6/R8)
  | "build" // dig/open/create/set/name/describe/lock — world mutation (GM-R7/R8)
  | "lifecycle" // destroy/undestroy — recoverable destruction (GM-R9)
  | "mail" // in-world mail between players (GM-R17)
  | "moderation" // warn/boot/silence/unsilence — admin tooling (GM-R16)
  | "session"; // quit

/** Split a "target = payload" line on the FIRST `=`. Returns null when there
 *  is no separator. Target keeps its internal spaces (so "brass lantern"
 *  resolves as one name). */
function splitAssign(rest: string): { left: string; right: string } | null {
  const eq = rest.indexOf("=");
  if (eq === -1) return null;
  return { left: rest.slice(0, eq).trim(), right: rest.slice(eq + 1).trim() };
}

/** Parse the mail sub-command from the arguments after `mail`. */
function parseMail(rest: string): ParsedCommand {
  const trimmed = rest.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "list") {
    return { verb: "mail", mail: { kind: "list" } };
  }
  const space = trimmed.indexOf(" ");
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const tail = space === -1 ? "" : trimmed.slice(space + 1).trim();
  // `mail read <n>` / `mail delete <n>` — reserved sub-commands (a message index)
  if ((head === "read" || head === "delete") && !trimmed.includes("=")) {
    const n = Number.parseInt(tail, 10);
    if (!Number.isInteger(n) || n < 1) return { verb: "unknown", input: `mail ${trimmed}` };
    return { verb: "mail", mail: head === "read" ? { kind: "read", n } : { kind: "delete", n } };
  }
  // `mail <recipient> = <body>` — send (subject is a capture question, empty in v1)
  const parts = splitAssign(trimmed);
  if (!parts || parts.left === "" || parts.right === "") {
    return { verb: "unknown", input: `mail ${trimmed}` };
  }
  return { verb: "mail", mail: { kind: "send", target: parts.left, subject: "", body: parts.right } };
}

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.trim();
  if (trimmed === "") return { verb: "empty" };

  // GM-R22 single-character speech tokens (no space required after the sigil):
  // `"` → say, `:` → pose, `;` → pose (no-space possessive form). Handled
  // before the word split because `"hi` / `:waves` carry no separator.
  const sigil = trimmed[0];
  if (sigil === '"') {
    const t = trimmed.slice(1).trim();
    return t === "" ? { verb: "empty" } : { verb: "say", text: t };
  }
  if (sigil === ":" || sigil === ";") {
    const t = trimmed.slice(1).trim();
    return t === "" ? { verb: "empty" } : { verb: "emote", text: t };
  }

  const space = trimmed.indexOf(" ");
  const raw = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

  // GM-R22 faithful forms: accept the reference's `@`-prefixed building/admin
  // verbs and `+mail` for every verb GenMURK implements; bare forms are kept
  // as documented conveniences. An unimplemented prefixed verb normalizes to a
  // word no case claims and falls through to `unknown` (an honest gap).
  const head = raw === "+mail" ? "mail" : raw.startsWith("@") ? raw.slice(1) : raw;

  switch (head) {
    // --- speech (GM-R2) — `pose` is the faithful name, `emote` a convenience ---
    case "say":
      return rest === "" ? { verb: "empty" } : { verb: "say", text: rest };
    case "pose":
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

    // --- movement (GM-R6) — `goto`/`move` are faithful aliases of `go` ---
    case "go":
    case "goto":
    case "move":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "go", exit: rest };
    case "enter":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "enter", target: rest };
    case "leave":
      return { verb: "leave" };

    // --- observing (GM-R1/R6): look [<target>], examine <target>, inventory --
    // `look` alone observes the room; `look <thing>` / `read <thing>` shows a
    // target's description; `read` is the reference's undocumented look alias.
    case "look":
    case "read":
      return rest === "" ? { verb: "look" } : { verb: "look", target: rest };
    case "l":
      return { verb: "look" };
    case "examine":
    case "ex":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "examine", target: rest };
    case "inventory":
    case "inv":
    case "i":
      return { verb: "inventory" };
    case "who":
      return { verb: "who" };

    // --- containment (GM-R6 + pickup lock GM-R8) ---
    case "get":
    case "take":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "get", target: rest };
    case "drop":
    case "throw":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "drop", target: rest };

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

    // --- recoverable destruction (GM-R9) ---
    case "destroy":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "destroy", target: rest };
    case "undestroy":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "undestroy", target: rest };

    // --- in-world mail (GM-R17) ---
    case "mail":
      return parseMail(rest);

    // --- moderation (GM-R16) ---
    case "warn":
    case "boot": {
      if (rest === "") return { verb: "unknown", input: trimmed };
      const parts = splitAssign(rest);
      const target = parts ? parts.left : rest;
      const reason = parts ? parts.right : "";
      if (target === "") return { verb: "unknown", input: trimmed };
      return { verb: head, target, reason };
    }
    case "silence": {
      if (rest === "") return { verb: "unknown", input: trimmed };
      const parts = splitAssign(rest);
      if (!parts) return { verb: "silence", target: rest, minutes: null };
      if (parts.left === "") return { verb: "unknown", input: trimmed };
      const m = Number.parseInt(parts.right, 10);
      return { verb: "silence", target: parts.left, minutes: Number.isInteger(m) && m > 0 ? m : null };
    }
    case "unsilence":
      return rest === "" ? { verb: "unknown", input: trimmed } : { verb: "unsilence", target: rest };

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
    case "examine":
    case "inventory":
      return "inspect";
    case "who":
      return "roster";
    case "get":
    case "drop":
      return "containment";
    case "dig":
    case "open":
    case "create":
    case "set":
    case "name":
    case "describe":
    case "lock":
      return "build";
    case "destroy":
    case "undestroy":
      return "lifecycle";
    case "mail":
      return "mail";
    case "warn":
    case "boot":
    case "silence":
    case "unsilence":
      return "moderation";
    case "quit":
      return "session";
    case "unknown":
    case "empty":
      return null;
  }
}
