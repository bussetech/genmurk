# Presence transport — design of record (GENMURK-EPIC1-05)

The real-time transport for presence and speech (GM-R1..R4) — the one
architecture choice `decisions.md` had left open (UAT risk R7). Decision:
**WebSocket, with a single-writer-per-room coordinator** — in PROD a
Durable-Object-class instance on the Workers-class runtime; in dev the same
coordinator class in-process under a Node `ws` harness. The public decision
entry lives on the repo's `decisions.md` page; this record holds the
engineering detail: the ordering mechanism and its limits, the rejected
options, the sandbox boundary, and the cost shape.

## The decision, against the four criteria

**1. Ordering (GM-R4: order within a room is consistent for all observers).**
Every room-scoped event — speech, presence, privileged broadcast, softcode
output — passes through ONE synchronous fan-out choke point
(`src/server/coordinator.ts` `roomEvent`), which assigns the room's next
monotonic `roomSeq` and delivers to every occupant in the same pass. Three
facts compose into the guarantee:

1. the coordinator is single-threaded (a JS isolate; in PROD a
   Durable-Object-class actor — the platform's own concurrency model
   preserves exactly this property);
2. `roomSeq` assignment and fan-out happen in one synchronous call — no
   interleaving point exists between "order chosen" and "order delivered";
3. per-connection delivery is FIFO (WebSocket over TCP).

So all observers of a room receive the identical sequence — by construction,
not by reconciliation. The proof is `test/server/ordering.test.ts`: 50 rounds
of three speakers racing on separate sockets, four observers asserted
identical; plus a round interleaving movement with speech, because presence
and speech share the one ordering domain.

**Limits, stated plainly:**

- Order **across rooms** is deliberately undefined (each room is its own
  ordering domain — this is what makes per-room sharding possible later).
