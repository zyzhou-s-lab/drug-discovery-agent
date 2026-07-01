#!/usr/bin/env bash
# PreToolUse(Bash) regression gate.
#
# Before Claude runs `git commit`, run the fast local checks and BLOCK the commit on
# failure (exit 2 feeds the reason back to Claude). This is the local "safety belt" that
# mirrors CI (.github/workflows/tests.yml) so breakage is caught at commit time, not after push.
#
# Locally this enforces the engine-ts hot zone (bun is fast + always present here);
# web typecheck and pytest run only if their toolchains exist, otherwise CI enforces them.
# Escape hatch: `git commit --no-verify` (use only when you know the gate is irrelevant).

export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

payload="$(cat)"
cmd="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)"

# Only gate real commits; let everything else through untouched.
case "$cmd" in
  *"git commit"*) : ;;
  *) exit 0 ;;
esac
# Honor the standard bypass flags.
case "$cmd" in
  *"--no-verify"*|*" -n "*|*" -n") exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
log="$(mktemp)"
block() { echo "🚫 regression-gate BLOCKED the commit: $1" >&2; echo "   (fix it, or bypass with: git commit --no-verify)" >&2; exit 2; }

# --- engine-ts (the hot zone; bun required) ---------------------------------
if command -v bun >/dev/null 2>&1; then
  cd "$ROOT/engine-ts" || block "cannot cd engine-ts"
  [ -d node_modules ] || bun install >/dev/null 2>&1 || block "engine-ts: bun install failed"
  if ! bun run typecheck >"$log" 2>&1; then tail -30 "$log" >&2; block "engine-ts typecheck failed"; fi
  if ! bun test          >"$log" 2>&1; then tail -30 "$log" >&2; block "engine-ts tests failed (incl. parity + config-contract)"; fi
else
  echo "⚠️  regression-gate: bun not found — skipping engine-ts checks (CI still enforces)." >&2
fi

# --- web typecheck (only if a node package manager is present) --------------
if command -v npm >/dev/null 2>&1 && [ -d "$ROOT/web/node_modules" ]; then
  cd "$ROOT/web" || block "cannot cd web"
  if ! npm run typecheck >"$log" 2>&1; then tail -30 "$log" >&2; block "web typecheck failed"; fi
fi

# --- pytest (only if installed) ---------------------------------------------
if command -v pytest >/dev/null 2>&1; then
  cd "$ROOT" || block "cannot cd repo root"
  if ! pytest -q >"$log" 2>&1; then tail -30 "$log" >&2; block "pytest failed"; fi
fi

rm -f "$log"
echo "✅ regression-gate: local checks passed." >&2
exit 0
