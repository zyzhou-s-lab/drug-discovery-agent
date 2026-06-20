"""scGen cross-cell perturbation transfer — core train / predict / effect logic.

Faithfully reproduces the ΔX̂ pipeline of
  GRN_transfer/scGen/scripts/replogle_transfer/run_scgen_benchmark.py :: run_scgen_oos_transfer
i.e. data prep (CIPHER get_matched_data) -> setup_anndata -> SCGEN.train -> model.predict ->
ΔX̂ = pred.mean(0) - target_control.mean(0). Only the *production* path is kept: the u_opt
scaling and R²/PCC in the benchmark use ground-truth target deltas and are evaluation-only.

Runs in the `scgen` conda env on gpu-zhouy1 (scgen 2.0.0 + scvi-tools 1.3.3). CIPHER's
preprocess module is reached via the path in env CIPHER_PATH (default: the repo checkout).
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
from scipy.sparse import issparse

# Two local paths the research relies on (the benchmark hard-codes them at its top):
#  - CIPHER's get_matched_data for source/target gene alignment.
#  - the LOCAL scgen clone, deliberately used over the pip/env scgen ("bypass pypi breaking
#    changes" per run_scgen_benchmark.py). Imports MUST resolve to this one for fidelity.
# NB: the benchmark's hard-coded /data/home/... paths are stale (home moved to /data1); these
# defaults point at the current locations and are overridable via env.
_CIPHER_PATH = os.environ.get(
    "CIPHER_PATH", "/data1/home/zhouy1/Projects/2025/CIPHER/CIPHER"
)
_SCGEN_PATH = os.environ.get(
    "SCGEN_PATH", "/data1/home/zhouy1/Projects/2019/scgen/scgen"
)


def _ensure_scgen_on_path() -> None:
    """Put the local scgen clone first so `import scgen` resolves to it, not the env's pip scgen."""
    if _SCGEN_PATH not in sys.path:
        sys.path.insert(0, _SCGEN_PATH)


def _dense(x):
    return x.toarray() if issparse(x) else np.asarray(x)


def load_and_prep(source_path, target_path, source_name, target_name,
                  expression_threshold=1.0, min_samples=100):
    """Load + align source/target, build the OOS training adata (ALL source + ONLY target
    controls). Returns (adata_s, adata_t, adata_t_control, adata_train, valid_perts)."""
    if _CIPHER_PATH not in sys.path:
        sys.path.insert(0, _CIPHER_PATH)
    import anndata as ad
    from src.preprocess import get_matched_data  # noqa: E402 — CIPHER, path-injected above

    adata_s, adata_t, _, _ = get_matched_data(
        source_path, target_path,
        expression_threshold=expression_threshold, min_samples=min_samples,
    )
    adata_s.obs["cell_type"] = source_name
    adata_t.obs["cell_type"] = target_name
    adata_t_control = adata_t[adata_t.obs["perturbation"] == "control"].copy()
    adata_train = ad.concat([adata_s, adata_t_control])
    # the perturbations scGen can transfer = those OBSERVED in the source (excl. control/combos)
    valid_perts = {p for p in adata_s.obs["perturbation"].unique()
                   if p != "control" and "_" not in str(p)}
    return adata_s, adata_t, adata_t_control, adata_train, valid_perts


def train_model(adata_train, epochs=100, batch_size=2048):
    """setup_anndata + SCGEN.train (verbatim keys from the benchmark). Returns (model, seconds)."""
    _ensure_scgen_on_path()
    import scgen

    scgen.SCGEN.setup_anndata(adata_train, batch_key="perturbation", labels_key="cell_type")
    model = scgen.SCGEN(adata_train)
    t0 = time.time()
    model.train(max_epochs=epochs, batch_size=batch_size, early_stopping=False)
    return model, round(time.time() - t0, 1)


def predict_delta(model, adata_t_control, stim_key, source_name, ctrl_key="control"):
    """ΔX̂ for one perturbation (stim_key) — the benchmark's `pred_delta_target` (raw, unscaled).

    ΔX̂ = mean(predicted target expression) - mean(target control expression).
    """
    X_ctrl_mean = _dense(adata_t_control.X).mean(axis=0)
    pred_adata, _ = model.predict(
        ctrl_key=ctrl_key,
        stim_key=stim_key,
        adata_to_predict=adata_t_control.copy(),
        restrict_arithmetic_to={"cell_type": [source_name]},
    )
    pred_mean = _dense(pred_adata.X).mean(axis=0)
    return np.asarray(pred_mean - X_ctrl_mean, dtype=float)


def predict_full(model, adata_t_control, stim_key, source_name, ctrl_key="control"):
    """Run scGen predict ONCE and return the full predicted AnnData (so ΔX̂ and the reg plots
    can reuse it without predicting twice)."""
    pred_adata, _ = model.predict(
        ctrl_key=ctrl_key, stim_key=stim_key,
        adata_to_predict=adata_t_control.copy(),
        restrict_arithmetic_to={"cell_type": [source_name]},
    )
    return pred_adata


def delta_from_pred(pred_adata, adata_t_control):
    ctrl_mean = _dense(adata_t_control.X).mean(axis=0)
    return np.asarray(_dense(pred_adata.X).mean(axis=0) - ctrl_mean, dtype=float)


