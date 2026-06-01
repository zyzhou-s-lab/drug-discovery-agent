# 领域落地：复现已验证案例做基准

把 [ARCHITECTURE](ARCHITECTURE.md) 的「领域无关 harness 壳」接到**药物靶点发现这一具体场景**。锚定策略（已定）：**先复现一个已验证案例**，用 ground truth 校准 judge rubric、验证整条 pipeline。

> ⚠️ 本页的**生物学具体内容**（阈值、字段定义、判据细节）**需领域专家(=你)核定**。结构是确定的；科学填充优先**从 Robin 现成 prompt 挖**，不要凭空编。

---

## 1. Anchor 案例：干性 AMD → ROCK 抑制剂 → ripasudil

- 来源：**FutureHouse Robin**（arXiv 2505.13400）。Robin 为**干性年龄相关性黄斑变性（dry AMD）**提出 **ROCK 抑制剂 ripasudil**（ROCK1/ROCK2 抑制剂，日本已批用于青光眼）作为候选。备选案例：IPF、sarcopenia、CMT（Robin 也跑过）。
- **为什么用它**：有 ground truth → **成功判据明确**（pipeline 能否把 ROCK / ripasudil 顶出来 + 证据链是否合理）→ 拿来**校准 judge rubric**、验证设计是否真能复现已知结论。
- **不重造科学内容**：Robin 已部署在 `gpu-zhouy1:~/Projects/robin`，其 **`robin/prompts.py`（835 行）+ 疾病示例 notebook** 是领域 prompt/rubric 的**现成来源**——优先挖它（见 [REFERENCES](REFERENCES.md)）。

> **本切片的"通过"定义**：以 `disease="dry AMD"` 跑完 stage 1，**ROCK1/ROCK2（或其所在通路）出现在 top-N 候选**，且 rationale 引用了合理证据。这同时就是 judge rubric 的校准基准。

---

## 2. 领域 ↔ harness 绑定（抽象壳接到科学）

| harness 概念 | 本场景的具体物 |
|---|---|
| campaign | 一个疾病：`disease = "dry AMD"`（+ 物种、modality 约束） |
| index（权威源） | 候选靶点库 + 每靶点的证据包 + 评分（累积/去重） |
| stage（节点） | 一个科学步骤（见 §4/§5） |
| worker 节点 | 跑该科学步骤的一次性 CC session |
| 节点内 agent team | 按证据维度并行的子 agent（genetics / expression / pathway / literature），扁平一层 |
| judge | 该步骤的**科学验收 rubric** |
| 工具 / MCP | OpenTargets、PubMed/Europe PMC、表达图谱、ChEMBL、结构预测 |

---

## 3. 真实 schema（填充 DETAILED-DESIGN §2 的骨架）

`TargetCandidate` 的领域字段（待专家核定字段/阈值；尽量对齐 **OpenTargets** 的 association datatypes）：

```python
class Evidence(BaseModel):
    kind: str           # "genetic" | "expression" | "pathway" | "literature" | "animal_model"
    source: str         # "OpenTargets" | "PubMed:<pmid>" | "GTEx" | ...
    detail: str
    ref: str            # index 内证据 id 或外部可追溯链接

class TargetCandidate(BaseModel):
    symbol: str                 # gene/protein, e.g. "ROCK1"
    name: str | None = None
    modality: str | None = None # "small molecule" | "antibody" | ...
    evidence: list[Evidence]
    scores: dict[str, float]    # association / tractability(druggability) / novelty / safety_flag
    rationale: str              # 机制级理由（为什么这个靶点对该病合理）
```

> 评分口径（待定）：`association` 可直接取/折算 OpenTargets 关联分；`tractability` 取其 druggability 评估；`novelty` / `safety_flag` 需定规则。**让专家定阈值，别让模型自评打分当真。**

---

## 4. Stage 1 垂直切片：`target-hypothesis`（specify 到可跑）

**目标**：给定疾病，产出一组有机制依据、可证伪的候选靶点假设 + 证据 + 评分。

