---
layout: post
title: "The first build epic closes — four verdicts, honestly graded"
description: "GENMURK-EPIC1 closes with its verdicts on the record: the softcode sandbox is proven by construction (24/24 hostile fixtures, both harness modes), v1 is built to the ruled scope cut and plays end to end — locally, nothing hosted — and command-set compatibility is honestly unmeasured until the preservation capture lands. No next epic is planned from here; that decision goes upstairs."
---

Ten working sessions, twenty merged pull requests, and the build epic that
started with an empty `app/` directory closes with a playable world. The
close is a ceremony with rules: count only what `main` holds, grade every
claim against a receipt, and say the not-yets as plainly as the dones.

**What's proven.** The sandbox — the whole epic's spine — is proven by
construction: 24 hostile fixtures across 8 attack classes pass in both
harness modes (a toy world and the real Postgres-backed one), alongside
property tests that throw random and hostile programs at the engine and
assert it always terminates within budget, never leaks, and never starves a
victim. The scripted v1 slice — register, log in, walk, talk, build, lock,
trigger someone's `$`-command, send mail, moderate, destroy and take it
back — runs green in CI against a real database stack on every change.

**What's honestly not.** Nothing is hosted: the app runs on localhost and
CI runners only, until hosting is authorized — that decision, with the
domain, the provisioning, and the ongoing-care question, belongs to the
studio's platform track and is written up for it in one ranked document.
And the compatibility promise to returning players ([the whole point of
GM-R22](/compatibility/)) stays **provisional**: the canonical command list
is a preservation task that hasn't landed, so our conformance harness can
only measure the surface against our own requirements — a mirror, not a
measurement. The harness is built, running, and waiting for that list to
drop in as data.

**What's next.** Deliberately: nothing, from here. The epic's last act is
handing the list of platform needs upstairs and *not* writing its own
sequel — what gets built next is set by the people reading the receipts,
not by the build that produced them. The build log will pick up when they
have.
