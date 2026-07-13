---
layout: page
title: Rebuild backlog
eyebrow: The build
description: "What GenMURK builds next, ranked highest-risk-first — the sandboxed softcode runtime leads. Honest 'what's next' narrative; GENMURK-EPIC1 executes the build, and PROD hosting is platform EPIC5 work."
permalink: /backlog/
---

This is the honest **what's next**: the rebuild backlog, ranked. It is a plan,
not a status board — no operational green/red here. The [requirements](/decomposition/)
say *what* GenMURK must do; this ranks the order the work happens in.
**GENMURK-EPIC1 — the project track — executes it;** PROD hosting stays
platform EPIC5 work.

## Highest-risk-first

The list is deliberately ordered so the riskiest, highest-value decision comes
**first** — nothing hosted ships before it is settled.

1. **[arch] Build our own softcode engine (GM-R14 / GM-R11).** The crux. The
   mechanism is **decided — we build our own purpose-built interpreter**, not a
   wrapper around an off-the-shelf VM (company direction; see
   [decisions](/decisions/)). The work is to design that engine and *prove* its
   step/CPU/recursion/queue budgets against an adversarial fixture pack. Softcode
   is untrusted input; the sandbox is non-negotiable and gates any hosted
   exposure. Owning the engine is also what makes a future where **gnomes build
   in-MURK** possible.
2. **[arch] World-model schema (GM-R5..R10).** The relational model for
   objects/attributes/locks/containment/ownership, on Supabase, with row-level
   security bound to the capability model.
3. **[core] Real-time presence & room speech (GM-R1..R4).** Transport choice,
   channel-per-room, push delivery, consistent ordering.
4. **[core] Building verbs & movement (GM-R6 / GM-R7).** Dig/open/create/set,
   go/enter/leave, and name matching (GM-R12).
5. **[core] Command dispatch + `$`-commands + queue (GM-R11 / GM-R12).** The
   softcode trigger model, built on top of item 1's runtime.
6. **[core] Auth & capability model (GM-R15 / GM-R18).** Modern KDF, no default
   credentials, first-boot god provisioning; graded powers enforced server-side.
7. **[faithful] Locks, mail, moderation, destroy/undestroy (GM-R8 / GM-R16 /
   GM-R17 / GM-R9).**
8. **[faithful] Styled ANSI/markup output (GM-R13).**
9. **[ops] Health endpoint, secrets in the provider store, backups,
   observability (GM-R19),** plus apex/DNS-zone handling for `genmurk.com` (the
   second-zone decision).
10. **[preservation] Museum / behavioral-reference exhibit (GM-R20)** and the
    lineage/history pages on this docs site.
11. **[decision] Themed creative direction** — a company-level decision issue
    with options (setting, theme, name-in-fiction); not invented here.
12. **[faithful — onboarding] End-user command-set compatibility (GM-R22, STEERCO
    minimum bar).** A cross-cutting acceptance layer over the verb work (items
    3–8): GenMURK's player-facing command names and syntax match the
    TinyMUSE/MicroMUSE reference so historic users onboard easily. Depends on a
    preservation sub-task — **capture the canonical reference command set** (from
    the behavioral reference and historic-user knowledge; airgapped, tracked as
    its own issue) — and validated as the verbs land.

## Why softcode leads

Everything else is ordinary product work; the softcode runtime is not. The
reference exposed a user-programmable interpreter to the network without
resource isolation — normal for its era, and a large untrusted surface by
today's security standards. GenMURK treats all player
softcode as untrusted input under the studio's trust framework, the same way a
survey agent treats an injected README. Getting the sandbox right — **by
construction, not by hope** — is what makes a hosted GenMURK safe to run, so it
is settled before anything is exposed.

## What this site does *not* show

This is a build log, not an ops dashboard. You will not find heartbeat,
uptime, incident, or pass/fail chips here — the running app and its operational
signals live at `genmurk.com` (platform EPIC5), on the client portal, not on
these public Pages. Progress here is narrative: **decomposition done; rebuild
backlog set; GENMURK-EPIC1 builds; PROD is platform EPIC5.**
