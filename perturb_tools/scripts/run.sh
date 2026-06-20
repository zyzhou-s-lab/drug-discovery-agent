#!/usr/bin/env bash
# Start the perturb-scgen MCP server (Streamable-HTTP) in the `scgen` conda env on gpu-zhouy1.
#   PERTURB_PORT (9101) · PERTURB_IDLE_TIMEOUT (900s) · PERTURB_LRU (3) · CIPHER_PATH
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
source ~/software/miniconda/etc/profile.d/conda.sh
conda activate scgen

export PYTHONPATH="$HERE:${PYTHONPATH:-}"
export PERTURB_PORT="${PERTURB_PORT:-9101}"
export PERTURB_IDLE_TIMEOUT="${PERTURB_IDLE_TIMEOUT:-900}"
export PERTURB_LRU="${PERTURB_LRU:-3}"
# the research imports get_matched_data from 2025/CIPHER/CIPHER and a LOCAL scgen clone
# (2019/scgen, overriding the env's pip scgen — "bypass pypi breaking changes").
export CIPHER_PATH="${CIPHER_PATH:-/data1/home/zhouy1/Projects/2025/CIPHER/CIPHER}"
export SCGEN_PATH="${SCGEN_PATH:-/data1/home/zhouy1/Projects/2019/scgen/scgen}"

echo "perturb-scgen on :$PERTURB_PORT (idle=${PERTURB_IDLE_TIMEOUT}s, lru=$PERTURB_LRU)"
exec python -m perturb_scgen.server