- v1 runs **one coordinator for the whole world**; rooms are logical channels
  inside it. That is a vertical ceiling (one isolate's throughput) —
  irrelevant at dev-tier scale, and the per-room ordering domain means
  sharding to one-coordinator-per-room in PROD changes deployment, not the
  guarantee.
- **Reconnect is a fresh presence** in v1: no replay, no seq-gap recovery. A
  returning client rejoins and sees the world from now. The durable
  arrive/depart record in `world_events` exists for a later replay/catch-up
  feature; ephemeral speech is not persisted (below).

**2. Connection lifecycle on Workers-class compute.** Durable-Object-class
instances are the sanctioned home for long-lived WebSocket termination on the
chosen runtime (ADR-0048 provider family); a plain stateless Worker cannot
hold the per-room state or the ordered fan-out. The alternative shape —
clients subscribing to Supabase Realtime directly — takes the server plane
out of the delivery path entirely, which collides with the sandbox boundary
(criterion 4). Dev-tier runs the identical coordinator class under Node
`ws` on localhost; `ws` is the disposable harness piece, the coordinator is
the portable one.

**3. Cost shape at dev-tier.** Dev-tier cost is zero: the harness is
localhost-only Node; no hosted resource exists (guardrail: none may — the
GM-R14 gate). PROD implication for the register: Durable Objects require the
**Workers paid plan** (a small monthly floor plus usage) — noted on the
provisioning entry (platform#320) rather than as new machinery; regional
pinning of a coordinator instance (players far from the DO's region pay the
round trip) is a PROD-scale consideration for EPIC5, not a v1 concern.

**4. The sandbox boundary (GM-R14): the transport must not become a second
capability surface for softcode.** With a server-owned WebSocket transport,
clients hold NO publish primitive — a client can only send command lines,
and the server decides what fans out. Softcode's only door onto the
transport is `WorldAPI.emit`: buffered as `PendingEmit` during the run,
routed room-scoped by the SERVER after the run (`routeEmits`). The engine
never holds a socket, channel, coordinator, or send primitive — escape is
absent, not denied. `test/server/sandbox-boundary.test.ts` asserts four
walls: module-graph independence, no transport-shaped surface on the
capability handle, hostile transport-reaching programs refused
(`UNKNOWN_FUNCTION`), and the sanctioned door landing room-scoped only.

## Rejected options, with reasons

**Supabase Realtime (rejected).** Three independent disqualifiers:

- *Ordering:* Realtime broadcast makes no cross-publisher total-order
  guarantee per channel; `postgres_changes` delivery is per-client over
  multiplexed channels with backpressure/drop caveats. GM-R4's
  all-observers-agree property would have to be rebuilt client-side or by a
  reconciliation layer — the guarantee would live in hope, not mechanism.
- *Capability surface:* Realtime channels are a client-addressable publish
  primitive (broadcast). The subscribe-direct shape hands every client — and
  anything that can influence a client — a transport capability the server
  never mediates; the sandbox law wants exactly one mediated door.
- *Lifecycle:* a server-side long-lived Realtime subscription is not a
  natural Workers-class shape; the idiomatic shape is client-direct, which is
  the capability problem above.

Realtime remains fine for what it is (the stack ships it; we simply don't
wire it); nothing here forecloses using it later for non-authoritative
surfaces (e.g. an ops dashboard tailing `world_events`).

**Hybrid — Realtime fan-out reconciled against `world_events.seq`
(rejected).** Two delivery paths that can disagree are a split brain; the
reconciliation logic that would repair their disagreement *is* a coordinator.
Build the coordinator, skip the second path.

## The `world_events` seam — what changed from the 04 sketch

04 designed `world_events` as the seam "05 consumes (room = channel; `seq`
ordering)". 05 consumes the *mechanism* differently than the sketch imagined,
and this is the design delta of record:

- The audited RPCs still write `arrive`/`depart` rows — `world_events` is the
  **durable presence record** (replayable, wizard-auditable, RLS-scoped), and
  the playable check verified rows land there through real moves.
- The **live** delivery path does NOT tail the table (no poll, no
  `postgres_changes`): the coordinator is the live-order authority, because
  the server is the only writer driving mutations for its connected players —
  when a move commits, the server already knows, and fan-out follows in the
  same request path. DB `seq` and live `roomSeq` are separate numbering
  domains on purpose; the durable record is for audit/replay, not for
  ordering live delivery.
- Ephemeral speech (say/emote/page/whisper) is **not persisted** in v1 —
  cost- and privacy-conservative (page/whisper especially: `world_events` is
  room-scoped and directed messages don't belong there). If a future
  requirement wants room-speech history, it arrives as its own decision, not
  as a side effect.

## Transport-relevant learnings inherited from 02/03/04

- **02 (engine spike):** the engine is a synchronous metered walker in the
  same isolate as the server — a run cannot interleave with fan-out, so
  engine work and coordinator work share one thread without ordering hazard.
  Node-strip-only TS (no parameter properties, `type`-only imports) applies
  to all server code; Node 24 in CI runs `.ts` directly.
- **03 (engine core):** `WorldAPI` is frozen at six methods; the transport
  gets no new engine surface (and the boundary test pins that).
- **04 (world model):** `RunOutcome.mutations` + `WorldModel.emits` are the
  designed buffers; `loadSnapshot → run → applyMutations` is the loop the
  connection layer drives; the `world_move` RPC as-the-actor is the movement
  path (RLS + role checks stay the final wall).

## The auth stub, loudly

Session-to-player binding is `stub:<PlayerName>` → the synthetic
`<name>@genmurk.invalid` principal (the isolation proof's users), signed in
with the shared synthetic password. It verifies NO player credential. It
exists so the playable check exercises real JWT-scoped, RLS-checked clients
end to end. Prompt 08 (GM-R15/GM-R18) replaces the token scheme behind the
unchanged `WorldGateway.authenticate` seam. Do not ship, demo, or reason
about security on top of the stub.

## What 06/08/09 build on

- The verb SURFACES are pre-capture placeholders (`src/server/verbs.ts`
  header is the law); GM-R22's captured command list drops in as data.
- 08's real auth replaces `authenticate` internals; the capability gate on
  `announce` (wizard threshold in the coordinator) is the hook 08's full
  enforcement replaces the *feeding* of (the stub session's `power`), not the
  gate itself.
- Softcode triggered from player commands (item 5 of the backlog) drives
  `loadSnapshot → run → applyMutations` then `routeEmits` — every piece
  exists and is tested; only the command dispatch is missing.
