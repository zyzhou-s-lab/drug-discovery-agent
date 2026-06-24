# 靶点发现逻辑链条 + 数据可得性报告

> 🟢 **STATUS：TIMELESS（领域科学调研）** · as-of 2026-06-24（调研日 2026-05-31）· stack: 语言无关
> 文献逻辑链 + 集群数据可得性，不受语言重写 / scope 收窄影响。是发现段（无论将来在哪个栈重建）的科学依据。

> 调研方法：用 `gpu-zhouy1:~/.agents/skills/paper-fetch`（OpenAlex + Semantic Scholar + Europe PMC 聚合检索）做文献检索梳理逻辑链条；在 gpu-zhouy1 / cpu-zhouy1 / 共享 `/data` 上调研所需数据。原始检索日志见 [`refs/discovery-literature-search.md`](refs/discovery-literature-search.md)，原始数据调研见 [`refs/cluster-data-survey.md`](refs/cluster-data-survey.md)。日期 2026-05-31。
>
> 本报告填充 [DOMAIN.md](DOMAIN.md) 发现段（stage 1-4，含 `target-validation`）的 `DOMAIN-FILL`。验证段的多角度工具映射与 scatter-gather 结构另见 [target-validation.md](target-validation.md)。生物学阈值仍需领域专家最终核定。

---

## 一、完整的靶点发现逻辑链条（文献支撑）

目标：`疾病 → 优先排序、且有证据支撑的可成药靶点 → 交付设计段`。这是**多条正交证据汇聚 + 评分 + 验证**的链条，不是单一来源。

```
Step 0  疾病定义        疾病 → 本体映射(EFO/MONDO)、亚型、相关组织/细胞
   │
Step 1  候选靶点提名     ┌── 1a 人类遗传学   GWAS / 罕见&LoF变异 / 孟德尔(OMIM)
   │   (多条正交证据)    ├── 1b 因果遗传学   MR + 共定位 on 可成药基因组 / eQTL·pQTL / TWAS
   │                    ├── 1c 表达          bulk/单细胞/空间转录组、疾病相关细胞类型、扰动签名(L1000)
   │                    ├── 1d 功能基因组学   CRISPR 筛选(perturbomics) → 因果依赖
   │                    ├── 1e 网络/通路      PPI(STRING)、通路富集(Reactome/KEGG/GO)、网络传播/疾病模块
   │                    └── 1f 文献/知识图谱   文本挖掘、知识图谱(DRKG)、已知靶点库(Open Targets/TTD)
   │
Step 2  证据整合+优先化  汇总各证据 → 关联打分(Open Targets association score)→ 候选排序
   │
Step 3  靶点三联评估     ┌── 3a 临床先例   已有药/试验(Open Targets/ChEMBL/TTD)
   │                    ├── 3b 可成药性    小分子口袋/抗体可及/PROTAC 可降解(tractability)
   │                    └── 3c 安全性      遗传约束(gnomAD LoF)、组织表达特异性(GTEx)、必需性、已知毒性
   │
Step 4  靶点验证         遗传验证(MR方向一致) + 功能验证(CRISPR KO/KD、疾病模型/类器官) + 机制/biomarker
   │
Step 5  交付            优先排序 + 已验证靶点 + 可追溯证据档案 → 设计段(structure-prep)
```

**关键文献支撑（DOI）：**

