# 靶点验证（target-validation）：多角度计算/实验验证

> 给发现段补上**实验验证**环节（逻辑链条 [discovery-logic-chain.md](discovery-logic-chain.md) 的 Step 4 落成一个 pipeline 阶段）。验证 = **多条正交角度交叉确认**候选靶点的因果性与可干预性，再交付设计段。
>
> 调研依据：`gpu-zhouy1:~/Projects/`（已收集项目 + 已做实验）、`cpu-zhouy1:~/software/`（已部署工具）、`/data`（数据库）、+ 文献。原始日志见 `refs/validation-*`。生物学阈值待领域专家核定。

---

## 一、验证角度 → 方法 → 本地工具（核心映射）

✅=本地已装/已有数据　🟡=已做过实验　⬚=需安装/外部

| 角度 | 验证什么 | 方法 | 本地工具 / 数据（机器） |
|---|---|---|---|
| **A. TWAS** | 遗传预测的基因表达是否与疾病关联 | FUSION / S-PrediXcan | ✅ `cpu:~/software/fusion_twas-master`（FUSION）、✅ `/data/.../databases20210723/Predixcan`、🟡 `gpu:~/Projects/iRIGS`（已对 IBD 做 TWAS：sumstats→avsnp/tabix→TWAS） |
| **B. 共定位 colocalization** | GWAS 信号与 eQTL/pQTL 是否共享因果变异 | coloc / eCAVIAR / SMR | ⬚ coloc/SMR 未部署（R 易装）；数据 ✅ GTEx eQTL（本地）、Open Targets |
| **C. 孟德尔随机化 MR** | 基因(表达/蛋白)对疾病是否**因果** | eQTL-MR / pQTL-MR / SMR / TwoSampleMR | ⬚ TwoSampleMR/SMR 未部署（R 易装）；✅ `cpu:ldsc`（遗传相关/约束，MR 邻接）；数据 ✅ UKBioBank、eQTLGen(在线) |
| **D. GWAS / 遗传度 / 富集** | 位点注释、遗传度、细胞类型/通路富集 | LDSC（h²、rg、partitioned）、ANNOVAR | ✅ `cpu:ldsc`、✅ `cpu:annovar`(+anovardatabase)、✅ GWAS Catalog/FinnGen(在线)、✅ UKBioBank(本地) |
| **E. in-silico 基因扰动/敲除** | **干预靶点是否能逆转/重构疾病转录组** | GRN 推断 + in-silico KO、扰动预测模型 | 🟡 `gpu:~/Projects/GRN_transfer`（CIPHER/scGen/CellFlow/Squidiff 基准，**靶向 KO 全转录组重构 + 跨细胞系迁移，已跑**）、✅ CellOracle、✅ scTenifoldKnk（in-silico KO）、✅ GEARS/CPA/GPerturb/scGPT/scFoundation/CellFM（扰动预测）、🟡 `echoes-of-silenced-genes`（in-silico perturbation vectors）、✅ PerturBench（基准）、scPerturb/perturb_seq（perturb-seq 数据） |
| **F. 表达 / 细胞类型特异性** | 靶点是否在疾病相关细胞类型表达 | 单细胞/空间图谱、细胞类型排序 | ✅ GTEx（本地）、✅ 单细胞数据（`database_workshop/cellfm`、`tahoe_100m`）、✅ scRank/scMORE（细胞类型相关性）、`/data/software/scRNAseq`(cellranger) |
| **G. 网络 / 模块** | 靶点在疾病模块中是否中心 | PPI 中心性、GRN、知识图谱 | ✅ STRING(在线)、✅ `cpu:neo4j` + `/data/.../DRKG`(药物重定位 KG)、GRN_transfer/CellOracle GRN |
| **H. 功能基因组学 / CRISPR** | 实验依赖性/必需性 | CRISPR 筛选、perturb-seq、DepMap | ⬚ DepMap(在线 API)；perturb-seq 公开数据 ✅(scPerturb)；**新湿实验需协作**（标注） |
| **I. 安全性 / 约束** | on-target 安全 | gnomAD LoF 约束、组织表达 | ✅ gnomAD(在线)、✅ GTEx、HGNC |

> **资源富集度**：A/D/E/F/G 在本地非常充分（尤其 **E 基因扰动** 有自建并跑过的 GRN_transfer 基准 + 一整套扰动模型）；**B/C（coloc/MR）是主要缺口**，但只需在 R 里装 `coloc`/`TwoSampleMR`/`SMR`，数据(GTEx/eQTLGen/UKB)已具备。

---

## 二、文献支撑（关键方法/资源）

