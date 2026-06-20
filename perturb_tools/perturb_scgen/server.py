"""perturb-scgen — a Streamable-HTTP MCP server exposing scGen cross-cell perturbation transfer.

One persistent process in the `scgen` conda env on gpu-zhouy1. Keeps trained models warm in an
LRU and idle-unloads to free the shared A100. Consumed identically by:
  - the dd-agent validation agent on the GPU: mcp_servers={"perturb-scgen":{"type":"http",
    "url":"http://127.0.0.1:9101/mcp"}}
  - your interactive Claude Code (laptop) over Tailscale:
    claude mcp add --transport http perturb-scgen http://100.123.160.102:9101/mcp

Run:  conda activate scgen && python -m perturb_scgen.server   (see scripts/run.sh)
"""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Annotated

import numpy as np
from mcp.server.fastmcp import Context, FastMCP, Image
from pydantic import Field

from . import scgen_core as core
from .model_cache import ModelCache, model_key
from .profile import SCGEN_PROFILE

# Per-parameter descriptions — surfaced in the MCP inputSchema so the agent passes args correctly.
SourceH5ad = Annotated[str, Field(description=
    "Path to the SOURCE .h5ad on gpu-zhouy1 — the accessible cell type where the perturbation was "
    "OBSERVED. Needs obs['perturbation'] (incl. 'control') and a cell-type label.")]
TargetH5ad = Annotated[str, Field(description=
    "Path to the TARGET .h5ad — the cell type to predict the response in (e.g. the disease cells).")]
StimKey = Annotated[str, Field(description=
    "The perturbation to transfer: a gene symbol/ID (or stimulus) that MUST appear in the source's "
    "obs['perturbation']. scGen cannot predict an unobserved perturbation.")]
SourceName = Annotated[str, Field(description="Cell-type label for the source (used in restrict_arithmetic_to).")]
TargetName = Annotated[str, Field(description="Cell-type label for the target.")]
CtrlKey = Annotated[str, Field(description="The control-condition value in obs['perturbation'] (default 'control').")]
MaxEpochs = Annotated[int, Field(description="scGen VAE training epochs (model is cached warm after the first train).")]
BatchSize = Annotated[int, Field(description="Training batch size.")]

IDLE_TIMEOUT = int(os.environ.get("PERTURB_IDLE_TIMEOUT", "900"))   # 15 min
LRU_CAPACITY = int(os.environ.get("PERTURB_LRU", "3"))
PORT = int(os.environ.get("PERTURB_PORT", "9101"))
# Safe default: loopback only. For the documented Tailscale laptop access, set PERTURB_HOST=0.0.0.0
# (or the tailscale IP) on the gpu — opt-in rather than binding every interface by default.
HOST = os.environ.get("PERTURB_HOST", "127.0.0.1")

cache = ModelCache(capacity=LRU_CAPACITY, idle_timeout=IDLE_TIMEOUT)


@asynccontextmanager
async def lifespan(_server):
    async def sweeper():
        while True:
            await asyncio.sleep(60)
            try:
                if cache.sweep_idle():
                    print("[perturb-scgen] idle-unloaded models, freed GPU")
            except Exception as e:  # noqa: BLE001
                print(f"[perturb-scgen] idle sweep error: {e!r}")

    task = asyncio.create_task(sweeper())
    try:
        yield
    finally:
        task.cancel()


mcp = FastMCP("perturb-scgen", host=HOST, port=PORT, lifespan=lifespan)


async def _train_and_cache(key, adata_train, adata_t_ctrl, var_names, valid_perts,
                           max_epochs, batch_size, ctx):
    """Train the VAE and store it under `key`, returning the cache value (model, adata_t_ctrl,
    gene_names, valid_perts, train_sec). The model is stim_key-INDEPENDENT — one VAE per
    (source,target,setup) — so scgen_transfer and scgen_evaluate key it identically and share the
    same warm model; it is only ever trained once per setup."""
    if ctx:
        await ctx.info(f"training scGen ({max_epochs} epochs)…")
    model, secs = await asyncio.to_thread(core.train_model, adata_train, max_epochs, batch_size)
    value = (model, adata_t_ctrl, var_names, valid_perts, secs)
    cache.put(key, value)
    return value


