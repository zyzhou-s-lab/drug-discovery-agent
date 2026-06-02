# 领域落地：发现 → 设计 全链路（anchor：复现已验证案例）

把 [ARCHITECTURE](ARCHITECTURE.md) 的「领域无关 harness 壳」接到具体场景。

> **scope（2026-05-31 已定）**：本项目覆盖**发现 → 设计 全链路**——**靶点发现（上游）** + **计算药物设计（下游：结构准备 → 生成/对接 → MD 验证）**。anchor 仍用 **dry-AMD → ROCK → ripasudil**，两端都有 ground truth（发现端 → ROCK；设计端 → ROCK 抑制剂）。完整 pipeline 见 §5。

> ⚠️ 本页**生物学具体内容**（阈值、字段定义、判据）**需领域专家(=你)核定**。科学填充优先**从现成 prompt/工具迁移**（发现段挖 Robin `prompts.py`；设计段用 `docs/refs/drug-design/` 的已装工具链），不要凭空编。

---

## 1. Anchor 案例：干性 AMD → ROCK 抑制剂 → ripasudil

- 来源：**FutureHouse Robin**（arXiv 2505.13400）。为**干性 AMD**提出 **ROCK 抑制剂 ripasudil**（ROCK1/ROCK2 抑制剂，日本已批用于青光眼）。备选：IPF、sarcopenia、CMT。
- **为什么用它**：有 ground truth → 成功判据明确 → 校准 judge rubric、验证整条 pipeline。
  - **发现端判据**：`disease="dry AMD"` 跑完发现段，**ROCK1/ROCK2（或其通路）进 top-N**、rationale 证据合理。
  - **设计端判据**：拿 **ripasudil 对接 ROCK + MD** 作正对照，验证设计段能复现"ROCK 抑制剂可结合"的已知结论。
- **不重造**：发现段挖 Robin（部署在 `gpu-zhouy1:~/Projects/robin`，`prompts.py` 835 行 + 疾病 notebook）；设计段复用集群**已装工具链**（见 [refs/drug-design](refs/drug-design/README.md)）。

> **发现段已完成文献+数据调研** → [discovery-logic-chain.md](discovery-logic-chain.md)。**重要纠偏**：genetics-first 下 dry-AMD 的 top 靶点是**补体(CFH/C3)**（已上市 GA 药 pegcetacoplan/avacincaptad 即补体抑制剂）；ROCK→ripasudil 是机制/repurposing 假设。故 anchor 校准：**发现段 ground-truth → 补体**，**repurposing/设计段 → ROCK**。

---

## 2. 领域 ↔ harness 绑定

| harness 概念 | 本场景的具体物 |
|---|---|
| campaign | 一个疾病：`disease = "dry AMD"`（+ 物种、modality 约束） |
| index（权威源） | 候选靶点 + 证据 + 评分 →（设计段）+ 结构 / 对接 pose / MD 结果。落**共享 `/data`**（见 §6） |
| stage（节点） | 一个科学步骤（§5 共 7 个） |
| worker 节点 | 跑该步骤的一次性 CC session |
| 节点内 agent team | 按维度/模态并行的子 agent（扁平一层） |
| judge | 该步骤的科学验收 rubric |
| 工具 / MCP | 发现段：OpenTargets / PubMed / 表达图谱；设计段：**已装** AlphaFold3 / Vina / GROMACS / RDKit / ORCA / 扩散模型（§6） |

---

## 3. 真实 schema（填充 DETAILED-DESIGN §2 的骨架）