- **遗传证据→靶点（总）**：Lessard 2024《Leveraging large-scale multi-omics evidences to identify therapeutic targets from GWAS》(`10.1186/s12864-024-10971-2`)；Kreitmaier & Zeggini 2022《multi-omics integration in complex disease tissues》(`10.1016/j.tig.2022.08.005`)；Claussnitzer 2020《A brief history of human disease genetics》(`10.1038/s41586-019-1879-7`)。
- **MR / 因果**：Hemani 2018《MR-Base / TwoSampleMR》(`10.7554/elife.34408`)；pQTL-MR 示例 Sun 2023（血浆蛋白组→结直肠癌靶点 `10.1186/s13073-023-01229-9`）、Sun 2024（多组学 MR→GSTM4 偏头痛 `10.1186/s10194-024-01828-w`）。
- **TWAS**：整合蛋白组+转录组定位因果基因 Wu 2022（卒中 `10.1186/s12967-022-03377-9`）、Wingo 2022（PTSD 脑蛋白组 `10.1038/s41380-022-01544-4`）；候选因果基因 Valette 2021（哮喘/UKB `10.1038/s42003-021-02227-6`）。
- **GWAS 资源**：FinnGen Kurki 2023 (`10.1038/s41586-022-05473-8`)、GWAS primer Uffelmann 2021 (`10.1038/s43586-021-00056-9`)。
- **GRN 推断 / in-silico**：GENIE3 Huynh-Thu 2010 (`10.1371/journal.pone.0012776`)、DREAM5 "wisdom of crowds" Marbach 2012 (`10.1038/nmeth.2016`)、GeneNetWeaver Schaffter 2011 (`10.1093/bioinformatics/btr373`)、Geneformer Theodoris 2023 (`10.1038/s41586-023-06139-9`)、RegVelo Wang 2024 (`10.1016/j.cell.2026.04.022`)、Enformer Avsec 2021（序列→表达，变异效应 `10.1038/s41592-021-01252-x`)。
- **CRISPR 功能基因组**：Park 2025 perturbomics (`10.1038/s12276-025-01487-0`)、He 2025 (`10.1016/j.jpha.2025.101357`)。
- **多组学疾病**：Hasin 2017 (`10.1186/s13059-017-1215-1`)。

---

## 三、`target-validation` 阶段设计（scatter-gather：动态规划 → 并行角度节点 → 聚合 → judge）

**位置**：`target-selection`(stage 3) 之后、`structure-prep` 之前（DOMAIN §5 stage 4）。**结构 = fan-out / 聚合 / 判定**（审计采用并行 worker 节点，非单节点内 fan-out；理由见 [ARCHITECTURE §3.7](ARCHITECTURE.md)）：

1. **规划（planner 节点，无状态）**：输入 = 选定靶点 + 疾病 + stage 2 文献证据；输出 = 类型化 `ValidationPlan`——按本靶点**动态选**哪些角度 + 每角度用菜单里哪个工具。**模式 (a)**：只从「已封装工具菜单」里选（(b) 自动封装未接工具 / (c) 安装新工具算法 = 未来规划）。plan **记入 index**（可复现），且**有界**（角度数/预算上限 + 每角度理由）。
2. **分层 fan-out（并行角度节点）**：Runner 据 plan 并行起 worker 节点，**一个角度 = 一个节点工作流**（算法封装为工具调用，**不为单个工具单开 session**——见 ARCHITECTURE §3.7B）。**Cost-aware 两段**：先跑便宜角度（遗传/表达/网络，API/本地，分钟级）作廉价 gate；过了再跑贵的（in-silico 扰动 GPU、MD，小时级，长算用 submit→resume）。每节点输出类型化 `ValidationResult`。
3. **聚合（gather）**：确定性代码（`index.converge`）把各 `ValidationResult` 并成一个结构；仅当需推理调和矛盾时才用一个 synthesis 节点。
4. **判定 + 转移**：**无状态 judge** 出类型化 verdict；**状态机转移留在 Runner**（judge 只出裁决，不在节点里跑状态机——§3.6/§3.4）。

**角度节点（从菜单按需选，非全跑）**：`genetics-validator`(TWAS FUSION/iRIGS + coloc/MR) · `perturbation-validator`(in-silico KO GRN_transfer/CellOracle/scTenifoldKnk + GEARS) · `expression-validator`(单细胞/GTEx) · `network-validator`(STRING/DRKG) · `safety-validator`(gnomAD/GTEx)。

**judge rubric（验证段）**：**证据加权**（因果遗传 A/B/C > 相关性），**非简单计票**；通过 ⟺ 加权分 ≥ 阈值且 ≥1 因果遗传 + ≥1 功能(E/H) 同向；**冲突是一等输出**（如遗传 no、扰动 yes → 标低置信 / 经 index 上报，不强行多数决）；不足或冲突 → `missing`/`conflicts` 驱动回 stage 1/3 重排或补证据。

---

## 四、anchor（dry AMD）应用

- **补体 (CFH/C3)**：A/B/C/D 强（CFH 单倍型、AMD GWAS 34 loci、补体遗传度）+ F（RPE/脉络膜表达）→ 多角度通过，**genetics-first 的合法 top 靶点**。
- **ROCK**：遗传(A-D)弱，但 **E in-silico 扰动**（GRN_transfer/CellOracle 预测 KO 对 RPE/纤维化签名的影响）+ 机制文献(F/G) → 作为**机制/repurposing 候选**通过，交设计段做 ripasudil 对接/MD 正对照。
- 这正好检验"验证段需多角度"：补体走遗传主线、ROCK 走扰动/机制主线，**judge 综合而非单一来源**。

---

## 五、缺口与建议

| 缺口 | 影响 | 建议 |
|---|---|---|
| coloc / SMR / TwoSampleMR 未部署 | B/C 角度暂缺 | 新建 `dd-genetics` R env：`coloc`、`TwoSampleMR`、`MendelianRandomization`、`smr`（数据 GTEx/eQTLGen/UKB 已备） |
| DepMap / 新 CRISPR 依赖 | H 角度本地缺 | DepMap 在线 API；新湿实验走协作 |
| python 小缺口 | A/E 脚本 | `gseapy`/`mygene`/`biopython`（见 discovery-logic-chain §五） |
| 工具分散在 zhouy1 多项目 | 调用零散 | 统一封装为 MCP/CLI 工具（`twas`/`mr`/`insilico_ko`/`coloc`），供 `target-validation` 节点调用 |

> 关键判断：**「基因扰动」这一角度本地最强**（GRN_transfer 已建基准 + 一整套扰动模型），应作为验证段的**特色主力**；遗传因果（TWAS 强、coloc/MR 待补 R 包）次之；二者正交，组合即可给出可靠验证。
