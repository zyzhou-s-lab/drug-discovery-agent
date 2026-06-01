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
外层  确定性 Runner / 状态机  (imperative shell, 纯代码, 愚蠢而确定)
      定义阶段 + 类型契约 + 路由 + 副作用收敛 + loop/terminate
      ├─ 调度: 为每个节点 spawn 全新 CC session, 收一次性产出
      ├─ 验收: 调「无状态 judge 节点」(raw API 结构化输出) 拿 typed verdict
      └─ 更新: 把结果写进外部 index / 权威数据源
                │
中层  节点 = boxed agent (agent-as-tool)         ← "聪明"只放在这里
      一次性 `claude -p` / Agent SDK 自主跑完一个有界阶段
      内部任意 fan-out 子 agent / 调 skill / 用 tool / 自跟踪 todo
      固定 input/output schema, 全新 context, 跑完即弃, 一次性工作区
                │
底层  tools / MCP / 外部 index
      节点通过检索工具够到知识 (信息索引化)
                │
旁路  read-only observer (CQRS) —— 人类只读 index/事件流, 不能写进程
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
| [docs/REFERENCES.md](docs/REFERENCES.md) | 参考项目分析：Robin、Biomni、pi/oh-my-pi、paper-agent；开源现状（含内部 manifesto 副本 `docs/refs/`） |

---

## 状态

- [x] 架构方向确定（三层 + index + observer）
- [x] 节点执行器选型确定（worker = CC harness headless；judge = raw API 结构化输出）
- [x] 锚定场景：**复现 dry-AMD→ROCK→ripasudil**（两端 ground truth，可校准 judge）→ `docs/DOMAIN.md`
- [x] scope 定为**发现→设计全链路**（7 阶段：发现 1-3 / 桥接 4 structure-prep / 设计 5-6 / report）
- [x] 参考文档集中：manifesto + PL 源笔记 + 药物设计工具链调查 收进 `docs/refs/`
- [~] stage-1（target-hypothesis）领域资产 scaffold（待从 Robin `prompts.py` 挖科学内容填 `DOMAIN-FILL`）
- [x] **Phase A 调研**：文献梳理逻辑链条 + 数据可得性调研完成（`docs/discovery-logic-chain.md`）——发现段资源充足、无阻塞（本地 OpenTargets 25.03 + GTEx/GO/KEGG/L1000，在线 API 全可达，`iRIGS` env）
- [ ] **Phase A 实现**：据逻辑链条填 stage1-3 `DOMAIN-FILL` + `schemas.py` + 接 Open Targets/GWAS Catalog/Europe PMC（anchor 发现端 ground-truth = 补体 CFH/C3）
- [ ] **Phase B（设计）**：qiaoy1 访问手段已具备（凭据 + remote `sshpass`）→ wrap AlphaFold3/Vina/GROMACS/RDKit/ORCA（建议迁共享 `/data`）
- [ ] Runner + judge + index 最小骨架（路线图 Step 1）

详见 [DETAILED-DESIGN §路线图](docs/DETAILED-DESIGN.md#路线图) + [DOMAIN §7 落地顺序](docs/DOMAIN.md)。
