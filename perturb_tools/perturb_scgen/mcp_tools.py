"""In-process MCP tools that run in the dda process (dda venv) and shell out to scgen_oneshot.py.

Mechanism A (subprocess per call): each tool spawns `SCGEN_PY scgen_oneshot.py` in the scgen
conda env, passing a JSON request on stdin and parsing the JSON result from stdout. No persistent
server, no port — the MCP layer lives in the dda runtime; only the compute runs in the scgen env.

Wire into the dd-agent by adding the server to the agent's mcp_servers:
    from perturb_scgen.mcp_tools import make_scgen_mcp
    extra_mcp = {"perturb-scgen": make_scgen_mcp(), ...}

Config via env: SCGEN_PY (scgen-env python), PERTURB_SCGEN_DIR (repo dir), PERTURB_TIMEOUT.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess

SCGEN_PY = os.environ.get("SCGEN_PY", "/data1/home/zhouy1/software/miniconda/envs/scgen/bin/python")
SCGEN_DIR = os.environ.get("PERTURB_SCGEN_DIR", "/data1/home/zhouy1/Projects/drug-discovery-agent/perturb_tools")
TIMEOUT = float(os.environ.get("PERTURB_TIMEOUT", "1800"))


def _call(req: dict) -> dict:
    """Run one scgen_oneshot.py compute in the scgen env. Returns the parsed JSON result."""
    env = {**os.environ, "PYTHONPATH": SCGEN_DIR}
    try:
        p = subprocess.run(
            [SCGEN_PY, os.path.join(SCGEN_DIR, "scgen_oneshot.py")],
            input=json.dumps(req), capture_output=True, text=True, timeout=TIMEOUT, env=env)
    except subprocess.TimeoutExpired:
        return {"error": f"scgen compute timed out after {TIMEOUT:.0f}s"}
    out = (p.stdout or "").strip()
    if not out:
        return {"error": f"oneshot produced no output (rc={p.returncode}); "
                         f"stderr tail: {(p.stderr or '')[-300:]}"}
    try:
        return json.loads(out.splitlines()[-1])
    except json.JSONDecodeError:
        return {"error": f"oneshot output not JSON: {out[-300:]}"}


def make_scgen_mcp():
    """Build the in-process SDK MCP server exposing the scGen tools (subprocess-backed)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    from .profile import SCGEN_PROFILE

    common = {"source_h5ad": str, "target_h5ad": str, "stim_key": str, "source_name": str,
              "target_name": str, "ctrl_key": str, "max_epochs": int}

    @tool("scgen_transfer",
          "Predict the cross-cell-type response of an OBSERVED perturbation; returns a per-gene "
          "effect (ΔX̂) ranking. Use when stim_key was observed in source_h5ad; do NOT use for a "
          "perturbation never observed there (zero-shot job for another tool).",
          {**common, "top_k": int})
    async def scgen_transfer(args):
        out = await asyncio.to_thread(_call, {"op": "transfer", **args})
        return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]}

    @tool("scgen_evaluate",
          "Evaluate the prediction against the OBSERVED truth in the target dataset; returns "
          "PCC/R² + the canonical reg_mean/reg_var figures (inline images). Use when the target "
          "also contains cells perturbed with stim_key (ground truth, e.g. Replogle).",
          common)
    async def scgen_evaluate(args):
        out = await asyncio.to_thread(_call, {"op": "evaluate", **args})
        text = {k: v for k, v in out.items() if k != "plots"}
        content = [{"type": "text", "text": json.dumps(text, ensure_ascii=False)}]
        for png in out.get("plots", []):
            try:
                with open(png, "rb") as f:
                    content.append({"type": "image",
                                    "data": base64.b64encode(f.read()).decode(),
                                    "mimeType": "image/png"})
            except OSError:
                pass
        return {"content": content}

    @tool("check_inputs",
          "Pre-flight: can the inputs align and is stim_key observed in the source? Use before "
          "scgen_transfer/evaluate to fail fast on a bad request.",
          {"source_h5ad": str, "target_h5ad": str, "stim_key": str,
           "source_name": str, "target_name": str})
    async def check_inputs(args):
        out = await asyncio.to_thread(_call, {"op": "check_inputs", **args})
        return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]}

    @tool("list_perturbation_methods",
          "Scenario/applicability profile + reliability prior for each method (routing card).", {})
    async def list_methods(_args):
        return {"content": [{"type": "text",
                             "text": json.dumps({"methods": [SCGEN_PROFILE]}, ensure_ascii=False)}]}

    return create_sdk_mcp_server(
        "perturb-scgen", "0.1.0",
        [scgen_transfer, scgen_evaluate, check_inputs, list_methods])
