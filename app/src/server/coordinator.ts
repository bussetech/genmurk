// The room coordinator — the transport decision's ordering mechanism made
// concrete (decision of record: decisions.md "Presence transport"; design
// record: app/docs/presence-transport.md).
//
// GM-R4 requires that message order within a room is consistent for all
// observers. The mechanism here is SINGLE-WRITER-PER-ROOM: every room-scoped
// event — speech, presence, broadcast, softcode emit — passes through one
// synchronous fan-out choke point (`roomEvent`) in one single-threaded
// coordinator, which (1) assigns the room's next monotonic `roomSeq` and
// (2) delivers to every occupant's sink in the same call, in one loop.
// Per-connection delivery is FIFO (WebSocket over TCP), so all observers of
// a room see the identical sequence. Order ACROSS rooms is deliberately
// undefined.
//
// This class is runtime-agnostic on purpose: no socket, timer, or I/O import.
// In dev it runs in-process under a Node `ws` server (server.ts); in PROD it
// is the state of a Durable-Object-class instance — a DO is a single-threaded
// actor, which preserves exactly the property the guarantee rests on. v1 is
// ONE coordinator for the whole world (rooms are logical channels inside it);
// the per-room ordering domain means sharding to one-DO-per-room later does
// not change the guarantee.
//
// Sandbox boundary (GM-R14): softcode never holds this object. Engine output
// reaches it only as already-run PendingEmits routed by the SERVER through
// `softcodeEmit` — see routeEmits in server.ts and
// test/server/sandbox-boundary.test.ts.

import type { Power } from "../world/types.ts";
import { powerRank } from "../world/types.ts";
import type { RoomEventKind, ServerMessage } from "./protocol.ts";

export interface SessionSink {
  send(msg: ServerMessage): void;
}

export interface JoinSpec {
  playerId: string;
  playerName: string;
  power: Power;
  roomId: string;
  roomName: string;
  sink: SessionSink;
}

interface Session {
  playerId: string;
  playerName: string;
  power: Power;
  roomId: string;
  roomName: string;
  sink: SessionSink;
}

export class RoomCoordinator {
  private readonly sessions = new Map<string, Session>();
  private readonly roomSeq = new Map<string, number>();

  /** Connect: bind the session, announce arrival to the room (GM-R1). */
  join(sessionId: string, spec: JoinSpec): void {
    this.sessions.set(sessionId, { ...spec });
    this.roomEvent(spec.roomId, "arrive", spec.playerId, spec.playerName, "");
  }

  /** Disconnect: departure is observable presence (GM-R1). */
  leave(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    this.roomEvent(s.roomId, "depart", s.playerId, s.playerName, "");
  }

  /** Movement = channel switch (GM-R6 presence side): depart is fanned to
   *  the old room while the mover still occupies it, then the channel
   *  switches, then arrive fans to the new room — so both rooms' streams
   *  order the transition consistently for their own observers. */
  moveSession(sessionId: string, toRoomId: string, toRoomName: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.roomEvent(s.roomId, "depart", s.playerId, s.playerName, "");
    s.roomId = toRoomId;
    s.roomName = toRoomName;
    this.roomEvent(toRoomId, "arrive", s.playerId, s.playerName, "");
  }

  /** Room-scoped speech (GM-R2): reaches exactly the current occupants. */
  speak(sessionId: string, kind: "say" | "emote", text: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    this.roomEvent(s.roomId, kind, s.playerId, s.playerName, text);
    return true;
  }

  /** Cross-room directed message (GM-R3). Delivered to every connected
   *  session of the named player; returns false if none is connected. */
  direct(
    sessionId: string,
    kind: "page" | "whisper",
    targetName: string,
    text: string,
  ): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const wanted = targetName.toLowerCase();
    let delivered = false;
    for (const t of this.sessions.values()) {
      if (t.playerName.toLowerCase() === wanted) {
        t.sink.send({ type: "message", kind, from: s.playerId, fromName: s.playerName, text });
        delivered = true;
      }
    }
    return delivered;
  }

  /** Privileged broadcast (GM-R3), gated on the capability tier — the same
   *  wizard threshold the world model uses. This check is the capability
   *  model's HOOK; prompt 08 replaces the stub session binding that feeds
   *  `power`, not this gate. Delivered per-room so each room's stream stays
   *  totally ordered. */
  announce(sessionId: string, text: string): "ok" | "denied" {
    const s = this.sessions.get(sessionId);
    if (!s) return "denied";
    if (powerRank(s.power) < powerRank("wizard")) return "denied";
    const rooms = new Set<string>();
    for (const t of this.sessions.values()) rooms.add(t.roomId);
    for (const room of rooms) {
      this.roomEvent(room, "announce", s.playerId, s.playerName, text);
    }
    return "ok";
  }

  /** World-API-mediated softcode output (WorldAPI.emit → PendingEmit →
   *  server routeEmits → here). The single door engine output has onto the
   *  transport; it enters the room's ordering domain like any speech. */
  softcodeEmit(roomId: string, actorId: string, actorName: string, text: string): void {
    this.roomEvent(roomId, "emit", actorId, actorName, text);
  }

  /** Who is here (GM-R1 presence, look/welcome). */
  occupants(roomId: string): string[] {
    const names: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.roomId === roomId) names.push(s.playerName);
    }
    return names.sort();
  }

  session(sessionId: string): Readonly<Session> | undefined {
    return this.sessions.get(sessionId);
  }

  // ------------------------------------------------------------- mechanism

  /** THE choke point: one writer per room assigns `roomSeq` and fans out in
   *  the same synchronous pass. Every property the ordering test asserts
   *  lives in these few lines. */
  private roomEvent(
    roomId: string,
    kind: RoomEventKind,
    actorId: string,
    actorName: string,
    text: string,
  ): void {
    const seq = (this.roomSeq.get(roomId) ?? 0) + 1;
    this.roomSeq.set(roomId, seq);
    const msg: ServerMessage = {
      type: "event",
      room: roomId,
      roomSeq: seq,
      kind,
      actor: actorId,
      actorName,
      text,
    };
    for (const s of this.sessions.values()) {
      if (s.roomId === roomId) s.sink.send(msg);
    }
  }
}
