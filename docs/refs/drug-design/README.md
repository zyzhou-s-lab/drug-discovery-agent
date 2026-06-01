# 参考：计算药物发现/设计工具链（内部调查 + 参考流程）

来源：`gpu-zhouy1:~/Documents/notes/multiagents_ref/`（调查时间 2026-05-13）。密码已脱敏。

> ⚠️ **scope 提醒**：这批材料描述的是**计算药物「设计」（drug design）**——给定靶点后做结构准备 → 分子生成/对接筛选 → 分子动力学验证。它与本项目当前锚定的**「靶点发现」（target discovery，复现 dry-AMD→ROCK→ripasudil）相邻但不同**：设计是发现的**下游**。如何并入本项目 scope = **待定**（见 [../../DOMAIN.md](../../DOMAIN.md)）。

## 文件
- `software_survey.md` —— 集群上**实际安装**的药物发现软件调查（已脱敏密码）。
- `small-molecule-and-peptide-design-pathway.pdf` + `design_tools.png` —— 参考流程图（**小分子 + 多肽**，3 阶段 + 工具）。
- `design_structure.png` —— 该 3 阶段流程的「AI agent 编排（中枢调度）+ 统一数据知识底座」愿景图。

## 参考流程（3 阶段，小分子 + 多肽）
1. **靶点表示与数据准备**：PDB/UniProt；同源建模 Swiss-Model/Modeller/**AlphaFold(3)**；小分子库 DrugBank/ZINC20/ChEMBL；**多肽**专用库 APD3/DBAASP/SATPDB、折叠 PEP-FOLD4/AF2-Multimer、序列设计 Benchling/Helium。
2. **分子生成与对接筛选**：经典对接 AutoDock Vina/Glide、**多肽** ClusPro PeptiDock/ADCP/HADDOCK/Rosetta FlexPepDock；AI 扩散 GeoDiff/DiffDock、**多肽** RFdiffusion/ProteinMPNN；AI 基础 REINVENT/MolGPT；环化设计 CycloPs/Rosetta。
3. **分子模拟与活性验证**：GROMACS/Schrodinger、量子化学 Gaussian/ORCA、增强采样 Metadynamics/REMD、专用力场 AMBER14SB/CHARMM36m、可视化 Mol*/PyMOL/VMD、分析 matplotlib/Origin。

## 实机已装（决定我们的工具层能 wrap 什么）
节点：GPU `10.202.2.224`（= c1 = gpu-zhouy1，**但软件装在 `qiaoy1` 账户下**）、CPU `10.202.2.230`、共享 `/data`（401T, NFS）。
- **已装**：AlphaFold3(`af333`)、RDKit、PyMOL、AutoDock Vina(`230:docking_env`)、GROMACS(GPU+CPU)、ORCA、MDAnalysis、Biopython、扩散模型 MolDiff/dmcg/sddiffusion。
- **缺口**：DiffDock、REINVENT、MolGPT、GeoDiff、Modeller、VMD、Schrodinger、Gaussian（高优先：VMD、DiffDock）。
- 推荐数据底座：`/data/drug-discovery/projects/{id}/{01_target,02_docking,03_simulation}/ + status.json + databases/{pdb,uniprot,chembl}/ + logs/`。

## ⚠️ 访问与归属（关键约束，落地前必须解决）
- 工具链装在**协作者 `qiaoy1` 的账户/家目录**（`/data1/home/qiaoy1/...` + 其 conda env）。本项目 agent 跑在 **`zhouy1`**，**很可能无权**访问 qiaoy1 私有 home（`drwx------`）或激活其 conda env。
- **共享 `/data`（401T NFS）可访问**——`qiaoy1` 推荐的 `/data/drug-discovery/` 底座正好落在这里。
- 复用"已装工具链"前必须三选一：① 经 qiaoy1 协作；② 把工具/env 迁到共享 `/data`；③ `zhouy1` 自装。否则无法兑现。

## 与本项目的接法（一种候选，待 scope 决定）
若保持"靶点发现"主线：这套**设计**流程对应本项目的**下游阶段**——
- 参考流程 stage 2（分子生成/对接）≈ 本项目 `candidate-generation`（用 Vina/扩散模型/RDKit）。
- 参考流程 stage 3（MD/活性验证）≈ 本项目 `data-analysis`（用 GROMACS/ORCA/MDAnalysis）。
- 参考流程 stage 1（靶点结构准备，AlphaFold3）= 发现→设计的**桥接**（拿到候选靶点后准备其结构）。
- 「统一数据知识底座」愿景图 ≈ 本项目的 **index / 权威数据源**（落在共享 `/data`）。
