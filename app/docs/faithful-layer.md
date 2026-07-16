# The faithful layer (GENMURK-EPIC1-09) — locks, take/drop, mail, moderation, destroy/undestroy

Design of record for backlog item 7: the behaviors worth preserving that make
GenMURK recognizably the reference's descendant, built to the v1 ruled scope.
Framed per GD-0025 — the reference is honoured as what taught the domain; where
the sandbox (GM-R14) or the studio security model forces a difference, the safe
behavior wins and it is documented for the returning user (`/compatibility/`).

## 1. Lock expressions, full ruled scope (GM-R8)

The boolean lock grammar (`src/world/lock.ts`) reaches its full scope with the
**ownership predicate** `owner(#N)` beside the attribute (`ATTR:glob`) and key
(`#N`) predicates. Semantics: `owner(#N)` passes iff the actor owns object #N —
a relationship a key cannot state (a guild door that opens for whoever the
charter belongs to). The world-API supplies `ownerOf` to the evaluator.

**Sandbox by construction (GM-R14).** A stored lock is untrusted input, so its
evaluation is bounded three ways, none of them "by hope":

1. **length** — the source is capped (`MAX_LOCK_LEN`, matching the DB CHECK);
2. **nesting** — the parser refuses depth past `MAX_LOCK_DEPTH` (a `((((…))))`
   or `!!!!…` bomb can never blow the recursion stack);
3. **eval budget** — every AST node spends one unit of `LOCK_EVAL_STEPS`;
   exhausting it raises `LockBudgetError`, which `evalLock` catches and **fails
   closed**.

The glob compiler (`src/world/glob.ts`) is backtrack-free, so a hostile
`ATTR:*a*a*…` predicate cannot make one clause super-linear. A lock is thus
evaluated in bounded time on the transport plane **without** holding the
engine's fuel meter — proven against `test/unit/world-lock-hostile.test.ts`.

Locks gate **use** (exit traversal), **enter** (containment), and **pickup**
(take), each per action; an object with no lock of a kind is open (reference
default). Lock *gating* is the world-API's (`canUse`/`canEnter`/`canPickup`);
the RPCs hold the structural wall. DB-side lock re-evaluation (defense in depth)
stays deferred (dependency register).

## 2. Take & drop (GM-R6 containment + GM-R8 pickup)

`get`/`drop` are the actions the pickup lock exists to gate. The world-API
evaluates the pickup lock **before** the move (the 06 exit-`use` precedent);
`world_get`/`world_drop` (migration 08) hold the structural wall: `get` moves a
**live thing co-located in your room** into your inventory, `drop` moves a thing
**you hold** into the room you stand in — nothing else. `get` on an unlocked
thing succeeds for anyone present (reference default-open). Drop-class softcode
triggers (`ON_GET`/`ON_DROP`) are the natural next add and remain deferred (the
07 trigger plumbing is ready — add a `TRIGGER_ATTRS` kind + a `fireTriggers`
call site).

## 3. In-world mail (GM-R17)

The `mail` table (migration 08) is durable player-to-player mail. RPCs:
`world_mail_send` / `world_mail_mark_read` / `world_mail_delete`. Design calls:

- **Retention:** durable until the recipient soft-deletes it; no auto-expiry in
  v1 (a retention/privacy call — revisit for hosted exposure).
- **Quota:** the recipient's live inbox is capped (`mail_inbox_max`); a full
  inbox refuses the send.
- **Moderation visibility:** the `mail_read` RLS policy admits sender, recipient,
  and **wizard/god**; the **body is never journaled** (the audit records only
  who mailed whom, and the subject).
- **Addressing:** global by player name or `#dbref` (mail crosses rooms).
- **Silence:** a silenced player cannot send.
- **Subject:** carried by the RPC but **body-only from the command line** in v1
  (the subject-line syntax is a capture question).

The gateway reads inboxes with the service client scoped to the recipient (so
sender names resolve regardless of the reader's neighborhood); `mail read N` /
`mail delete N` index the newest-first inbox.

## 4. Moderation (GM-R16)

Wizard+ tooling, all routed through the one capability seam
(`_world_require_power(actor, 3)`) and all journaled to `object_audit`
(who/what/when/why) — the trail the v1 slice asserts:

- **warn** — a durable notice (audited) + a live notice to connected sessions;
- **boot** — a transport disconnect: the RPC records the act, the coordinator
  drops the target's sessions (firing departure presence);
- **silence / unsilence** — `objects.silenced_until` is the durable record, and
  `coordinator.setSilence` updates live sessions immediately; silence gates
  **speech and mail**.

Three guards make the tooling un-abusable (`_world_moderation_target`): **God #1
is never a target**, a wizard **may not moderate an equal-or-higher tier** (only
a god reaches a wizard), and the target must be a live player.

## 5. Recoverable destruction UX (GM-R9)

`destroy` / `undestroy` are the player-facing verbs over 04's soft-destroy RPCs
(`world_destroy` / `world_recover`, unchanged). `destroy` **states the recovery
window** honestly ("recoverable with `undestroy #N` for N days"); `undestroy`
takes a **`#dbref`** because a destroyed object has left the actor's snapshot
(RLS hides the bin from non-wizards) — the number the destroy printed is the
honest handle, resolved by a service read and recovered **as the actor** (the
RPC's control + window checks are the wall).

## 6. The v1 playable vertical slice

`test/world/slice.test.ts` is the epic's integration acceptance: one scripted
multi-client scenario over the real local stack — register/login → walk & talk →
build & lock → a `$`-command another player triggers → page & mail → a wizard
moderates → destroy/undestroy — asserting the moderation audit trail. It runs as
the `v1-slice` CI job (Supabase stood up on the runner). Localhost only; the
sandbox gate holds.

## Test surface

- Stack-free: `test/unit/world-lock-hostile.test.ts` (ownership + hostile
  locks), `test/server/faithful-dispatch.test.ts` (get/drop, destroy/undestroy,
  mail, moderation) — both in `npm test`.
- Live-stack: `test/world/slice.test.ts` (`npm run test:slice`, the `v1-slice`
  CI job); the isolation/building/escalation/first-boot/registration gates stay
  green alongside it.