```python
class Evidence(BaseModel):
    kind: str           # "genetic" | "expression" | "pathway" | "literature" | "animal_model"
    source: str         # "OpenTargets" | "PubMed:<pmid>" | "GTEx" | ...
    detail: str
    ref: str            # index 内证据 id 或外部可追溯链接

class TargetCandidate(BaseModel):
    symbol: str                 # gene/protein, e.g. "ROCK1"
    name: str | None = None
    modality: str | None = None # "small_molecule" | "peptide" | "antibody" | ...  ← 决定设计段走哪条工具链
    evidence: list[Evidence]
    scores: dict[str, float]    # association / tractability / novelty / safety_flag
    rationale: str

# 设计段追加（stage 4-6 产出）：
class DesignArtifact(BaseModel):
    target_symbol: str
    structure_ref: str | None = None   # 结构文件（AlphaFold3/PDB）在 index 的路径
    pose_ref: str | None = None        # 对接 pose
    binding_score: float | None = None # docking 打分
    md_summary: str | None = None      # MD/QM 结论
    refs: list[str] = []
```

> 评分/阈值口径 = `DOMAIN-FILL`，由专家定；`association`/`tractability` 尽量对齐 **OpenTargets**。**不把模型自评打分当真。**

---

## 4. Stage 1 垂直切片：`target-hypothesis`（已 specify 到可跑）

**目标**：给定疾病，产出有机制依据、可证伪的候选靶点 + 证据 + 评分。

- **输入**（`NodeInput`）：`{disease:"dry age-related macular degeneration", constraints:{species:"human", top_n:15}}`
- **工具**（MCP）：`opentargets`（target–disease assoc + genetics）、`pubmed`、`expression`（GTEx/单细胞）。
- **节点内 agent team**（扁平一层，见 ARCHITECTURE §3.6.B）：`genetics-analyst` / `expression-analyst` / `pathway-analyst` / `literature-miner` 并行 → 汇总去重 → `submit_result`。
- **输出**（`NodeOutput`）：`candidates: TargetCandidate[]` + `summary` + `open_questions`。
- **judge rubric**（gradeable；待用 anchor 校准）：① 机制级 rationale？② 证据可追溯/无编造引用？③ 多维度覆盖？④ 给可证伪下一步？⑤ **[anchor 校准项]** ROCK 通路是否被合理纳入？（仅复现期用）。`converged = (①-④全过) ∧ score≥阈值`。
- **资产**：过程 → `.claude/skills/target-hypothesis/SKILL.md`；角色+必做 → `stages/target-hypothesis/CLAUDE.md`；rubric → judge。

---

## 5. 全链路 pipeline（发现 → 桥接 → 设计，7 阶段）

每阶段标注 anchor 期望 + 工具（**★ = 实机已装**，见 §6 访问约束）：

| # | 阶段 | 段 | 做什么 | 工具 | anchor 期望（dry AMD） |
|---|---|---|---|---|---|
| 0 | `disease-overview` 🆕 | 发现 | 疾病→disease brief（子型/组织/机制/通路） | OpenTargets `search_disease` + Europe PMC | brief 覆盖关键背景，喂下游聚焦（ARCHITECTURE §3.7 F；split-and-merge） |
| 1 | `target-hypothesis` | 发现 | 疾病→候选靶点+证据（§4） | OpenTargets(本地25.03+API) / GWAS Catalog / 表达图谱 | 补体(CFH/C3) 进 top-N（ROCK 为机制候选） |
| 2 | `literature-evidence` | 发现 | 候选靶点带引用证据综述 | paper-fetch(OpenAlex/S2) / Europe PMC | 补体/ROCK 机制证据、真实引用 |
| 3 | `target-selection` | 发现 | 排序并**选定要推进的靶点** | OpenTargets 打分 + 三联评估(ChEMBL/gnomAD/GTEx) | 选定靶点 |
| 4 | `target-validation` 🆕 | 发现/验证 | **多角度计算实验验证**（TWAS/GWAS/coloc/MR/in-silico 扰动/表达/网络）→ [target-validation.md](target-validation.md) | 遗传：FUSION-TWAS/PrediXcan/iRIGS、LDSC、coloc/MR(待补 R)；扰动：GRN_transfer/CellOracle/scTenifoldKnk/GEARS；表达/网络 | 靶点过 ≥N 正交角度（补体强遗传+表达；ROCK 走扰动/机制） |
| 5 | `structure-prep` | 桥接 | 选定靶点 3D 结构获取/预测 + 配体准备 | RCSB PDB/UniProt；★AlphaFold3(`af333`)；Swiss-Model；(肽)PEP-FOLD4/AF2-Multimer | 拿到靶点结构 |
| 6 | `molecule-design-docking` | 设计 | 按 modality 生成/筛选 + 对接 | 小分子：★Vina、★RDKit、★扩散(MolDiff/dmcg/sddiffusion)、(缺)DiffDock/REINVENT；肽：RFdiffusion/ProteinMPNN/ClusPro/ADCP/环化 | ROCK 抑制剂候选 / ripasudil 对接 ROCK |
| 7 | `simulation-validation` | 设计 | MD/QM 验证 top hits | ★GROMACS、★ORCA、★MDAnalysis、★PyMOL；增强采样 Metadynamics/REMD；力场 AMBER14SB/CHARMM36m | 结合稳定性被 MD 支撑 |
| 8 | `report` | — | 汇总发现→设计报告 | — | 端到端复现已知结论 |

