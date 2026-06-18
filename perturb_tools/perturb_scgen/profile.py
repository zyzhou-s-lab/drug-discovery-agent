"""Scenario profile for scGen — the routing card the agent reads to decide WHEN to pick it.

Returned by the `list_perturbation_methods` tool. Keep the `when_not` honest: scGen can only
transfer a perturbation that was OBSERVED in the source dataset (latent arithmetic), so it is
the wrong tool for de-novo / never-observed gene knockouts (use a zero-shot method there).
"""

SCGEN_PROFILE = {
    "name": "scgen_transfer",
    "summary": "VAE latent-arithmetic transfer of an OBSERVED perturbation/stimulus from a "
               "source cell type to a target cell type; returns the predicted per-gene effect "
               "(ΔX̂) ranking, optionally scored toward a target state.",
    "scenario": {
        "needs_observed_perturbation": True,      # source must contain stim_key's perturbation
        "zero_shot_to_unseen_genes": False,
        "cross_cell_type_transfer": True,         # its core strength
        "perturbation_type": "observed gene perturbation or stimulus/condition",
        "data_requirements": "source + target .h5ad with obs['perturbation'] (incl. 'control') "
                             "and a cell-type label; aligned to a common gene set",
        "output_granularity": "whole-transcriptome ΔX̂ -> per-gene direction ranking",
    },
    "when_to_use": "You observed perturbation P (a gene KO/OE or a stimulus) in an accessible "
                   "source cell type and want its transcriptomic response predicted in a "
                   "target (e.g. disease) cell type.",
    "when_not": "Do NOT use for a perturbation never observed in your data (no source data for "
                "that gene) — that is a zero-shot job (e.g. geneformer ISP). Not for ranking "
                "arbitrary candidate genes you have no perturbation data for.",
    "reliability_prior": "Cross-cell-type transfer PCC ~0.14-0.23 on Replogle K562<->RPE1 "
                         "(your GRN_transfer benchmark); honest zero-shot, not |corr|.",
    "cost": "Trains a VAE per (source,target) dataset (minutes, GPU); prediction per gene is "
            "then ~ms. Model is cached warm and idle-unloaded.",
}
