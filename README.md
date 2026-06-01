# Drug Target-Discovery Agent — Harness Design

> 一个面向**药物靶点发现（therapeutic target discovery）**的长程 Agent 系统的架构方案。
> 核心立场：用程序语言理论（PL）的视角设计 harness，而不是堆一个"会聊天的大 agent"。

最后更新：2026-05-31

---

## 一句话方案

> **可靠的长程任务 = 一套 harness，而不是一个自由对话的 agent。**
> 把"聪明"关进**可丢弃的盒子（boxed agent node）**里，让外层的**确定性指挥棒（Runner / 状态机）**保持愚蠢；
> 节点内部**尽情复用 Claude Code 的 harness 能力**（skills / 子 agent / tools / todo 自检）跑完一个有界阶段；
> 外层只编码**药物靶点发现这一个场景的固定阶段流程**：阶段序列 + 类型化边界 + **独立 judge 验收** + 共享 **index（权威数据源）**。

```
                          人类（仅在边界）   设计期→config↓    观察期→读 index(只读/CQRS)↑
═══════════════════════════════════════════════════════════════════════════
 外层 │ RUNNER ＝ 确定性状态机（纯代码，imperative shell）—— 不是节点
      │ 定义阶段·类型契约·路由·副作用收敛·loop/terminate（愚蠢而确定，不推理）
      │ spawn 节点 → 收 typed 产出 → 写 index → 据 verdict 做确定性转移
═══════════════════════════════════════════════════════════════════════════
 中层 │ 8 阶段 pipeline（boxed agent 节点 ＝ functional core，每阶段全新 session）
      │  发现段(per disease；stage 2–4 per 候选靶点)         桥接      设计段
      │  [1假设]→[2文献]→[3选定]→[4验证]  →  [5结构]→[6生成·对接]→[7模拟]→[8报告]
      │    └SG·固定          └SG·动态planner      · 每阶段挂 1 个 [judge 节点]
      │  SG = scatter-gather：planner → 并行角度节点 → 聚合(代码) → judge
═══════════════════════════════════════════════════════════════════════════
 底层 │ tools/MCP（封装算法：OpenTargets·FUSION·iRIGS·GRN_transfer·Vina·GROMACS·AF3…）
      │ INDEX ＝ 权威数据源（共享 /data）：context 每节点可丢，知识/状态持久累积
═══════════════════════════════════════════════════════════════════════════

[…节点]=boxed agent（worker/planner/judge，需验收）；Runner·聚合=确定性代码（不是节点）
完整总览(含 scatter-gather 放大)见 docs/ARCHITECTURE.md §0；发现段节点清单见 docs/DOMAIN.md §5.1
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | 设计哲学：LLM=纯函数、context 污染、副作用=state、代数效应/Koka、agent-as-tool、信息索引化、对话被赶到两端 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 三层架构、组件职责、关键设计决定、节点执行器选型对比 |
| [docs/DETAILED-DESIGN.md](docs/DETAILED-DESIGN.md) | 细节设计：节点 I/O 契约、Runner、judge schema、index、CC 原生资产、headless 配置、prompt caching、领域阶段流程、目录结构 |
| [docs/DOMAIN.md](docs/DOMAIN.md) | **领域落地**：**发现→设计全链路（7 阶段）**；anchor 复现 dry-AMD→ROCK→ripasudil（两端 ground truth）；领域↔harness 绑定、真实 schema、stage-1 切片、工具层+访问约束、数据底座、落地顺序（Phase A 发现 / B 设计） |
| [docs/discovery-logic-chain.md](docs/discovery-logic-chain.md) | **发现段调研报告**：完整靶点发现逻辑链条（文献支撑）+ 各步数据需求 + gpu/cpu 数据可得性调研 + 缺口分析；anchor 纠偏（genetics→补体, ROCK=repurposing）。原始日志见 `docs/refs/discovery-*` |
| [docs/target-validation.md](docs/target-validation.md) | **靶点验证（新增 stage 4）**：多角度计算实验验证（TWAS/GWAS/coloc/MR/in-silico 基因扰动/表达/网络）→ 本地工具映射（cpu FUSION/LDSC/ANNOVAR、gpu GRN_transfer/iRIGS/CellOracle/扰动模型、/data PrediXcan/DRKG）+ 缺口（coloc/MR 待补）+ judge 收敛规则。日志见 `docs/refs/validation-*` |
| [docs/REFERENCES.md](docs/REFERENCES.md) | 参考项目分析：Robin、Biomni、pi/oh-my-pi、paper-agent；开源现状（含内部 manifesto 副本 `docs/refs/`） |

---

## 状态

- [x] 架构方向确定（三层 + index + observer）
- [x] 节点执行器选型确定（worker = CC harness headless；judge = raw API 结构化输出）
- [x] 锚定场景：**复现 dry-AMD→ROCK→ripasudil**（两端 ground truth，可校准 judge）→ `docs/DOMAIN.md`
- [x] scope 定为**发现→设计全链路**（**8 阶段**：发现 1-3 / **验证 4 target-validation** / 桥接 5 / 设计 6-7 / report）
- [x] 参考文档集中：manifesto + PL 源笔记 + 药物设计工具链调查 收进 `docs/refs/`
- [~] stage-1（target-hypothesis）领域资产 scaffold（待从 Robin `prompts.py` 挖科学内容填 `DOMAIN-FILL`）
- [x] **Phase A 调研**：文献梳理逻辑链条 + 数据可得性调研完成（`docs/discovery-logic-chain.md`）——发现段资源充足、无阻塞（本地 OpenTargets 25.03 + GTEx/GO/KEGG/L1000，在线 API 全可达，`iRIGS` env）
- [x] **发现段补入 `target-validation` 阶段**（TWAS/GWAS/coloc/MR/in-silico 扰动/表达/网络）→ `docs/target-validation.md`；本地工具映射完成（最强项=基因扰动 GRN_transfer 等已跑、TWAS=FUSION/iRIGS；缺口=coloc/MR，R 易补）
- [x] **验证结构 = scatter-gather**（planner 动态选角度[模式 a：菜单] → 并行角度节点[分层] → 聚合 → 加权/冲突 judge）+ **节点/工具粒度原则**（算法=封装工具调用、不单开 session；session=1角度工作流）→ ARCHITECTURE §3.7。动态加工具 (b)/(c) 列为未来规划
- [x] **工具选择 + 消融判断**：同角度工具集+策略（**关键角度 consensus / 否则 best / fallback**）+ 选择判据；in-silico 消融**强制对照**（正/负）；judge **leave-one-angle-out 敏感性**（仅对"通过边缘"靶点，省算力）→ ARCHITECTURE §3.7C
- [x] **语言定为 Python**（科学 agent 全 Python + 领域工具生态；Agent SDK 双语成熟，不构成 TS 理由）→ 调研见 REFERENCES
- [x] **持久化/恢复策略**：CC 只给 session 级恢复（resume 会重复 tool call），durable 必须自建 → ARCHITECTURE §3.8。**(c)→(a) 渐进**：快节点先跑通(c)，接 GPU/slurm 长算上(a)；(b) Temporal 留待生产化。**(a) 实现三件套**：daemon watchdog（监控 pid + stream-json 提 session_id + 检 524/崩溃 → `claude --resume`+继续）+ `PreToolUse`/`PostToolUse` hook 幂等（防 524 重复提交）+ Runner/index 跨节点
- [x] **审计 coder-loop**（TS+Bun+SQLite harness 现成参考）→ 吸收：**持久层 = SQLite(WAL) state-DB + content-addressed artifact-store 分离**、**daemon watchdog 算法**（进程组 kill / recover-stale / 退避预算 / `probe-claude-resume`）照其 Python 重写；保留 judge/scatter-gather/tool 幂等/Agent SDK worker（科学域独有或更强）。详见 REFERENCES + ARCHITECTURE §3.8
- [ ] **Phase A 实现**：据逻辑链条填 stage1-3 `DOMAIN-FILL` + `schemas.py` + 接 Open Targets/GWAS Catalog/Europe PMC（anchor 发现端 ground-truth = 补体 CFH/C3）
- [ ] **Phase B（设计）**：qiaoy1 访问手段已具备（凭据 + remote `sshpass`）→ wrap AlphaFold3/Vina/GROMACS/RDKit/ORCA（建议迁共享 `/data`）
- [ ] Runner + judge + index 最小骨架（路线图 Step 1）

详见 [DETAILED-DESIGN §路线图](docs/DETAILED-DESIGN.md#路线图) + [DOMAIN §7 落地顺序](docs/DOMAIN.md)。
