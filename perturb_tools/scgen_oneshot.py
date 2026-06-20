#!/usr/bin/env python3
"""scgen_oneshot.py — one-shot scGen compute (run in the `scgen` conda env).

Reads ONE JSON request on stdin, runs the requested op, prints ONE JSON result to stdout,
exits. No server, no port. The MCP layer (in the dda process, dda venv) shells out to this
per call: `scgen_env/bin/python scgen_oneshot.py < request.json`.

Request: {"op": "transfer"|"evaluate"|"check_inputs", "source_h5ad", "target_h5ad",
          "stim_key", "source_name"?, "target_name"?, "ctrl_key"?, "max_epochs"?,
          "batch_size"?, "top_k"?, "target_signature"?, "out_prefix"?}
Result (stdout, last line = JSON):
  transfer    -> {ranking, toward_goal_proj?, meta}
  evaluate    -> {pcc_cross, r2_cross, n_genes, train_sec, plots:[png paths]}
  check_inputs-> {ok, issues, n_observed_perturbations, n_common_genes}
Errors -> {"error": "..."}. All non-result chatter (warnings/training bars) goes to stderr.
"""
import contextlib
import json
import sys

from perturb_scgen import scgen_core as core

# stdout must carry ONLY the final JSON. Library code (CIPHER get_matched_data, lightning bars)
# prints to stdout; route all of that to stderr, and emit the result to the real stdout.
_REAL_STDOUT = sys.stdout


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), file=_REAL_STDOUT, flush=True)


def _run(req):
    op = req["op"]
    src, tgt = req["source_h5ad"], req["target_h5ad"]
    sname = req.get("source_name", "source")
    tname = req.get("target_name", "target")
    stim = req["stim_key"]
    ctrl = req.get("ctrl_key", "control")
    epochs = int(req.get("max_epochs", 100))
    bs = int(req.get("batch_size", 2048))

    adata_s, adata_t, adata_t_ctrl, adata_train, valid = core.load_and_prep(src, tgt, sname, tname)

    if op == "check_inputs":
        issues = []
        if "perturbation" not in adata_s.obs:
            issues.append("source has no obs['perturbation']")
        if stim not in valid:
            issues.append(f"stim_key '{stim}' not in source perturbations ({len(valid)} observed)")
        return _emit({"ok": not issues, "issues": issues,
                      "n_observed_perturbations": len(valid), "n_common_genes": int(adata_t.n_vars)})

    if stim not in valid:
        return _emit({"error": f"stim_key '{stim}' was not observed in the source perturbations",
                      "n_observed_perturbations": len(valid)})

    model, train_sec = core.train_model(adata_train, epochs, bs)

    if op == "transfer":
        delta = core.predict_delta(model, adata_t_ctrl, stim, sname, ctrl)
        res = core.rank_effect(delta, adata_t.var_names, req.get("target_signature"),
                               int(req.get("top_k", 50)))
        res["meta"] = {"method": "scgen_transfer", "stim_key": stim,
                       "train_sec": train_sec, "n_genes": int(adata_t.n_vars)}
        return _emit(res)

    if op == "evaluate":
        if stim not in set(adata_t.obs["perturbation"].unique()):
            return _emit({"error": f"target has no observed '{stim}' cells — no ground truth"})
        pred = core.predict_full(model, adata_t_ctrl, stim, sname, ctrl)
        delta = core.delta_from_pred(pred, adata_t_ctrl)
        true_delta, r2, pcc = core.evaluate_against_truth(delta, adata_t, adata_t_ctrl, stim)
        prefix = req.get("out_prefix", f"/tmp/scgen_eval_{sname}_{tname}_{stim}")
        figs = []
        try:
            figs = core.reg_plots(model, pred, adata_t, stim, prefix, ctrl)
        except Exception as e:  # noqa: BLE001 — a plot failure must not sink the result
            print(f"reg_plots skipped: {e!r}", file=sys.stderr)
        return _emit({"method": "scgen_evaluate", "stim_key": stim,
                      "pcc_cross": round(pcc, 4), "r2_cross": round(r2, 4),
                      "n_genes": int(len(true_delta)), "train_sec": train_sec, "plots": figs})

    return _emit({"error": f"unknown op '{op}'"})


def main():
    req = json.load(sys.stdin)
    # everything the compute prints to stdout -> stderr; only _emit reaches the real stdout.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            _run(req)
        except Exception as e:  # noqa: BLE001 — surface as a JSON error, never a stack trace on stdout
            _emit({"error": repr(e)})


if __name__ == "__main__":
    main()
