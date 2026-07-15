// Styled output (GM-R13) — the markup vocabulary, the transport sanitizer,
// and the renderer. GENMURK-EPIC1-07.
//
// THE MODEL, in one line: style travels as INERT MARKUP TOKENS on the wire;
// escape bytes exist only on the far side of the renderer's fixed table.
//
//   softcode ──out.style──▶ [[spec]]text[[/]]   (engine validates spec shape)
//        │
//        ▼ wire (JSON over WS)                  every outbound text field is
//          markup tokens only, NEVER ESC        control-stripped (this module)
//        │
//        ▼ client renderer                      tokens → SGR from a FIXED
//          ANSI appears here and only here      table; unknown tokens dropped
//
// The transcript-sanitizer discipline (ADR-0025 class) applied to
// player-generated output: player text can INFLUENCE presentation only
// through the vocabulary below, and can never carry raw terminal control
// bytes into another player's client — not from softcode, not from a typed
// line, not from an attribute value written through an RPC. The sanitizer
// runs at the ONE outbound door (server send), so every path is covered by
// construction rather than by remembering.
//
// The vocabulary is deliberately small (ANSI-class semantics per GM-R13:
// emphasis + the classic 8 colors, modern encoding = tokens over JSON, SGR
// only at the terminal): bold, dim, underline, color:<name>. Growing it is a
// data change here and in the renderer table — never a pass-through.

export const STYLE_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

/** SGR codes for the fixed vocabulary — the ONLY escape bytes the renderer
 *  can produce. Nothing in this table is derived from player input. */
const SGR: Record<string, string> = {
  bold: "1",
  dim: "2",
  underline: "4",
  ...Object.fromEntries(STYLE_COLORS.map((c, i) => [`color:${c}`, String(30 + i)])),
};

export function isKnownSpec(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(SGR, spec);
}

/** Styles may nest this deep; further opens are dropped tokens (neutralized). */
export const MAX_STYLE_DEPTH = 16;

// Control characters that must never reach a client: C0 except \n and \t,
// DEL, and the C1 range (0x80-0x9F, which includes 8-bit CSI).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;

/** Strip raw control bytes from text. Deletion, not replacement: a stripped
 *  escape must not leave a marker an attacker can build a second payload
 *  around. \n and \t survive (legitimate in look output). */
export function sanitizeText(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

/** Sanitize every string field of an outbound message, recursively — the one
 *  outbound door (server send / test sinks) runs ALL frames through this, so
 *  no future message type can forget the boundary. */
export function sanitizeOutbound<T>(msg: T): T {
  if (typeof msg === "string") return sanitizeText(msg) as unknown as T;
  if (Array.isArray(msg)) return msg.map((v) => sanitizeOutbound(v)) as unknown as T;
  if (msg !== null && typeof msg === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(msg as Record<string, unknown>)) {
      out[k] = sanitizeOutbound(v);
    }
    return out as T;
  }
  return msg;
}

// A token is exactly [[spec]] or [[/]] — token-shaped substrings that name an
// unknown spec are DROPPED (neutralized, their inner text unaffected); text
// that merely resembles a token (e.g. a literal "[[hello world]]") is not
// token-shaped and passes through as plain text.
const TOKEN = /\[\[(\/|[a-z][a-z0-9:,-]{0,31})\]\]/g;

/**
 * Render markup to a terminal string. `ansi: false` strips tokens (plain
 * transcript); `ansi: true` maps known specs to SGR from the fixed table,
 * recomputing state on close so nesting behaves, and always resets at the
 * end — a styled line can never bleed into the next.
 */
export function renderMarkup(text: string, opts: { ansi: boolean }): string {
  const clean = sanitizeText(text); // defense in depth below the wire boundary
  const stack: string[] = [];
  let out = "";
  let last = 0;
  const apply = (): string => (stack.length ? `\u001b[${stack.join(";")}m` : "");
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(clean); m; m = TOKEN.exec(clean)) {
    out += clean.slice(last, m.index);
    last = m.index + m[0].length;
    const spec = m[1]!;
    if (spec === "/") {
      if (stack.length > 0) {
        stack.pop();
        if (opts.ansi) out += `\u001b[0m${apply()}`;
      }
      // an unmatched close is a dropped token
      continue;
    }
    if (isKnownSpec(spec) && stack.length < MAX_STYLE_DEPTH) {
      stack.push(SGR[spec]!);
      if (opts.ansi) out += `\u001b[${SGR[spec]!}m`;
    }
    // unknown spec / beyond the nesting cap: dropped token
  }
  out += clean.slice(last);
  if (opts.ansi && stack.length > 0) out += "\u001b[0m";
  return out;
}