- **输入**（`NodeInput` 实例）：
  ```json
  {"campaign_id":"amd-repro-001","stage":"target-hypothesis",
   "disease":"dry age-related macular degeneration",
   "objective":"提出 top-N 候选靶点 + 机制证据",
   "constraints":{"species":"human","modality_pref":"small molecule","top_n":15}}
  ```
- **工具绑定**（MCP）：`opentargets`（target–disease association + genetics）、`pubmed`（文献）、`expression`（GTEx/单细胞，疾病相关组织/细胞）。
- **节点内 agent team**（可选、扁平一层，见 ARCHITECTURE §3.6.B）：`genetics-analyst` / `expression-analyst` / `pathway-analyst` / `literature-miner` 并行 → 节点汇总去重 → 调 `submit_result`。
- **输出**（`NodeOutput`）：`candidates: TargetCandidate[]`（≤ top_n）+ `summary` + `open_questions`。
- **judge rubric**（gradeable，judge 节点用；初版，待用 anchor 校准）：
  1. 每个候选是否有**机制级 rationale**（不是"相关性高"一句话）？
  2. 证据是否**可追溯**（OpenTargets 分值 / 真实 PMID / 表达数据），有无**编造引用**？
  3. 是否覆盖多证据维度（遗传 + 表达 + 通路），还是单一来源堆叠？
  4. 是否给出**可证伪**的下一步（指向 assay）？
  5. **[anchor 校准项]** 对 dry AMD，ROCK 通路 / ROCK1/ROCK2 是否被合理地纳入候选？（仅复现基准期使用，正式跑别的病时去掉此项）
  - `converged = (1-4 全过) ∧ score ≥ 阈值`；不过 → `missing` 指出缺哪条，驱动重跑。
- **资产位置**：
  - 过程 → `.claude/skills/target-hypothesis/SKILL.md`
  - 角色 + 必做步骤（always-in-context）→ `stages/target-hypothesis/CLAUDE.md`
  - rubric → 喂给 judge（先放本文件 §4，落码时进 judge 的 `rubric_prompt`）

---

## 5. 其余阶段（模板化，从 stage 1 复制 + 后续填）

每阶段标注「anchor 期望」= 复现 AMD 案例时该阶段应得到什么：

| 阶段 | 做什么 | anchor 期望（dry AMD） |
|---|---|---|
| `literature-evidence` | 对候选靶点做带引用的证据综述 | 汇出 ROCK–AMD 的机制/通路证据，附真实引用 |
| `assay-proposal` | 提出可验证 assay 并排序 | 指向能验证 ROCK 通路的实验 |
| `candidate-generation` | 生成调节靶点的分子/方式 | 得到 **ripasudil / ROCK 抑制剂**类候选 |
| `data-analysis` | 跑分析/可视化（CC eval） | 结论被数据支撑 |
| `report` | 汇总靶点发现报告 | 完整、可追溯、复现已知结论 |

> 每阶段的 rubric/prompt 雏形**优先从 `robin/prompts.py` 对应段落挖**（assays/candidates/analyses）。

---

## 6. 落地顺序（本切片）

1. **挖 Robin**：读 `gpu-zhouy1:~/Projects/robin/robin/prompts.py` + AMD/相关 notebook，抽 stage-1 的科学判据与 prompt 雏形（替换下面 SKILL.md 里的 `DOMAIN-FILL` 占位）。
2. **填 schema**：把 §3 的 `TargetCandidate` 字段/阈值与专家敲定，落进 `src/dd_agent/schemas.py`。
3. **接工具**：起 `mcp/opentargets_server.py` + `mcp/pubmed_server.py`（参考 Biomni 集成）。
4. **跑 stage 1**：`disease="dry AMD"`，看 ROCK 是否进 top-N → 用结果**校准 judge rubric**（调阈值/条目）。
5. **横向铺**：stage 1 模板定稿后复制到 2–6 阶段，逐个填。

> 关联：harness 骨架（Runner/worker/judge/index）见路线图 [DETAILED-DESIGN §路线图](DETAILED-DESIGN.md#路线图)；本页只管「领域内容」这一半。
