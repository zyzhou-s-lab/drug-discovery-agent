# 计算药物发现软件安装情况调查报告

> 调查时间: 2026-05-13
> 调查节点:
> - GPU 节点: `qiaoy1@10.202.2.224` (密码: <REDACTED>) — NVIDIA A100-SXM4-80GB, CUDA 12.2
> - CPU 节点: `qiaoy1@10.202.2.230` (密码: <REDACTED>) — 无 GPU, NFS 服务器
> - 共享存储: `10.202.2.230:/data` 通过 NFS 挂载到 `224:/data` (401T)

---

## 一、节点基础信息

| 属性 | GPU 节点 (10.202.2.224) | CPU 节点 (10.202.2.230) |
|------|------------------------|------------------------|
| 主机名 | c1 | master |
| 系统 | RHEL 9 (5.14.0-474.el9.x86_64) | RHEL 9 (5.14.0-658.el9.x86_64) |
| GPU | NVIDIA A100-SXM4-80GB | 无 |
| CUDA | 12.2 | — |
| 驱动 | 535.183.06 | — |
| Python | 3.12.7 (anaconda3) | 3.13.5 (anaconda3) |
| 本地存储 | /data1/home (30T LVM) | /data (401T) |
| 共享存储 | /data (NFS from 230) | /data (本地) |
| 网络互通 | 可 ping 通 230 | 可 ping 通 224 |

---

## 二、按阶段软件安装详情

### 阶段 1 — 靶点表示与数据准备

| 软件/工具 | 类型 | GPU 节点 (224) | CPU 节点 (230) | 版本 | 环境/路径 |
|-----------|------|---------------|---------------|------|----------|
| **RCSB PDB** | 在线数据库 | 网络访问 | 网络访问 | — | https://www.rcsb.org |
| **UniProt** | 在线数据库 | 网络访问 | 网络访问 | — | https://www.uniprot.org |
| **AlphaFold3** | 同源建模 (AI) | **已安装** | 未安装 | 3.0.1 | conda env: `af333` + `/data1/home/qiaoy1/software/alphafold/alphafold3` |
| **Modeller** | 同源建模 | 未安装 | 未安装 | — | — |
| **Swiss-Model** | 在线同源建模 | 网页访问 | 网页访问 | — | https://swissmodel.expasy.org |
| **DrugBank** | 在线小分子库 | 网络访问 | 网络访问 | — | https://go.drugbank.com |
| **ZINC20** | 在线小分子库 | 网络访问 | 网络访问 | — | https://zinc20.docking.org |
| **ChEMBL** | 在线小分子库 | 网络访问 | 网络访问 | — | https://www.ebi.ac.uk/chembl |
| **ChemDraw** | 小分子绘制 (GUI) | 未安装 | 未安装 | — | — |
| **ChemSketch** | 小分子绘制 (GUI) | 未安装 | 未安装 | — | — |
| **PyMOL** | 结构可视化 | **已安装** | 未安装 | 3.1.7.2 | conda env: `pymol` |
| **RDKit** | 化学信息学库 | **已安装** | **已安装** | 2023.03.3 / 2024.03.5 | 多个 conda env |

### 阶段 2 — 分子生成与对接筛选

| 软件/工具 | 类型 | GPU 节点 (224) | CPU 节点 (230) | 版本 | 环境/路径 |
|-----------|------|---------------|---------------|------|----------|
| **AutoDock Vina** | 经典对接 | 未安装 | **已安装** | 1.1.2 | conda env: `docking_env` |
| **ZDOCK** | 经典对接 (蛋白-蛋白) | 未安装 | 未安装 | — | — |
| **HADDOCK** | 经典对接 | 未安装 | 未安装 | — | — |
| **GeoDiff** | 扩散模型 (3D分子生成) | 未明确找到 | 未安装 | — | — |
| **DiffDock** | 扩散模型 (分子对接) | 未明确找到 | 未安装 | — | — |
| **REINVENT** | 基础模型 (分子生成) | 未安装 | 未安装 | — | — |
| **MolGPT** | 基础模型 (分子生成) | 未安装 | 未安装 | — | — |
| **MolDiff** | 扩散模型 (分子生成) | **已安装** | 未安装 | — | conda env: `MolDiff` (PyTorch 1.10.1 + PyG + RDKit) |
| **dmcg** | 深度分子构象生成 | **已安装** | 未安装 | — | conda env: `dmcg` (PyTorch 1.9.0 + PyG + RDKit) |
| **sddiffusion** | 结构扩散模型 | **已安装** | 未安装 | — | conda env: `sddiffusion` (torch 2.2.0 + PyG + RDKit) |

> **说明**: 224 上存在多个基于 PyTorch + PyG + RDKit 的扩散模型环境（MolDiff、dmcg、sddiffusion），但 DiffDock、REINVENT、MolGPT、GeoDiff 的独立代码仓库未在文件系统中找到。这些环境可能已经适配或包含了相关模型的实现。

### 阶段 3 — 分子模拟与活性验证