async def _get_or_train(source_h5ad, target_h5ad, source_name, target_name,
                        max_epochs, batch_size, ctx):
    """For scgen_transfer: a cache hit skips BOTH load+prep and training. Returns (value, trained),
    value = (model, adata_t_ctrl, gene_names, valid_perts, train_sec)."""
    key = model_key(source_h5ad, target_h5ad, source_name, target_name, max_epochs, batch_size)
    hit = cache.get(key)
    if hit is not None:
        return hit, False
    adata_s, adata_t, adata_t_ctrl, adata_train, valid_perts = await asyncio.to_thread(
        core.load_and_prep, source_h5ad, target_h5ad, source_name, target_name)
    value = await _train_and_cache(key, adata_train, adata_t_ctrl, np.asarray(adata_t.var_names),
                                   valid_perts, max_epochs, batch_size, ctx)
    return value, True


@mcp.tool()
async def scgen_transfer(
    source_h5ad: SourceH5ad,
    target_h5ad: TargetH5ad,
    stim_key: StimKey,
    source_name: SourceName = "source",
    target_name: TargetName = "target",
    ctrl_key: CtrlKey = "control",
    target_signature: Annotated[dict | None, Field(description=
        "Optional {gene: weight} healthy-minus-disease direction; adds an overall toward-goal "
        "alignment score (cosine of ΔX̂ with this direction) to the ranking.")] = None,
    top_k: Annotated[int, Field(description="Number of top-effect genes to return, ranked by |ΔX̂|.")] = 50,
    max_epochs: MaxEpochs = 100,
    batch_size: BatchSize = 2048,
    ctx: Context = None,
) -> dict:
    """Predict the cross-cell-type response of an OBSERVED perturbation and return its per-gene
    effect ranking.

    Use when: you observed perturbation `stim_key` (a gene KO/OE or stimulus) in the source cell
    type and want its transcriptomic effect predicted in the target (e.g. disease) cell type.
    Do NOT use for a perturbation never observed in `source_h5ad` (no data for that gene) — that
    is a zero-shot job for a different tool. `target_signature` (optional {gene: weight}, the
    healthy-minus-disease direction) adds an overall toward-goal alignment score.

    Returns {ranking:[{gene, delta, direction}], toward_goal_proj?, meta}. Trains a VAE per
    (source,target) the first time (minutes), then caches it warm for cheap per-gene predicts.
    """
    value, trained = await _get_or_train(
        source_h5ad, target_h5ad, source_name, target_name, max_epochs, batch_size, ctx)
    model, adata_t_ctrl, gene_names, valid_perts, train_sec = value

    if stim_key not in valid_perts:
        return {"error": f"stim_key '{stim_key}' was not observed in the source perturbations",
                "hint": "scGen can only transfer a perturbation present in source_h5ad; for an "
                        "unobserved gene use a zero-shot method.",
                "n_observed_perturbations": len(valid_perts)}

    delta = await asyncio.to_thread(
        core.predict_delta, model, adata_t_ctrl, stim_key, source_name, ctrl_key)
    result = core.rank_effect(delta, gene_names, target_signature, top_k)
    result["meta"] = {"method": "scgen_transfer", "stim_key": stim_key,
                      "n_genes": int(len(gene_names)), "trained": trained,
                      "cache_hit": not trained, "train_sec": train_sec}
    return result


