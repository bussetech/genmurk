# Ops substrate — dev-tier posture (GM-R19)

> **Status:** design + dev-tier implementation of record (GENMURK-EPIC1-10).
> This documents what runs at dev-tier today and what the hosted project —
> **which does not exist yet** — inherits at provisioning time. PROD standup
> is a platform/EPIC5 act (dependency register entries #318/#320); nothing
> here stands anything up.

## /healthz — the eaap contract

The dev server answers `GET /healthz` per the SaaS-stratum health contract
(ADR-0023 §4, ADR-0048 §3): **unauthenticated, cheap, side-effect-free,
status + build id, never tenant data.**

```
$ curl -s http://127.0.0.1:8787/healthz
{"status":"ok","build":"dev"}
```

- `build` is `GENMURK_BUILD_ID` when the environment stamps one (a deploy's
  job), `"dev"` on a bare local run. The hosted shape returns the shipped
  build id exactly as eaap does.
- Everything else on the HTTP surface stays a 404 — the app is a WebSocket
  server; `/healthz` is the one deliberate HTTP door.
- Dev-tier guardrail unchanged: the server binds `127.0.0.1` explicitly.
  `/healthz` being unauthenticated is safe *because* nothing is exposed
  (the GM-R14 hosting gate); at PROD it is the standard public probe.
- Covered stack-free in CI: `test/server/healthz.test.ts`.

## Structured logging

`src/server/log.ts` — **JSON-lines, one event per line**: `ts` (ISO-8601),
`event` (dot-scoped: `server.listen`, `session.join`, `session.auth_failed`,
`session.close`, `command.error`), then identifier fields.

- **The privacy line is structural:** callers log **identifiers and outcomes
  only** — never tokens, passwords, message bodies, mail bodies, or typed
  command lines (a typed line can carry a password mid-registration). The
  healthz test asserts a spoken line and an auth token never reach the log.
- Dev-tier sink is stdout; tests inject a sink (fixture servers default to
  silent). On Workers-class compute the same shape flows to Workers Logs
  (`[observability] enabled`, per `docs/saas-stratum.md`) — the event
  vocabulary, not the transport, is the contract.
- The world of record keeps its own durable journals independently of this
  stream: `object_audit` (privileged/moderation acts) and `world_events`
  (presence/speech durable record). Logs are operational telemetry, never
  the audit trail.

## Backups — expectations against the not-yet-existing hosted project

There is no hosted database to back up; these expectations are **carried by
the provisioning register entry** (platform#320) so the sysop act that
creates the Supabase project configures them on day one:

1. **Everything durable lives in one Postgres** (objects, attributes, locks,
   mail, `object_audit`, `world_events`, auth) — one backup surface, by
   design. Provider-native automated **daily backups at minimum; PITR
   preferred** for a live multiuser world (the underwriting's support tail
   names backups as recurring sysop attention, platform#319).
2. **A restore drill is part of PROD standup**, not a post-incident
   improvisation: restore into a scratch project, run the isolation proof
   (`npm run test:isolation`) and first-boot check against it.
3. **In-world recovery is not backup.** `destroy`/`undestroy`'s recovery
   window is a player-facing feature inside the live database; a backup
   restore is instance-level and rolls *everyone* back. Never conflate the
   two when handling a "please restore my object" request.
4. **Dev-tier local stacks are disposable** — `npm run db:reset` is the
   norm; local volumes carry no expectations.

## Secrets inventory — current state

**Zero repo-registered secrets; nothing for the platform inventory yet.**
Per GM-R19 every runtime secret is provider-native (never git, never an
agent, never the schema), and `scripts/leak-check.sh` greps the tree clean
in CI (`npm run leak-check`, negative-tested).

| value | store today (dev-tier) | at provisioning (#320) |
| --- | --- | --- |
| `GENMURK_GOD_SECRET` | operator-set env at first boot; printed once if absent, never persisted | provider secret store; inventory entry with `store: provider` |
| `GENMURK_REGISTRATION_PASSPHRASE` | operator-set env (optional; fresh instance defaults to passphrase mode) | provider secret store; inventory entry |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | printed by the local stack (`supabase start`), not secrets in dev | hosted project keys in the provider store; inventory entries |

The `secrets-inventory.yml` entries land **with the provisioning act**, not
before — an `expected` entry for a project that doesn't exist would drift
against the weekly audit (which today reconciles `github-actions` entries
only; its provider-store handling is part of #320's scope).

## No-PROD verification (this session)

The tree carries **no deploy workflow, no wrangler/Workers config, no
`genmurk.com` reference, no hosted URL**; the server binds loopback
explicitly. The sandbox gate posture is unchanged: nothing hosted, exposed,
tunneled, or demoed beyond localhost until GM-R14's proof is accepted for
hosted exposure (platform#318).
