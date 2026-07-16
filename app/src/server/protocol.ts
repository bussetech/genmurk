// The wire protocol between a client and the presence server (GM-R1..R4):
// JSON messages over a WebSocket, one JSON object per WS text frame. This is
// the TRANSPORT surface only — command names/syntax a player types are parsed
// server-side (verbs.ts, pre-capture placeholders) and never travel as
// structure. Delivery is push (GM-R4): the server originates every event
// frame; a client never polls.
//
// Ordering contract: every room-scoped event carries `roomSeq`, assigned by
// the room's single writer (coordinator.ts) at fan-out. Within one room,
// every observer receives the same events in the same `roomSeq` order —
// that is the GM-R4 guarantee, and test/server/ordering.test.ts holds it.

/** Room-scoped event kinds. `arrive`/`depart` are presence (GM-R1, fired by
 *  movement/connection); `say`/`emote` are speech (GM-R2); `announce` is the
 *  privileged broadcast (GM-R3) — delivered per-room so it shares each
 *  room's ordering domain; `emit` is world-API-mediated softcode output
 *  (WorldAPI.emit — the ONLY door softcode has onto this transport). */
export type RoomEventKind = "arrive" | "depart" | "say" | "emote" | "announce" | "emit";

// ---------------------------------------------------------- client → server

/** First frame on a connection. The token is a VERIFIED credential
 *  (GENMURK-EPIC1-08, GM-R18): a Supabase Auth access-token JWT the client
 *  obtained by authenticating out of band. The server verifies it and binds
 *  the session to the linked player (supabase-gateway.ts); the 05 stub token
 *  is gone. (Stack-free transport tests present an opaque fixture-principal
 *  token instead — no world of record, no credential to verify.) */
export interface HelloMessage {
  type: "hello";
  token: string;
}

/** One typed command line (say/emote/page/…, parsed by verbs.ts). */
export interface CommandMessage {
  type: "command";
  line: string;
}

/** Self-service registration (GM-R18 open-signup posture). Sent BEFORE a
 *  hello, on a connection with no session yet: the server provisions the auth
 *  account + a base-tier player (gated by the instance registration policy),
 *  and the client then authenticates normally. `passphrase` is supplied only
 *  when the instance is in `passphrase` mode. Credentials travel here only over
 *  the (localhost-only in v1) transport; login itself never carries a password. */
export interface RegisterMessage {
  type: "register";
  name: string;
  email: string;
  password: string;
  passphrase?: string;
}

export type ClientMessage = HelloMessage | CommandMessage | RegisterMessage;

// ---------------------------------------------------------- server → client

/** Successful hello: who you are, where you are, who is here. */
export interface WelcomeMessage {
  type: "welcome";
  player: { id: string; name: string };
  room: { id: string; name: string };
  occupants: string[];
}

/** Successful registration: the new player exists — authenticate to enter. */
export interface RegisteredMessage {
  type: "registered";
  player: { id: string; name: string };
}

/** A room-scoped event — the ordered stream. */
export interface RoomEventMessage {
  type: "event";
  room: string;
  /** per-room monotonic sequence, assigned by the room's single writer */
  roomSeq: number;
  kind: RoomEventKind;
  actor: string;
  actorName: string;
  text: string;
}

/** A directed cross-room message (page/whisper, GM-R3). Single-recipient, so
 *  it needs no shared ordering domain. */
export interface DirectedMessage {
  type: "message";
  kind: "page" | "whisper";
  from: string;
  fromName: string;
  text: string;
}

/** Non-event information (look output, confirmations). */
export interface InfoMessage {
  type: "info";
  text: string;
}

export interface ErrorMessage {
  type: "error";
  code:
    | "AUTH_FAILED"
    | "NOT_AUTHENTICATED"
    // self-service registration (GM-R18 open-signup): the gate refused
    // (closed instance / wrong passphrase), provisioning failed, or the
    // backing store does not support registration (stack-free fixture)
    | "REGISTRATION_REFUSED"
    | "REGISTRATION_FAILED"
    | "REGISTRATION_UNSUPPORTED"
    | "BAD_MESSAGE"
    | "UNKNOWN_COMMAND"
    | "NO_SUCH_EXIT"
    | "NO_SUCH_PLAYER"
    | "PERMISSION_DENIED"
    | "MOVE_REFUSED"
    // building/movement command layer (GENMURK-EPIC1-06)
    | "LOCKED"
    | "NO_SUCH_TARGET"
    | "AMBIGUOUS_TARGET"
    | "NO_SUCH_ROOM"
    | "BUILD_FAILED"
    // softcode in the world (GENMURK-EPIC1-07): a matched `$`-command's run
    // was refused by the sandbox — a typed budget/permission refusal is a
    // VALUE reported to the typist, never a crash (GM-R14)
    | "SOFTCODE_REFUSED"
    // the faithful layer (GENMURK-EPIC1-09): mail (GM-R17), moderation
    // (GM-R16), recoverable destruction (GM-R9)
    | "MAILBOX_FULL"
    | "NO_SUCH_MAIL"
    | "SILENCED"
    | "MODERATION_REFUSED";
  text: string;
}

export type ServerMessage =
  | WelcomeMessage
  | RegisteredMessage
  | RoomEventMessage
  | DirectedMessage
  | InfoMessage
  | ErrorMessage;

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (m["type"] === "hello" && typeof m["token"] === "string") {
    return { type: "hello", token: m["token"] };
  }
  if (m["type"] === "command" && typeof m["line"] === "string") {
    return { type: "command", line: m["line"] };
  }
  if (
    m["type"] === "register" &&
    typeof m["name"] === "string" &&
    typeof m["email"] === "string" &&
    typeof m["password"] === "string" &&
    (m["passphrase"] === undefined || typeof m["passphrase"] === "string")
  ) {
    return {
      type: "register",
      name: m["name"],
      email: m["email"],
      password: m["password"],
      ...(typeof m["passphrase"] === "string" ? { passphrase: m["passphrase"] } : {}),
    };
  }
  return null;
}