@mcp.tool()
async def scgen_evaluate(
    source_h5ad: SourceH5ad,
    target_h5ad: TargetH5ad,
    stim_key: StimKey,
    source_name: SourceName = "source",
    target_name: TargetName = "target",
    ctrl_key: CtrlKey = "control",
    max_epochs: MaxEpochs = 100,
    batch_size: BatchSize = 2048,
    ctx: Context = None,
) -> list:
    """Evaluate the predicted perturbation against the OBSERVED truth in the target dataset.

    Returns cross-transfer PCC/R² (on ΔX̂) as text PLUS two canonical scGen figures inline as MCP
    images: `reg_mean_plot` and `reg_var_plot` (predicted vs observed mean / variance per gene,
    with the top-5 DEGs labelled and the top-100-DEG R²), parameterised like scgen-reproducibility.

    Use when the target dataset CONTAINS cells perturbed with `stim_key` (ground truth available,
    e.g. a Perturb-seq screen like Replogle): this is the validation / credibility signal — how
    well scGen's cross-cell prediction matches the real effect. (For prediction with no target
    truth, use scgen_transfer.)
    """
    if ctx:
        await ctx.info(f"evaluate: load + align + train ({max_epochs} epochs)…")
    adata_s, adata_t, adata_t_ctrl, adata_train, valid_perts = await asyncio.to_thread(
        core.load_and_prep, source_h5ad, target_h5ad, source_name, target_name)
    if stim_key not in valid_perts:
        return [json.dumps({"error": f"stim_key '{stim_key}' not observed in source perturbations"})]
    if stim_key not in set(adata_t.obs["perturbation"].unique()):
        return [json.dumps({"error": f"target has no observed '{stim_key}' cells — no ground "
                                     "truth to evaluate against; use scgen_transfer for prediction"})]
    # Reuse the warm VAE if scgen_transfer (or a prior eval) already trained this setup — the model
    # is stim-independent, so retraining here just to evaluate wastes a full GPU training run.
    key = model_key(source_h5ad, target_h5ad, source_name, target_name, max_epochs, batch_size)
    hit = cache.get(key)
    if hit is not None:
        model, _ctrl, _genes, _perts, train_sec = hit
        cache_hit = True
    else:
        model, _ctrl, _genes, _perts, train_sec = await _train_and_cache(
            key, adata_train, adata_t_ctrl, np.asarray(adata_t.var_names),
            valid_perts, max_epochs, batch_size, ctx)
        cache_hit = False
    pred_adata = await asyncio.to_thread(
        core.predict_full, model, adata_t_ctrl, stim_key, source_name, ctrl_key)
    delta = await asyncio.to_thread(core.delta_from_pred, pred_adata, adata_t_ctrl)
    true_delta, r2, pcc = await asyncio.to_thread(
        core.evaluate_against_truth, delta, adata_t, adata_t_ctrl, stim_key)

    prefix = f"/tmp/scgen_eval_{source_name}_{target_name}_{stim_key}"
    figs = []
    try:  # canonical reg_mean / reg_var (library, original params); failure must not sink the eval
        figs += await asyncio.to_thread(
            core.reg_plots, model, pred_adata, adata_t, stim_key, prefix, ctrl_key)
    except Exception as e:  # noqa: BLE001
        if ctx:
            await ctx.info(f"reg_mean/var plot skipped: {e!r}")

    metrics = {"method": "scgen_evaluate", "stim_key": stim_key,
               "pcc_cross": round(pcc, 4), "r2_cross": round(r2, 4),
               "n_genes": int(len(true_delta)), "train_sec": train_sec,
               "cache_hit": cache_hit, "plots": figs}
    return [json.dumps(metrics, ensure_ascii=False), *[Image(path=p) for p in figs]]


@mcp.tool()
async def check_inputs(source_h5ad: SourceH5ad, target_h5ad: TargetH5ad, stim_key: StimKey,
                       source_name: SourceName = "source",
                       target_name: TargetName = "target") -> dict:
    """Fast pre-flight (NO training): can these inputs run, and is `stim_key` observed in the
    source? Use before scgen_transfer to avoid wasting a GPU training run on a bad request."""
    issues = []
    try:
        adata_s, adata_t, _ctrl, _train, valid_perts = await asyncio.to_thread(
            core.load_and_prep, source_h5ad, target_h5ad, source_name, target_name)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "issues": [f"load/align failed: {e!r}"]}
    if "perturbation" not in adata_s.obs:
        issues.append("source has no obs['perturbation']")
    if stim_key not in valid_perts:
        issues.append(f"stim_key '{stim_key}' not in source perturbations "
                      f"({len(valid_perts)} observed)")
    return {"ok": not issues, "issues": issues,
            "n_observed_perturbations": len(valid_perts),
            "n_common_genes": int(adata_t.n_vars)}


@mcp.tool()
async def list_perturbation_methods() -> dict:
    """Return the scenario/applicability profile + reliability prior for each method served here.
    The agent uses this to route: pick the method whose scenario matches the query."""
    return {"methods": [SCGEN_PROFILE]}


def main():
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
