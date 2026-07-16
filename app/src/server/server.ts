// The dev connection layer: WebSocket server binding the transport decision
// together — coordinator (ordering/fan-out) + gateway (world of record) +
// verbs (pre-capture command surface). LOCALHOST ONLY by guardrail: the
// sandbox gate (GM-R14) means nothing is hosted, exposed, tunneled, or
// demoed beyond localhost; this binds 127.0.0.1 explicitly and PROD's
// Durable-Object-class home is an EPIC5 matter (dependency register).
//
// `ws` is the DEV harness's server library only — on Workers-class compute
// the platform-native WebSocket API replaces it (the coordinator is the
// portable piece; this file is the disposable one).
//
// Per-session commands are handled through a promise chain so one client's
// commands apply in the order typed even when a command awaits the world of
// record (a `say` typed after a `go` must land in the destination room).

import { createServer } from "node:http";
import process from "node:process";
import { WebSocketServer, type WebSocket } from "ws";
import { createEngine } from "../engine/engine.ts";
import type { PendingEmit } from "../world/world-api.ts";
import { RoomCoordinator } from "./coordinator.ts";
import type { WorldGateway } from "./gateway.ts";
import { parseClientMessage, type ServerMessage } from "./protocol.ts";
import { dispatch } from "./dispatch.ts";
import { sanitizeOutbound } from "./style.ts";
import { SupabaseGateway } from "./supabase-gateway.ts";

export interface ServerHandle {
  port: number;
  coordinator: RoomCoordinator;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** 0 = ephemeral (tests); default 8787 */
  port?: number;
}

/** World-API-mediated softcode output → the transport. The ONLY door: a run's
 *  buffered PendingEmits (WorldAPI.emit) are routed by the SERVER, after the
 *  run, into each room's ordering domain. The engine never sees a socket,
 *  a coordinator, or this function (test/server/sandbox-boundary.test.ts). */
export function routeEmits(
  coordinator: RoomCoordinator,
  emits: readonly PendingEmit[],
  nameOf: (id: string) => string,
): void {
  for (const e of emits) {
    if (e.roomId === null) continue;
    coordinator.softcodeEmit(e.roomId, e.actorId, nameOf(e.actorId), e.text);
  }
}

export async function startServer(
  gateway: WorldGateway,
  options: ServerOptions = {},
): Promise<ServerHandle> {
  const coordinator = new RoomCoordinator();
  // the sandboxed softcode engine — production build, NO instrumentation
  // (t.* test functions exist only under the proof harness)
  const engine = createEngine();
  const httpServer = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("genmurk dev server: WebSocket only\n");
  });
  const wss = new WebSocketServer({ server: httpServer });
  let nextSession = 0;

  wss.on("connection", (socket: WebSocket) => {
    const sessionId = `s${++nextSession}`;
    let joined = false;
    let chain: Promise<void> = Promise.resolve();

    // THE WIRE BOUNDARY (GM-R13): every outbound frame is control-stripped
    // here, so no path — softcode emit, typed line, RPC-written attribute —
    // can carry raw escape bytes into a client. Style travels as markup
    // tokens; ANSI exists only past the client's fixed renderer table.
    const send = (msg: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(sanitizeOutbound(msg)));
    };

    const handle = async (raw: string): Promise<void> => {
      const msg = parseClientMessage(raw);
      if (!msg) {
        send({ type: "error", code: "BAD_MESSAGE", text: "unparseable message" });
        return;
      }

      if (msg.type === "hello") {
        const player = await gateway.authenticate(msg.token);
        if (!player) {
          send({ type: "error", code: "AUTH_FAILED", text: "unknown token" });
          socket.close();
          return;
        }
        coordinator.join(sessionId, {
          playerId: player.playerId,
          playerName: player.playerName,
          power: player.power,
          roomId: player.roomId,
          roomName: player.roomName,
          sink: { send },
          silencedUntil: player.silencedUntil,
          // GM-R16: lets a wizard's `boot` drop this transport session
          disconnect: () => socket.close(),
        });
        joined = true;
        send({
          type: "welcome",
          player: { id: player.playerId, name: player.playerName },
          room: { id: player.roomId, name: player.roomName },
          occupants: coordinator.occupants(player.roomId),
        });
        return;
      }

      // Self-service registration (GM-R18 open-signup): a pre-auth act — mint an
      // account + base-tier player (gated by the instance policy), then the
      // client authenticates normally. No session is bound here.
      if (msg.type === "register") {
        if (!gateway.register) {
          send({ type: "error", code: "REGISTRATION_UNSUPPORTED", text: "registration is not available here" });
          return;
        }
        const result = await gateway.register({
          name: msg.name,
          email: msg.email,
          password: msg.password,
          ...(msg.passphrase ? { passphrase: msg.passphrase } : {}),
        });
        if (!result.ok) {
          send({ type: "error", code: result.code, text: result.reason });
          return;
        }
        send({ type: "registered", player: { id: result.playerId, name: result.playerName } });
        return;
      }

      if (!joined) {
        send({ type: "error", code: "NOT_AUTHENTICATED", text: "hello first" });
        return;
      }

      // The command dispatch pipeline (dispatch.ts) owns verb routing; the
      // server owns the connection, the auth handshake, and per-session
      // ordering. Built-ins run here as ordinary code; softcode (07) is the
      // only fuel-metered path (see dispatch.ts § THE BUDGET BOUNDARY).
      await dispatch(
        { coordinator, gateway, engine, sessionId, send, disconnect: () => socket.close() },
        msg.line,
      );
    };

    socket.on("message", (data: unknown) => {
      const raw = String(data);
      chain = chain.then(() => handle(raw)).catch(() => {
        send({ type: "error", code: "BAD_MESSAGE", text: "internal error handling command" });
      });
    });

    socket.on("close", () => {
      if (joined) coordinator.leave(sessionId);
    });
  });

  const port = options.port ?? 8787;
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    // guardrail: loopback only — never a public interface
    httpServer.listen(port, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    port: boundPort,
    coordinator,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await gateway.close();
    },
  };
}

// ------------------------------------------------------------- CLI entry
// node src/server/server.ts  — the local playable check's server, over the
// real local Supabase stack (5454x block). Requires the stack seeded and
// provisioned: `npm run db:reset` then `npm run first-boot` (mints god with a
// provider-stored secret) and any player registrations. Clients present a
// verified Supabase Auth JWT (src/server/client.ts signs in for you).

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) {
  const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
  const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  if (!anonKey || !serviceRoleKey) {
    console.error("set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
    process.exit(1);
  }
  const gateway = new SupabaseGateway({ url, anonKey, serviceRoleKey });
  const port = Number(process.env["GENMURK_WS_PORT"] ?? 8787);
  startServer(gateway, { port }).then((handle) => {
    console.log(`genmurk dev server (localhost only) — ws://127.0.0.1:${handle.port}`);
  });
}