- **modality 分叉**：stage 5–7 按 `TargetCandidate.modality`（小分子 / 多肽）走两条工具链（见 [refs/drug-design](refs/drug-design/README.md)）。
- **验证段（stage 4 `target-validation`）= scatter-gather**（ARCHITECTURE §3.7）：planner（**模式 (a)**：从已封装工具菜单动态选角度）→ 并行角度 worker 节点（分层：便宜先 gate）→ 聚合 → judge（加权/冲突）。**一个角度=一个节点工作流，算法封装为工具调用、不单开 session**。本地最强项=基因扰动（GRN_transfer 已跑）。详见 [target-validation.md](target-validation.md)。
- **anchor 端到端**：发现段→ROCK；设计段→拿 ripasudil（已知 ROCK 抑制剂）做对接/MD 正对照。两端都可校准。
- 每阶段 rubric/prompt 雏形：发现段挖 `robin/prompts.py`；设计段参考 `refs/drug-design/`。

---

### 5.1 发现段节点清单（stage 0–4）

> **节点** = 被 Runner 编排的 boxed agent session（worker / planner / judge）。**聚合 gather、路由、Runner 本身 = 确定性代码，不计为节点**（定义见 [ARCHITECTURE §3.6/§3.7](ARCHITECTURE.md)）。下表为**设计层节点种类**；运行时按「候选靶点数 × 验证角度数 × consensus 工具数」横向 fan-out 出实例。

| Stage | 结构 | worker / planner 节点 | judge | 聚合 |
|---|---|---|---|---|
| 0 `disease-overview` | 单 session（split-and-merge，无 scatter/planner） | **1** | 1 | —（session 内 synthesize） |
| 1 `target-hypothesis` | scatter-gather（角度**固定**，无 planner） | 遗传 / 表达 / 网络 / 文献 = **4** | 1 | 代码 |
| 2 `literature-evidence` | 单 worker（per 候选靶点） | **1** | 1 | — |
| 3 `target-selection` | 单 worker（三联评估 + 选定） | **1** | 1 | — |
| 4 `target-validation` | scatter-gather（**动态** planner 选角度） | planner **1** + 角度 worker **≤5**（菜单：遗传/扰动/表达/网络/安全；关键角度 consensus） | 1 | 代码 |

**计数：**
- 主 stage 状态机节点：**4**
- 固定 boxed-agent 节点：**11** ＝ worker 6（4+1+1）＋ judge 4（每 stage 一个）＋ planner 1（stage4）
- ＋ stage4 动态验证角度节点 **≤5**（planner 按靶点选，典型 3–4）→ 典型一次 ≈ **15** 个节点
- **不计入节点**：Runner（代码）、聚合 gather（代码）、consensus 的多工具（节点内工具调用）

**两点注意：**
1. **运行时会再乘**：stage 2–4 是 per 候选靶点复制；stage4 内再 fan-out 角度、角度内 consensus 再多工具调用。实例数 = 种类数 × 候选靶点 × 角度 × 工具。
2. **stage1 vs stage4 的 scatter-gather 不同**：stage1 角度固定（遗传/表达/网络/文献）→ 无需 planner；stage4 角度动态（按靶点+文献选）→ 有 planner。