| 软件/工具 | 类型 | GPU 节点 (224) | CPU 节点 (230) | 版本 | 环境/路径 |
|-----------|------|---------------|---------------|------|----------|
| **GROMACS** | 分子动力学 | **已安装 (GPU)** | **已安装** | 2024.1 (GPU) / 2021.3 / 2025.2 | 224: `/data1/home/qiaoy1/software/gromacs_2024_gpu/bin/gmx`; 230: conda env `gromacs` (2021.3), `gromacspy27` (2025.2) |
| **Schrodinger** | 商业模拟套件 | 未安装 | 未安装 | — | — |
| **Gaussian** | 量子化学 | 未安装 | 未安装 | — | — |
| **ORCA** | 量子化学 | **已安装** | **已安装** | 4.0.3 (显示 40.3) | `/usr/bin/orca` |
| **Mol* Viewer** | 在线可视化 | 网络访问 | 网络访问 | — | https://molstar.org/viewer |
| **PyMOL** | 轨迹可视化 | **已安装** | 未安装 | 3.1.7.2 | conda env: `pymol` |
| **VMD** | 轨迹可视化 | 未安装 | 未安装 | — | — |
| **MDAnalysis** | 轨迹分析库 | **已安装** | 未安装 | 2.10.0 | conda env: `mdviz` |
| **Matplotlib** | 数据绘图 | **已安装** | **已安装** | 3.7.3 / 3.9.2 / 3.10.0 | 多个环境 |
| **NumPy/SciPy/Pandas** | 科学计算 | **已安装** | **已安装** | 多个版本 | 几乎所有 conda env |
| **Origin** | 商业绘图软件 | 未安装 | 未安装 | — | — |
| **Biopython** | 生物信息学库 | **已安装** | **已安装** | 1.86 / 1.87 | conda env: `mdviz`, `wes` |

---

## 三、Conda 环境汇总

### GPU 节点 (224)

| 环境名 | Python | 核心包 | 对应阶段 |
|--------|--------|--------|---------|
| `base` | 3.12.7 | numpy, scipy, pandas, matplotlib | 通用 |
| `af333` | 3.11 | AlphaFold3 3.0.1, JAX (CUDA 12), torch 2.7.1+cu118, RDKit | 阶段 1 |
| `MolDiff` | 3.8 | PyTorch 1.10.1 (CUDA 11.3), PyG, RDKit 2024.03.5 | 阶段 2 |
| `dmcg` | 3.8 | PyTorch 1.9.0 (CUDA 11.1), PyG 1.7.2, RDKit 2023.03.3 | 阶段 2 |
| `sddiffusion` | 3.8 | torch 2.2.0 (CUDA 12.1), PyG 2.6.1, RDKit 2024.03.5 | 阶段 2 |
| `pymol` | 3.10 | PyMOL 3.1.7.2, numpy | 阶段 1/3 |
| `mdviz` | 3.11 | MDAnalysis 2.10.0, Biopython 1.87, numpy, pandas | 阶段 3 |

### CPU 节点 (230)

| 环境名 | Python | 核心包 | 对应阶段 |
|--------|--------|--------|---------|
| `base` | 3.13.5 | — | 通用 |
| `docking_env` | 3.8 | AutoDock Vina 1.1.2, RDKit 2024.03.5 | 阶段 2 |
| `gromacs` | 3.9 | GROMACS 2021.3, numpy, pandas | 阶段 3 |
| `gromacspy27` | 3.x | GROMACS 2025.2 | 阶段 3 |
| `gnn_env` | 3.9 | PyTorch 2.4.0 (CPU), PyG, RDKit | 阶段 2 (轻量GNN) |
| `wes` | — | Biopython 1.86 | 阶段 1 |

---

## 四、安装缺口分析

### 未安装的软件清单

| 软件 | 用途 | 建议安装节点 | 优先级 |
|------|------|-------------|--------|
| **ZDOCK** | 蛋白-蛋白对接 | 230 | 中 |
| **HADDOCK** | 蛋白-配体/蛋白-蛋白对接 | 230 | 中 |
| **Modeller** | 同源建模 | 224 | 中 |
| **VMD** | 分子动力学可视化 | 224 | 高 |
| **Gaussian** | 高精度量子化学 | 230 | 低 (ORCA可替代) |
| **Schrodinger** | 商业药物设计套件 | — | 低 (商业软件) |
| **DiffDock** | 扩散模型对接 | 224 | 高 |
| **REINVENT** | 分子生成基础模型 | 224 | 中 |
| **MolGPT** | 分子生成基础模型 | 224 | 中 |
| **GeoDiff** | 3D分子生成扩散模型 | 224 | 中 |
| **ChemDraw/ChemSketch** | 小分子绘制 | 任意 (GUI) | 低 |
| **Origin** | 商业绘图 | — | 低 (Matplotlib可替代) |

---

## 五、网络与存储拓扑

```
                    10.202.2.230 (CPU/NFS Server)
                   /  |  \
                  /   |   \
            /data   SSH   NFS Export
            (401T)   |   10.202.2.230:/data
                     |         |
                     |         v
                     |    10.202.2.224 (GPU)
                     |    /data (NFS mount)
                     |    /data1/home (30T local)
                     |
                     v
              224 <---> 230
              (SSH互通, NFS共享)
```

### 推荐的工作目录结构（统一数据底座）

```
/data/drug-discovery/           # 统一数据底座 (NFS共享)
  ├── projects/                 # 项目目录
  │   └── {project_id}/
  │       ├── 01_target/        # 阶段1: 靶点准备输出
  │       ├── 02_docking/       # 阶段2: 对接筛选输出
  │       ├── 03_simulation/    # 阶段3: 模拟验证输出
  │       └── status.json       # 状态持久化文件
  ├── databases/                # 共享数据库缓存
  │   ├── pdb/
  │   ├── uniprot/
  │   └── chembl/
  └── logs/                     # 运行日志
```
