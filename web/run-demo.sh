#!/usr/bin/env bash
# One-command live discovery demo: dd_agent API (uvicorn) -> Vite frontend.
# Real mode: no seed data; trigger runs from the UI "运行" button. LLM keys are
# loaded from ~/.claude/settings.json env (DeepSeek/Anthropic) so the judge works.
#
#   ./run-demo.sh
#
# Env overrides:
#   DDA_DIR     path to the dd_agent checkout (default: ../drug-discovery-agent or ../dda)
#   API_PORT    backend port (default 8099)
#   WEB_PORT    frontend port (default 5173)
#   SEED=1      also seed the offline dry-AMD campaign (optional, for offline demo)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# web/ now lives INSIDE the dda repo, so the checkout is the parent dir (with a .venv)
if [ -z "${DDA_DIR:-}" ]; then
  for cand in "$HERE/.." "$HERE/../drug-discovery-agent" "$HERE/../dda" /home/zyzhou/dda; do
    [ -d "$cand/.venv" ] && DDA_DIR="$(cd "$cand" && pwd)" && break
  done
fi
DDA_DIR="${DDA_DIR:-$(cd "$HERE/.." && pwd)}"
API_PORT="${API_PORT:-8099}"
WEB_PORT="${WEB_PORT:-5173}"
DB=/tmp/dd-demo/state.sqlite
ART=/tmp/dd-demo/artifacts

echo "dd_agent checkout: $DDA_DIR"
[ -d "$DDA_DIR/.venv" ] || { echo "ERROR: $DDA_DIR/.venv missing — set up the dd_agent venv first"; exit 1; }
# shellcheck disable=SC1091
source "$DDA_DIR/.venv/bin/activate"

# optional offline seed (SEED=1); real mode starts with an empty DB
if [ "${SEED:-0}" = "1" ]; then
  rm -rf /tmp/dd-demo
  python "$DDA_DIR/scripts/seed_demo.py" --db "$DB" --artifacts "$ART"
fi

# load LLM env (DeepSeek/Anthropic) from Claude Code settings so the judge can run
if [ -f "$HOME/.claude/settings.json" ]; then
  eval "$(python3 - <<'PY'
import json, os, shlex
env = json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('env', {})
for k in ('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'):
    if env.get(k):
        print(f'export {k}={shlex.quote(env[k])}')
PY
)"
  echo "loaded LLM env from ~/.claude/settings.json (base_url set: ${ANTHROPIC_BASE_URL:+yes})"
fi

export DD_DB="$DB" DD_ARTIFACTS="$ART"
echo "starting API on :$API_PORT ..."
uvicorn dd_agent.api:app --host 127.0.0.1 --port "$API_PORT" --log-level warning &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
sleep 2

echo "starting frontend on :$WEB_PORT (proxy /api -> :$API_PORT) ..."
cd "$HERE"
DD_API_PROXY="http://127.0.0.1:$API_PORT" npx vite --port "$WEB_PORT" --host 127.0.0.1
