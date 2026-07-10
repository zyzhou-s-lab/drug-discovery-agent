# perturb_tools

Perturbation-prediction tools exposed to the dd-agent as MCP tools. **Forward-looking infra**:
these feed the **validation / compute stage** that runs *after* literature-evidence synthesis
(DOMAIN §10 — gene-perturbation prediction as a target-validation angle). **Not yet wired into
the live pipeline** and not field-tested end-to-end through dd-agent — the wiring point is noted
below for when that stage is built.

## Design (mechanism A — subprocess per call)

```
dd-agent ──(in-process MCP, dda venv)──▶ perturb_scgen.mcp_tools.make_scgen_mcp()
   tool handler                             │ subprocess.run() per call
   scgen_transfer / scgen_evaluate /        ▼
   check_inputs / list_perturbation_methods  scgen_oneshot.py  (scgen conda env)
                                             JSON in → JSON out → exit
```

- **MCP layer** (`perturb_scgen/mcp_tools.py`) runs **in the dda process** (dda venv) — an
  in-process SDK MCP server (like the existing lit/opentargets tools). Each call **shells out**.
- **Compute** (`scgen_oneshot.py` + `perturb_scgen/scgen_core.py`) runs in the **`scgen` conda
  env** on gpu-zhouy1 (torch/scvi). One subprocess per call, cold (no warm model). `evaluate`
  writes PNGs; the handler reads them back as inline MCP image content.
- **Two envs, one folder**: the dda venv does NOT carry scgen's heavy deps; this subpackage has
  its own `pyproject.toml`. dda's CI must not try to install / import the scgen-env code.

## Tools
- `scgen_transfer` — predict an observed perturbation's cross-cell response → per-gene ΔX̂ ranking.
- `scgen_evaluate` — vs target ground truth → PCC/R² + canonical `reg_mean_plot`/`reg_var_plot`
  (original scgen-reproducibility params: DEG gene_list + top_100_genes).
- `check_inputs` — pre-flight (stim_key observed in source? inputs alignable?).
- `list_perturbation_methods` — scenario/applicability profile + reliability prior (routing card).

scGen library = the LOCAL clone at `/data1/.../2019/scgen` (the env's pip scgen is broken vs
scvi 1.3.3); `get_matched_data` from `2025/CIPHER/CIPHER`. See `scgen_core.py`.

## Wiring it in later (when the validation stage exists)
Inject the in-process server into the validation agent's `extra_mcp`:
```python
from perturb_scgen.mcp_tools import make_scgen_mcp
extra_mcp = {"perturb-scgen": make_scgen_mcp(), ...}   # needs perturb_tools/ on PYTHONPATH
```
Env: `SCGEN_PY` (scgen-env python), `PERTURB_SCGEN_DIR` (this dir), `PERTURB_TIMEOUT`.

## Alternative entry (not the chosen path)
`perturb_scgen/server.py` is a standalone Streamable-HTTP MCP server (FastMCP) + warm in-memory
LRU — kept as the HTTP/hub option, but mechanism A (subprocess) is the chosen design.

## Status (verified on gpu-zhouy1)
- torch env fixed (2.11.0+cu126 vs driver 535); end-to-end scGen train/predict/eval works.
- `scgen_oneshot.py` validated: clean JSON on stdout; transfer + check_inputs + evaluate (3-fig)
  all run. **What's NOT done: running this through the actual dd-agent pipeline** (the stage that
  calls it isn't implemented yet).