- **链条总览**：Hughes 2010《Principles of early drug discovery》(`10.1111/j.1476-5381.2010.01127.x`)；Pun, Ozerov, Zhavoronkov 2023《AI-powered therapeutic target discovery》(`10.1016/j.tips.2023.06.010`)。
- **1a/1b 遗传学是最强先验**：Nelson 2015《genetic evidence support for approved drug indications》(`10.1038/ng.3314`，遗传支持≈2× 成功率)；**Minikel 2024**《Refining the impact of genetic evidence on clinical success》(`10.1038/s41586-024-07316-0`)；Reay & Cairns 2021《GWAS for drug repurposing》(`10.1038/s41576-021-00387-z`）；Storm 2021《MR of the druggable genome (Parkinson's)》(`10.1038/s41467-021-26280-1`，**MR-of-druggable-genome 是标准配方**，文献里对 RA/Sjögren/AF/myopia/AKI/aging 反复出现)。
- **2/3 整合与三联评估（核心方法论）**：**McDonagh/Trynka/McCarthy 2024**《Human Genetics and Genomics for Drug Target Identification and Prioritization: Open Targets' Perspective》(`10.1146/annurev-biodatasci-102523-103838`)——明确"clinical precedence / tractability / safety"打分框架；Zhou 2023《TTD》(`10.1093/nar/gkad751`)。
- **3b 可成药性**：Schneider 2021《The PROTACtable genome》(`10.1038/s41573-021-00245-x`)。
- **3c 安全性/约束**：Karczewski 2020《gnomAD mutational constraint (141k)》(`10.1038/s41586-020-2308-7`)；组织特异性用 GTEx。
- **1c 表达**：Theodoris 2023《Geneformer / transfer learning in network biology》(`10.1038/s41586-023-06139-9`)；Cao 2024《Spatial transcriptomics in drug discovery》(`10.7150/thno.95908`)。
- **1d 功能基因组学**：Gianni & Farrow 2020《Functional Genomics for Target Identification》(`10.1177/2472555220927692`)；Park 2025《Perturbomics: CRISPR functional genomics for target discovery》(`10.1038/s12276-025-01487-0`)；He 2025《CRISPR screening redefines therapeutic target identification》(`10.1016/j.jpha.2025.101357`)。
- **1e 网络**：Gustafsson 2014《Modules, networks and systems medicine》(`10.1186/s13073-014-0082-6`)；Cáceres & Paccanaro 2019《Disease gene prediction》(`10.1371/journal.pcbi.1007078`)；STRING (`10.1093/nar/gkaa1074`)。
- **工具/资源层**：GWAS Catalog (`10.1093/nar/gkt1229`)、FUMA (`10.1038/s41467-017-01261-5`)、VEP (`10.1186/s13059-016-0974-4`)。

> **设计取舍**：遗传学(1a/1b)是命中率最高的先验（Nelson 2015 / Minikel 2024），应作为**主证据**；表达/功能/网络/文献是**正交补强**。Open Targets 的打分框架（McDonagh 2024）几乎就是我们 stage 1-3 的现成蓝本——**发现段优先复用 Open Targets，不重造**。

---

## 二、anchor（dry AMD）映射 + 一个重要纠偏

逻辑链条套到锚定案例 dry AMD：

| Step | dry AMD 实例（文献） |
|---|---|
| 1a 遗传学 | **补体通路** 是最强信号：CFH 单倍型 (Hageman 2005 PNAS `10.1073/pnas.0501536102`)、大型 AMD GWAS 34 loci (Fritsche 2015 Nat Genet `10.1038/ng.3448`) |
| 2/3 | 补体作为地图样萎缩(GA)治疗靶点 (Boyer 2016 Retina `10.1097/iae.0000000000001392`) |
| 设计/repurposing | ROCK 抑制剂 **ripasudil(K-115)**：Kaneko 2016 (`10.1038/srep19640`)、视网膜血管/缺氧 Yamaguchi 2016 (`10.1167/iovs.15-17411`)、ROCK 作为玻璃体视网膜靶点 Yamaguchi 2017 (`10.1155/2017/8543592`)、ROCK1 介导 RPE blebbing Rothschild 2017 (`10.1038/s41598-017-07329-y`) |

> ⚠️ **纠偏（重要）**：**遗传学优先的发现链条，dry AMD 的 top 靶点是「补体」(CFH/C3/C5)，不是 ROCK**——已上市的 GA 药 pegcetacoplan / avacincaptad 都是补体抑制剂，这是 ground truth。**ROCK→ripasudil 是机制/repurposing 驱动的假设**（抗纤维化、RPE blebbing、血管），遗传学证据弱。
>
> **对 anchor 的影响**：发现段的 ground-truth 校准项应改为**「补体(CFH/C3)进 top-N」**（遗传学主线），而 **ROCK 更适合作为设计/repurposing 段的候选**。两个校准点都保留：
> - **发现段判据**：genetics-first → 补体应排第一。
> - **repurposing/设计段判据**：机制驱动 → ROCK 抑制剂(ripasudil)可被捞出并通过 docking/MD 正对照。
>
> 这正好印证逻辑链条的设计：genetics(1a/1b) 与 文献/机制(1f) 是两条会给出**不同 top 候选**的正交证据——Robin 偏 1f(文献 agent)所以得到 ROCK；标准 genetics-first 会得到补体。**我们的 stage 1 应两条都跑、由 judge 综合**，而不是只信一条。

---

## 三、各步骤所需数据/工具

| Step | 需要的数据/资源 | 典型来源 |
|---|---|---|
| 0 疾病本体 | EFO/MONDO 映射 | Open Targets / OLS |
| 1a 遗传学 | GWAS 关联、罕见/LoF、孟德尔 | **GWAS Catalog**、Open Targets、OMIM、UK Biobank |
| 1b 因果遗传 | eQTL/pQTL、可成药基因组、TWAS | Open Targets、GTEx eQTL、PrediXcan、druggable genome list |
| 1c 表达 | bulk/单细胞/空间、扰动签名 | GTEx、单细胞图谱、**LINCS L1000** |
| 1d 功能基因组 | CRISPR 筛选依赖 | DepMap（在线）、自有筛选 |
| 1e 网络/通路 | PPI、通路、GO | **STRING**、Reactome/**KEGG**、**GO** |
| 1f 文献/KG | 文献、知识图谱、靶点库 | Europe PMC/OpenAlex（paper-fetch）、**DRKG**、Open Targets/TTD |
| 2 整合 | 关联打分 | **Open Targets association score** |
| 3a 临床先例 | 已有药/试验 | Open Targets、**ChEMBL**、TTD |
| 3b 可成药性 | tractability、PROTAC 可降解 | Open Targets tractability、PROTACtable genome |
| 3c 安全性 | 遗传约束、组织特异性 | **gnomAD**、**GTEx**、HGNC |

---

## 四、数据可得性调研（gpu-zhouy1 / cpu-zhouy1 / 共享 /data）

**结论：发现段（Phase A）资源充足，基本无阻塞。** 三层都到位：

### 4.1 在线 API（egress 正常，HTTP 实测）
| 资源 | 状态 |
|---|---|
| Open Targets Platform GraphQL | ✅ 可达（`api.platform.opentargets.org/api/v4/graphql`；GET 返 400 属正常，需 POST query） |
| Europe PMC REST | ✅ 200 |
| GWAS Catalog REST | ✅ 200 |
| UniProt REST | ✅ 200 |
| ChEMBL API | ✅ 200 |
| STRING API | ✅ 200 |
| GTEx Portal API | ✅ 服务器可达（路径需修正） |
| Open Targets **Genetics** 旧 API | ❌ 000（已废弃，2024 并入 Platform——用 Platform 即可，非问题） |
| 文献检索 | ✅ `paper-fetch` skill（OpenAlex/S2）+ Europe PMC，已实测可用 |

### 4.2 本地数据（无需联网，强项）
- **`gpu-zhouy1:~/database_workshop/`（zhouy1 私有）**：**`opentarget_25.03`（本地 Open Targets 25.03 dump！）**、`ibd_gwas`/`mash_gwas`、`avsnp`(dbSNP hg19/hg38)、`go`、`kegg`、`cellfm`/`cellphonedb`/`perturb_datasets`/`tahoe_100m`(单细胞/扰动)、`personal_knowledge_base`(论文)、`INDEX.tsv`(有索引)。
- **共享 `/data/database/`（NFS，zhouy1 可读）**：`databases20210723/` 内含 **GTEx、GO、KEGG、HGNC、OMIM、L1000、DRKG(药物重定位知识图谱)、Predixcan、Cancer**；以及 **UKBioBank**、`kg_phase3`(1000G)、`hg19`/`hg38`/`Broad`(参考基因组+GATK)。
- 共享 `/data/software/scRNAseq/`：cellranger、sratoolkit 等单细胞管线。

### 4.3 计算环境
- base env：`requests / pandas / numpy / scipy / scanpy / anndata / networkx / statsmodels` ✅。
- 专用 env：**`iRIGS`**（整合式风险基因优先化——直接对口 target prioritization）、`celloracle_env`(GRN)、`genefoemer`(Geneformer)、`sctenifold`、`cellflow` 等。
- **缺口（易补，pip）**：`gseapy`、`mygene`、`pybiomart`、`biopython(Bio)`、`gget`。

### 4.4 访问与归属
- 发现段数据全部在 **zhouy1 可访问范围**（自有 home + 共享 /data + 在线 API）→ **Phase A 无访问阻塞**。
- 设计段（Phase B）的重型工具在 **qiaoy1** 账户下；**remote 上有 `sshpass`**（`/usr/bin/sshpass`），配合已知口令可访问 qiaoy1 节点——Phase B 工具访问**已具备手段**（仍建议把工具/env 迁到共享 /data 更干净）。

---

## 五、缺口分析 + 建议

| 项 | 状态 | 建议 |
|---|---|---|
| 在线 API | ✅ 全可达 | 直接建 MCP/HTTP 封装（Open Targets GraphQL 为主） |
| Open Targets 数据 | ✅ 本地 25.03 + 在线 | 离线批处理用本地 dump，交互查询用 API |
| GWAS/GTEx/GO/KEGG/L1000/gnomAD | ✅ 本地/在线 | gnomAD 约束分可在线取；其余本地已有 |
| 风险基因优先化 | ✅ `iRIGS` env | 可作为 stage 1 的一个证据 agent |
| 文献 | ✅ paper-fetch | 已可用（本报告即用它做的） |
| python 小缺口 | ⚠️ gseapy/mygene/biopython/gget | 在专用 env `pip install`，或新建 `dd-discovery` env |
| DepMap/CRISPR 依赖 | ⚠️ 未见本地 | 用 DepMap 在线 API，或暂以文献证据替代 |

**底座落点**：发现段 index 落在 zhouy1 可写的共享 `/data/projects/`（已存在 `/data/projects`，zhouy1 owner）或 `~/database_workshop` 旁，复用本地 `opentarget_25.03` 等。

---

## 六、回填 DOMAIN（发现段 stage 1-4）

- **stage 1 `target-hypothesis`** = 逻辑链条 Step 1（多证据并行：1a 遗传 / 1c 表达 / 1e 网络 / 1f 文献）+ Step 2 整合。**多证据提名同样用 scatter-gather**（ARCHITECTURE §3.7：各证据 = 一个并行节点 → 聚合）。证据/工具：Open Targets(本地 25.03 + API)、GWAS Catalog、GTEx、STRING、KEGG/GO、L1000、`iRIGS`、paper-fetch。
- **stage 2 `literature-evidence`** = Step 1f + 证据档案：paper-fetch（OpenAlex/S2）+ Europe PMC，按靶点出带引用综述。
- **stage 3 `target-selection`** = Step 3 三联评估（临床先例 / tractability / 安全性，用 Open Targets + ChEMBL + gnomAD + GTEx）→ 选定要推进的靶点。
- **stage 4 `target-validation`** = 逻辑链条 **Step 4 验证**（**已独立成 stage，不再并入 stage 3**）：多角度计算实验验证（TWAS/GWAS/coloc/MR/in-silico 扰动/表达/网络），scatter-gather 结构 + 本地工具映射详见 **[target-validation.md](target-validation.md)**。
- **judge rubric（发现段）校准**：① 多证据正交覆盖；② 证据可追溯(真实 DOI/OT 分值)；③ genetics-first → **补体应进 dry-AMD top-N**（anchor 校准）；④ stage 4 按**加权/冲突**判定（见 target-validation.md），给可证伪下一步。
