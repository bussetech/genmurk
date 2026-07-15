// PRE-CAPTURE PLACEHOLDER VERBS (GM-R22) — read this before renaming
// anything. The player-facing command surface GenMURK ships is the
// TinyMUSE/MicroMUSE reference command set, which arrives as DATA from the
// airgapped preservation capture (genmurk#9); it is NOT enumerated in this
// repo yet, and inventing it from model memory of MUSH-family systems is the
// clean-room/provenance line in one. So the verb names and syntax below are
// working placeholders drawn ONLY from the vocabulary the requirements of
// record themselves use (decomposition.md GM-R2/GM-R3: "say", "emote",
// "page", "whisper", "announce") plus plain English (`go`, `look`, `quit`).
// The MECHANICS behind them (room fan-out, directed delivery, gated
// broadcast, channel switch) are this prompt's deliverable and survive the
// capture; the surfaces finalize under GM-R22 in later prompts, dropped in
// as data against the compatibility harness.

export type ParsedCommand =
  | { verb: "say"; text: string }
  | { verb: "emote"; text: string }
  | { verb: "page"; target: string; text: string }
  | { verb: "whisper"; target: string; text: string }
  | { verb: "announce"; text: string }
  | { verb: "go"; exit: string }
  | { verb: "look" }
  | { verb: "quit" }
  | { verb: "unknown"; input: string }
  | { verb: "empty" };

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.trim();
  if (trimmed === "") return { verb: "empty" };
  const space = trimmed.indexOf(" ");
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

  switch (head) {
    case "say":
      if (rest === "") return { verb: "empty" };
      return { verb: "say", text: rest };
    case "emote":
      if (rest === "") return { verb: "empty" };
      return { verb: "emote", text: rest };
    case "page":
    case "whisper": {
      const s = rest.indexOf(" ");
      if (s === -1) return { verb: "unknown", input: trimmed };
      return { verb: head, target: rest.slice(0, s), text: rest.slice(s + 1).trim() };
    }
    case "announce":
      if (rest === "") return { verb: "empty" };
      return { verb: "announce", text: rest };
    case "go":
      if (rest === "") return { verb: "unknown", input: trimmed };
      return { verb: "go", exit: rest };
    case "look":
      return { verb: "look" };
    case "quit":
      return { verb: "quit" };
    default:
      return { verb: "unknown", input: trimmed };
  }
}