def compute_deg(adata_t, stim_key, ctrl_key="control", n_genes=100):
    """The original scGen DEG list (scgen-reproducibility Fig2-5): wilcoxon rank_genes_groups of
    the REAL perturbation vs control, top n_genes — used for gene_list (labels) + top_100_genes."""
    import scanpy as sc

    sub = adata_t[adata_t.obs["perturbation"].isin([ctrl_key, stim_key])].copy()
    sc.tl.rank_genes_groups(sub, groupby="perturbation", n_genes=n_genes, method="wilcoxon")
    return [str(g) for g in sub.uns["rank_genes_groups"]["names"][stim_key]]


def reg_plots(model, pred_adata, adata_t, stim_key, out_prefix, ctrl_key="control"):
    """The canonical scGen `reg_mean_plot` + `reg_var_plot` (predicted vs OBSERVED perturbed
    cells), parameterised exactly like scgen-reproducibility: axis_keys x=pred / y=real, empty
    labels, gene_list = top-5 DEG (labelled on the plot), top_100_genes = top-100 DEG (for the
    DEG R²). Reuses the library methods; returns the saved PNG paths."""
    import anndata as ad

    deg = compute_deg(adata_t, stim_key, ctrl_key, n_genes=100)
    pred = pred_adata.copy()
    pred.obs["perturbation"] = "pred"
    real = adata_t[adata_t.obs["perturbation"] == stim_key].copy()
    combined = ad.concat([pred, real], join="inner")
    common = dict(axis_keys={"x": "pred", "y": stim_key}, labels={"x": "", "y": ""},
                  gene_list=deg[:5], top_100_genes=deg, save=True, show=False)
    paths = []
    p_mean = f"{out_prefix}_reg_mean.png"
    model.reg_mean_plot(combined, path_to_save=p_mean, **common)
    paths.append(p_mean)
    p_var = f"{out_prefix}_reg_var.png"
    model.reg_var_plot(combined, path_to_save=p_var, **common)
    paths.append(p_var)
    return paths


def evaluate_against_truth(pred_delta, adata_t, adata_t_control, stim_key):
    """Compare predicted ΔX̂ to the OBSERVED truth in the target dataset (needs target cells that
    were actually perturbed with stim_key). Returns (true_delta, r2, pcc) — same score() as the
    benchmark (R²=1-SSE/SST and Pearson, over genes with non-zero true delta)."""
    from scipy.stats import pearsonr

    ctrl_mean = _dense(adata_t_control.X).mean(axis=0)
    X_pert = _dense(adata_t[adata_t.obs["perturbation"] == stim_key].X)
    true_delta = np.asarray(X_pert.mean(axis=0) - ctrl_mean, dtype=float)
    valid = np.abs(true_delta) > 0
    r2 = 1.0 - np.sum((true_delta[valid] - pred_delta[valid]) ** 2) / (np.sum(true_delta[valid] ** 2) + 1e-8)
    pcc = float(pearsonr(true_delta[valid], pred_delta[valid])[0])
    return true_delta, float(r2), pcc


def plot_pred_vs_true(pred_delta, true_delta, stim_key, pcc, r2, path):
    """Canonical scGen-style predicted-vs-real plot (here on ΔX̂): per-gene scatter + identity
    line + PCC/R². Saves a PNG and returns its path. Needs ground truth (evaluate mode only)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.figure(figsize=(5, 5))
    plt.scatter(true_delta, pred_delta, s=6, alpha=0.4, edgecolor="none")
    lim = float(max(np.abs(true_delta).max(), np.abs(pred_delta).max())) * 1.05
    plt.plot([-lim, lim], [-lim, lim], "r--", lw=1)
    plt.axhline(0, color="grey", lw=0.5)
    plt.axvline(0, color="grey", lw=0.5)
    plt.xlim(-lim, lim)
    plt.ylim(-lim, lim)
    plt.xlabel("observed ΔX̂ (true)")
    plt.ylabel("predicted ΔX̂")
    plt.title(f"scGen  {stim_key}  pred vs true ΔX̂\nPCC={pcc:.3f}   R²={r2:.3f}")
    plt.tight_layout()
    plt.savefig(path, dpi=120, bbox_inches="tight")
    plt.close()
    return path


def rank_effect(delta, gene_names, target_signature=None, top_k=50):
    """Level-1 output: per-gene effect ranking (default) + optional toward-goal alignment.

    - ranking: top_k genes by |ΔX̂|, each with delta + up/down direction.
    - toward_goal_proj: when a target_signature (healthy-minus-disease direction, {gene: weight})
      is given, the cosine alignment of ΔX̂ with that direction — overall "does this perturbation
      push toward the goal state" (parity with geneformer's shift-to-goal).
    """
    gene_names = np.asarray(gene_names)
    order = np.argsort(-np.abs(delta))
    ranking = [{"gene": str(gene_names[i]), "delta": float(delta[i]),
                "direction": "up" if delta[i] > 0 else "down"}
               for i in order[:top_k]]
    result = {"ranking": ranking}
    if target_signature:
        sig = np.array([float(target_signature.get(str(g), 0.0)) for g in gene_names])
        denom = float(np.linalg.norm(delta) * np.linalg.norm(sig)) + 1e-8
        result["toward_goal_proj"] = float(np.dot(delta, sig) / denom)
    return result
