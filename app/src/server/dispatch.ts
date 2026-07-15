// The command dispatch pipeline (GM-R6/R7/R12) — the player's hands.
//
//   player input → parseCommand (verbs.ts) → THIS dispatcher →
//     • presence/speech → the coordinator's ordering domain (05)
//     • building/movement → the world of record via the gateway (RPCs)
//     • movement additionally → coordinator.moveSession so presence fires
//
// THE BUDGET BOUNDARY (GM-R14). Built-in verbs are ORDINARY CODE and are
// budget-free: dig/open/create/set/name/describe/lock/go/enter/leave/look run
// as plain server logic with no fuel meter, because they are not untrusted
// input — the player typed a fixed verb the server implements. Only SOFTCODE
// is fuel-metered: a `$`-command (prompt 07) will match here and hand its
// program to the sandboxed engine (engine.run, budgeted), whose output reaches
// the transport ONLY through the world-API-mediated door (routeEmits in
// server.ts). This dispatcher never touches the engine and never holds fuel;
// keeping the two paths visibly separate is the point. When 07 adds
// `$`-command matching it slots in as one more branch that — unlike every
// branch here — runs metered.
//
// This module is transport-agnostic: it takes a `send` sink and a `disconnect`
// signal, so the same pipeline is exercised by the stack-free dispatch tests
// (a recording sink + FixtureGateway) and by the live WS server (server.ts).

import type { RoomCoordinator } from "./coordinator.ts";
import type { WorldGateway } from "./gateway.ts";
import type { ServerMessage } from "./protocol.ts";
import { parseCommand } from "./verbs.ts";

export interface DispatchDeps {
  coordinator: RoomCoordinator;
  gateway: WorldGateway;
  sessionId: string;
  send(msg: ServerMessage): void;
  disconnect(): void;
}

/** Run one already-authenticated command line. Awaits any world-of-record
 *  round trip so a `say` typed after a `go` lands in the destination room
 *  (server.ts serializes a session's lines through a promise chain). */
export async function dispatch(deps: DispatchDeps, line: string): Promise<void> {
  const { coordinator, gateway, sessionId, send } = deps;
  const cmd = parseCommand(line);

  const playerId = (): string | null => coordinator.session(sessionId)?.playerId ?? null;

  switch (cmd.verb) {
    case "empty":
      return;

    // --- speech (GM-R2) ---
    case "say":
    case "emote":
      coordinator.speak(sessionId, cmd.verb, cmd.text);
      return;

    // --- directed / broadcast (GM-R3) ---
    case "page":
    case "whisper": {
      const delivered = coordinator.direct(sessionId, cmd.verb, cmd.target, cmd.text);
      if (!delivered) {
        send({ type: "error", code: "NO_SUCH_PLAYER", text: `${cmd.target} is not connected` });
      } else {
        send({ type: "info", text: `(${cmd.verb} to ${cmd.target}) ${cmd.text}` });
      }
      return;
    }
    case "announce": {
      if (coordinator.announce(sessionId, cmd.text) === "denied") {
        send({ type: "error", code: "PERMISSION_DENIED", text: "announce is a privileged act" });
      }
      return;
    }

    // --- movement (GM-R6) — world of record decides, coordinator fires presence ---
    case "go": {
      const pid = playerId();
      if (!pid) return;
      const moved = await gateway.move(pid, cmd.exit);
      if (!moved.ok) return send({ type: "error", code: moved.code, text: moved.reason });
      coordinator.moveSession(sessionId, moved.roomId, moved.roomName);
      send({ type: "info", text: roomLine(moved.roomName, coordinator.occupants(moved.roomId)) });
      return;
    }
    case "enter": {
      const pid = playerId();
      if (!pid) return;
      const moved = await gateway.enter(pid, cmd.target);
      if (!moved.ok) return send({ type: "error", code: moved.code, text: moved.reason });
      coordinator.moveSession(sessionId, moved.roomId, moved.roomName);
      send({ type: "info", text: roomLine(moved.roomName, coordinator.occupants(moved.roomId)) });
      return;
    }
    case "leave": {
      const pid = playerId();
      if (!pid) return;
      const moved = await gateway.leave(pid);
      if (!moved.ok) return send({ type: "error", code: moved.code, text: moved.reason });
      coordinator.moveSession(sessionId, moved.roomId, moved.roomName);
      send({ type: "info", text: roomLine(moved.roomName, coordinator.occupants(moved.roomId)) });
      return;
    }
    case "look": {
      const pid = playerId();
      if (!pid) return;
      const view = await gateway.look(pid);
      const s = coordinator.session(sessionId);
      if (!view) {
        if (s) send({ type: "info", text: roomLine(s.roomName, coordinator.occupants(s.roomId)) });
        return;
      }
      send({ type: "info", text: renderLook(view, coordinator.occupants(view.roomId)) });
      return;
    }

    // --- building (GM-R7) + locks (GM-R8) ---
    case "dig": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.dig(pid, cmd.name);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Dug ${r.name} (${r.id}).` });
      return;
    }
    case "open": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.open(pid, cmd.exit, cmd.dest);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Opened exit ${r.name} (${r.id}) to ${cmd.dest}.` });
      return;
    }
    case "create": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.create(pid, cmd.name);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Created ${r.name} (${r.id}).` });
      return;
    }
    case "set": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.setAttr(pid, cmd.target, cmd.attr, cmd.value);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Set ${cmd.attr.toUpperCase()} on ${r.targetName}.` });
      return;
    }
    case "name": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.rename(pid, cmd.target, cmd.newName);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Renamed to ${cmd.newName}.` });
      return;
    }
    case "describe": {
      const pid = playerId();
      if (!pid) return;
      // `describe` is sugar over setting the DESCRIBE attribute.
      const r = await gateway.setAttr(pid, cmd.target, "DESCRIBE", cmd.text);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Described ${r.targetName}.` });
      return;
    }
    case "lock": {
      const pid = playerId();
      if (!pid) return;
      const r = await gateway.setLock(pid, cmd.target, cmd.lock, cmd.expr);
      if (!r.ok) return send({ type: "error", code: r.code, text: r.reason });
      send({ type: "info", text: `Locked ${r.targetName} (${cmd.lock}).` });
      return;
    }

    // --- control ---
    case "quit":
      deps.disconnect();
      return;
    case "unknown":
      send({ type: "error", code: "UNKNOWN_COMMAND", text: `unknown command: ${cmd.input}` });
      return;
  }
}

function roomLine(roomName: string, occupants: string[]): string {
  return `${roomName} — here: ${occupants.join(", ")}`;
}

function renderLook(
  view: { roomName: string; description: string; exits: string[]; contents: string[] },
  occupants: string[],
): string {
  const lines = [view.roomName];
  if (view.description) lines.push(view.description);
  if (view.contents.length) lines.push(`Contents: ${view.contents.join(", ")}`);
  if (view.exits.length) lines.push(`Exits: ${view.exits.join(", ")}`);
  lines.push(`Here: ${occupants.join(", ")}`);
  return lines.join("\n");
}