## 6. 工具层、访问约束与数据底座

**工具层**：发现段用 web/DB（OpenTargets/PubMed/表达图谱——建 MCP 或直接 HTTP）；设计段**优先 wrap 实机已装工具**（AlphaFold3 / Vina / GROMACS / RDKit / ORCA / 扩散模型，见 [refs/drug-design](refs/drug-design/README.md)），不重造。

**⚠️ 访问约束（必须先解决，否则设计段无法落地）**：设计工具链装在协作者 **`qiaoy1` 账户**下（`/data1/home/qiaoy1/...` + 其 conda），本项目跑 **`zhouy1`**，很可能**无权**激活其 env / 读其 home。**共享 `/data`(401T NFS) 可访问**。三选一：① 经 qiaoy1 协作；② 把工具/env 迁到共享 `/data`；③ `zhouy1` 自装。

**数据底座（index）** —— 采用 qiaoy1 推荐布局，落在 **zhouy1 可访问的共享 `/data`**：
```
/data/drug-discovery/projects/{campaign_id}/
  ├── 01_discovery/    # targets.jsonl + evidence/ + validation/  (stage 1-4，含验证)
  ├── 02_structure/    # 靶点/配体 3D 结构              (stage 5)
  ├── 03_docking/      # 候选 + 对接 pose/打分          (stage 6)
  ├── 04_simulation/   # MD/QM 轨迹与分析               (stage 7)
  ├── reports/
  └── state.sqlite     # 状态/队列/run/各节点 session_id/verdict（SQLite WAL，权威源；吸收 coder-loop）。上面各目录 = content-addressed artifact-store
```
> **本地已有可复用资源（发现段无需联网即可起步）**：`zhouy1:~/database_workshop/opentarget_25.03`（OT 25.03 dump）、共享 `/data/database/databases20210723/`（GTEx/GO/KEGG/HGNC/OMIM/L1000/DRKG/PrediXcan）、UKBioBank、1000G、参考基因组。在线 API（Open Targets/GWAS Catalog/Europe PMC/ChEMBL/STRING）实测均可达。详见 [discovery-logic-chain.md §四](discovery-logic-chain.md)。

---

## 7. 落地顺序

**Phase A — 发现段（无访问阻塞，先做）**
1. **发现段科学已就绪** → [discovery-logic-chain.md](discovery-logic-chain.md)（逻辑链条 + 数据调研）。据此填 stage 1-3 的 `DOMAIN-FILL`；可再挖 Robin `prompts.py` 补充。
2. **填 schema**：`TargetCandidate` 字段/阈值定稿 → `src/dd_agent/schemas.py`。
3. **接发现工具**：`mcp/opentargets_server.py` + `mcp/pubmed_server.py`（参考 Biomni）。
4. **跑 stage 1**：`disease="dry AMD"`，看 ROCK 是否进 top-N → 校准 judge。
5. 铺 stage 2–4（`literature-evidence` / `target-selection` / **`target-validation`**，见 [target-validation.md](target-validation.md)）；把 TWAS(FUSION/iRIGS)/in-silico 扰动(GRN_transfer/CellOracle)/coloc·MR 封装为 MCP 工具供验证节点调用（coloc/MR 需先在 R 装 `coloc`/`TwoSampleMR`/`SMR`）。

**Phase B — 设计段（先解决 `qiaoy1` 工具访问）**
6. 解决工具访问（协作 / 迁共享 `/data` / 自装）。
7. wrap：AlphaFold3 → `structure-prep`；Vina+RDKit+扩散 → `molecule-design-docking`；GROMACS+ORCA+MDAnalysis → `simulation-validation`。
8. 跑设计段：**ripasudil 对接 ROCK + MD 作正对照**，校准设计段 rubric。
9. `report`，端到端复现已知结论。

> harness 骨架（Runner/worker/judge/index）见 [DETAILED-DESIGN §路线图](DETAILED-DESIGN.md#路线图)；本页管「领域内容」这一半。
