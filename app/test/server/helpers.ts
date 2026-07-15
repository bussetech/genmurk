// Shared plumbing for the stack-free transport tests: a fixture world (two
// rooms, one hallway pair of exits) served on an ephemeral loopback port,
// and a test client over the real WebSocket wire — these tests exercise the
// actual server + coordinator + protocol path, not a mock of it.

import { startServer, type ServerHandle } from "../../src/server/server.ts";
import { FixtureGateway } from "../../src/server/gateway.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

export const TOWN = "#10";
export const CAVE = "#20";

export function fixtureGateway(): FixtureGateway {
  return new FixtureGateway({
    rooms: {
      [TOWN]: { name: "Town Square" },
      [CAVE]: { name: "Echo Cave" },
    },
    exits: [
      { name: "north", from: TOWN, to: CAVE },
      { name: "south", from: CAVE, to: TOWN },
    ],
    players: {
      Alice: { power: "builder", room: TOWN },
      Bob: { room: TOWN },
      Cara: { room: TOWN },
      Wanda: { power: "wizard", room: TOWN },
      Zoe: { room: CAVE },
    },
  });
}

export async function fixtureServer(): Promise<ServerHandle> {
  return startServer(fixtureGateway(), { port: 0 });
}

export class TestClient {
  readonly received: ServerMessage[] = [];
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
  }

  static async connect(port: number, playerName: string): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const client = new TestClient(ws);
    ws.addEventListener("message", (ev) => {
      client.received.push(JSON.parse(String(ev.data)) as ServerMessage);
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("connect failed")), { once: true });
    });
    ws.send(JSON.stringify({ type: "hello", token: `stub:${playerName}` }));
    await client.waitFor((m) => m.type === "welcome" || m.type === "error");
    const last = client.received[client.received.length - 1]!;
    if (last.type === "error") throw new Error(`hello failed: ${last.text}`);
    return client;
  }

  command(line: string): void {
    this.ws.send(JSON.stringify({ type: "command", line }));
  }

  /** All room events received so far (the ordered stream under test). */
  events(): RoomEventMessage[] {
    return this.received.filter((m): m is RoomEventMessage => m.type === "event");
  }

  /** Resolve once `predicate` holds over the received list; poll-free —
   *  re-checked on every incoming frame. */
  waitFor(predicate: (m: ServerMessage) => boolean, count = 1, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => this.received.filter(predicate).length >= count;
      if (check()) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.ws.removeEventListener("message", onMessage);
        reject(
          new Error(
            `timeout: wanted ${count}, have ${this.received.filter(predicate).length} ` +
              `(total ${this.received.length})`,
          ),
        );
      }, timeoutMs);
      const onMessage = (): void => {
        if (check()) {
          clearTimeout(timer);
          this.ws.removeEventListener("message", onMessage);
          resolve();
        }
      };
      this.ws.addEventListener("message", onMessage);
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** The comparable identity of a room event, for cross-observer assertions. */
export function eventKey(e: RoomEventMessage): string {
  return `${e.room}|${e.roomSeq}|${e.kind}|${e.actor}|${e.text}`;
}
