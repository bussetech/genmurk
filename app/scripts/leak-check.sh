#!/usr/bin/env bash
# Credential leak-check (GENMURK-EPIC1-08 acceptance, GM-R18/R19). Zero default
# credentials may live in the repo — no shipped god/wizard secret, no shared
# synthetic password, no hardcoded key or JWT. This greps the app's source,
# tests, scripts, migrations, and docs and FAILS the build on any hit. It runs
# in CI (a stack-free step) so "no default credentials" is proven, not trusted.
#
# What it forbids: a secret ASSIGNED TO A STRING LITERAL. Reading a secret from
# the environment/provider store (`process.env[...]`, a variable, a function
# arg) is exactly the pattern GM-R19 wants and is NOT a literal, so it passes.
#
# Usage: scripts/leak-check.sh   (run from app/)

set -euo pipefail

# Scan tracked source only; never node_modules or lockfiles.
ROOTS=(src test scripts supabase docs)
EXISTING=()
for r in "${ROOTS[@]}"; do [ -e "$r" ] && EXISTING+=("$r"); done

fail=0
report() { # <label> <grep-output>
  if [ -n "$2" ]; then
    echo "LEAK CHECK FAILED — $1:"
    echo "$2" | sed 's/^/  /'
    fail=1
  fi
}

# This scanner itself names the forbidden patterns; never scan it.
SKIP=(--exclude=leak-check.sh)

# 1. The retired shared synthetic password — must never reappear anywhere.
hits=$(grep -rInE "${SKIP[@]}" 'synthetic-password' "${EXISTING[@]}" || true)
report "the retired shared synthetic password reappeared" "$hits"

# 2. A credential keyword assigned to a quoted STRING LITERAL (>=6 chars).
#    Matches:  password: "hunter2"  |  godSecret = 'abc123'  |  serviceRoleKey: "…"
#    Skips:    password: secret     |  secret = "env(FOO)"  (provider indirection)
#    Skips the game's own uppercase SECRET ATTRIBUTE (`SECRET: "…"`, `SECRET = "…"`)
#    — a world attribute the read-gate tests seed, never a credential.
KEY='(password|passwd|pwd|secret|service_?role_?key|anon_?key|api_?key|access_?token)'
hits=$(grep -rIniE "${SKIP[@]}" "${KEY}[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"']{6,}[\"']" "${EXISTING[@]}" \
  | grep -vE 'GENMURK_[A-Z_]+' \
  | grep -vE '\bSECRET\b[[:space:]]*[:=]' \
  | grep -viE '(from the (env|provider)|process\.env|env\[|=[[:space:]]*"env\()' || true)
report "a credential is assigned to a string literal" "$hits"

# 3. A hardcoded JWT (Supabase anon/service keys are JWTs: eyJ… . …).
hits=$(grep -rInE "${SKIP[@]}" 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "${EXISTING[@]}" || true)
report "a hardcoded JWT / service key" "$hits"

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Credentials belong in the provider store (GM-R19), read at runtime — never in the repo."
  exit 1
fi
echo "leak-check: clean — no default credentials in ${EXISTING[*]}"
