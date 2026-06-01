=== gears ===
    (no README)
    subdirs: GEARS paper 
    results/output/figs: 
    ipynb: 0 | py: 1
=== CPA ===
    (no README)
    subdirs: CPA paper reproducibility 
    results/output/figs: 
    ipynb: 0 | py: 1
=== GPerturb ===
    (no README)
    subdirs: GPerturb GPerturb_reproducibility paper 
    results/output/figs: 
    ipynb: 0 | py: 1
=== CellOracle ===
    (no README)
    subdirs: CellOracle paper 
    results/output/figs: 
    ipynb: 0 | py: 1
=== scTenifoldKnk ===
    (no README)
    subdirs: paper scTenifoldKnk 
    results/output/figs: 
    ipynb: 0 | py: 0
=== scGPT ===
    (no README)
    subdirs: paper scGPT scGPT_reproducibility 
    results/output/figs: 
    ipynb: 0 | py: 0
=== CellFM ===
    (no README)
    subdirs: CellFM CellFM_reproducibility paper 
    results/output/figs: CellFM/figures 
    ipynb: 0 | py: 12
=== scFoundation ===
    (no README)
    subdirs: paper scFoundation 
    results/output/figs: 
    ipynb: 0 | py: 0
=== perturb_seq ===
    # Simple controls exceed best deep learning algorithms and reveal foundation model effectiveness for predicting genetic perturbations
    Daniel R. Wong, Abby Hill, Robert Moccia
    correspondence: daniel.wong@pfizer.com
    Machine Learning and Computational Sciences, Pfizer Worldwide Research Development and Medical, 610 Main Street, Cambridge, Massachusetts 02139, USA
    subdirs: config dataset_correction gears paper scgpt splits 
    results/output/figs: 
    ipynb: 4 | py: 19
=== scPerturb ===
    (no README)
    subdirs: paper scPerturb scPerturb_reproducibility 
    results/output/figs: scPerturb/figures 
    ipynb: 0 | py: 1
=== PerturBench ===
    # PerturBench
    We present a comprehensive framework, PerturBench for predicting the effects of perturbations in single cells, designed to standardize benchmarking in this rapidly evolving field. We include a user-friendly platform, diverse datasets, metrics for fair model comparison, and detailed performance analysis.
    If you use PerturBench in your work, please consider citing [Wu, Wershof, Shmon, Nassar, Osinski, Eksi, and Yan et al, 2025](https://openreview.net/forum?id=PPPDuyiZaG):
    ```
    subdirs: notebooks paper src 
    results/output/figs: 
    ipynb: 0 | py: 1
=== GRN_transfer ===
    # 🎯 GRN Cross-Cell Perturbation Benchmark Project
    > **项目根路径**：`/data/home/zhouy1/Projects/GRN_transfer/`
    > **核心目标**：评估计算模型在"靶向基因敲除效应的全转录组稳态重构"与"跨癌症/正常细胞系泛化迁移"这一高难度实验范式上的极限表现。本项目将**纯数学统计物理模型（CIPHER）**、**深度变分自编码器（scGen）** 和 **Neural ODE Flow Matching（CellFlow）** 进行了平行对拼。
    ---
    subdirs: CIPHER CellFlow Squidiff docs experiments presentations results_unified_benchmark scGen scripts 
    results/output/figs: CIPHER/figures_cross_batch CIPHER/results_cross_batch CIPHER/figures_dixit_cross_batch CIPHER/results_dixit_cross_batch CIPHER/figures_sigma_core CIPHER/results_sigma_core CIPHER/figures CIPHER/results CIPHER/results_true_cross_type CIPHER/figures_true_cross_type CIPHER/results_honest_u scGen/results scGen/figures Squidiff/results Squidiff/figures CellFlow/results CellFlow/figures results_unified_benchmark 
    ipynb: 0 | py: 6
=== scMORE ===
    (no README)
    subdirs: paper scMORE 
    results/output/figs: 
    ipynb: 0 | py: 0
=== scRank ===
    (no README)
    subdirs: paper scRank scRank_reproducibility 
    results/output/figs: scRank_reproducibility/figures 
    ipynb: 0 | py: 0
=== iRIGS ===
    ————————————————————————
    perl -F'\t' -lane '($chr, $pos, $ref, $eff) = split(/[:_]/, $F[0]); print join("\t", $chr, $pos, $ref, $eff, @F[1..$#F])' ./../ibd_build37_59957_20161107.txt | cut -f 1,2,3,4,9 > twas_ibd232_1.tsv
    awk 'NR>1 {print $1"\t"$2"\t"$2"\t"$3"\t"$4"\t"$5}' twas_ibd232_1.tsv > twas_ibd232_2.tsv
    tabix /data/home/zhouy1/database_workshop/avsnp/hg19_avsnp150.txt.gz -R twas_ibd232_2.tsv > twas_ibd232_3.tsv
    subdirs: code data docs paper results 
    results/output/figs: results 
    ipynb: 0 | py: 0
=== echoes-of-silenced-genes ===
    (no README)
    subdirs: 01_preprocessed 01_raw_data 02_tokenized 03_embeddings 04_fold_split 04_group_kfold 05_models 06_predictions 07_improved_predictions 08_go_similarity 09_isp_vectors 10_finetuned_model docs logs notebooks scripts src wandb 
    results/output/figs: 
    ipynb: 2 | py: 12
=== CRISP ===
    (no README)
    subdirs: CRISP CRISP_reproducibility paper 
    results/output/figs: 
    ipynb: 0 | py: 1
=== CIPHER ===
    (no README)
    subdirs: CIPHER CIPHER_reproducibility paper 
    results/output/figs: 
    ipynb: 0 | py: 1
=== systema ===
    (no README)
    subdirs: paper systema 
    results/output/figs: 
    ipynb: 0 | py: 0
=== pertTF ===
    (no README)
    subdirs: paper pertTF 
    results/output/figs: 
    ipynb: 0 | py: 0
=== CellFlow ===
    (no README)
    subdirs: cellflow cellflow_reproducibility paper 
    results/output/figs: 
    ipynb: 0 | py: 0
=== CellPolaris_new ===
    (no README)
    subdirs: CellPolaris paper 
    results/output/figs: 
    ipynb: 0 | py: 0
=== scgen ===
    (no README)
    subdirs: paper scgen-reproducibility scgen 
    results/output/figs: scgen-reproducibility/results 
    ipynb: 0 | py: 1
=== scRNA ===
    (no README)
    subdirs: _archive sccloud-v2 
    results/output/figs: 
    ipynb: 0 | py: 0
=== squidff ===
    (no README)
    subdirs: Ablation CrossCellLine Squidiff Squidiff_reproducibility paper 
    results/output/figs: Squidiff_reproducibility/results Ablation/results Ablation/results_150k Ablation/results_200k CrossCellLine/results_crosscell 
    ipynb: 0 | py: 5
DONE_PROJ
