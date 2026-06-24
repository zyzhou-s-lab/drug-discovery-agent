# Drug Target-Discovery Agent — Harness Design

> 一个面向**药物靶点发现（therapeutic target discovery）**的长程 Agent 系统的架构方案。
> 核心立场：用程序语言理论（PL）的视角设计 harness，而不是堆一个"会聊天的大 agent"。

> 🧭 **现状速读（as-of 2026-06-24）**
> - **线上在跑的**：单个 `disease-overview` 深度研究流（scope → search → fetch → verify → synthesize）+ web 可视化。
> - **栈迁移中**：编排核心正从 **Python（`src/dd_agent/`）** 重写为 **TS/bun（`engine-ts/`）**；代码已并入 `master`，但**线上 8099 暂仍是 Python uvicorn**，engine-ts 尚未在 gpu 部署。详见 **[docs/engine-ts-status.md](docs/engine-ts-status.md)**。
> - **已归档**：8 阶段发现→设计全流水线（stage 1–4）= 蓝图，Python 实现在分支 `legacy-discovery-pipeline`；整个 Python 栈在分支 `python-stack`。
> - **被阻塞**：Phase B 设计段（结构/对接/MD），卡在 qiaoy1 工具访问。

---

## 一句话方案（设计哲学，语言无关）

> **可靠的长程任务 = 一套 harness，而不是一个自由对话的 agent。**
> 把"聪明"关进**可丢弃的盒子（boxed agent node）**里，让外层的**确定性指挥棒（Runner / 状态机）**保持愚蠢；
> 节点内部**尽情复用 harness 能力**（skills / 子 agent / tools / todo 自检）跑完一个有界阶段；
> 外层只编码**这一个场景的固定阶段流程**：阶段序列 + 类型化边界 + **独立验收** + 共享 **index（权威数据源）**。

```
                          人类（仅在边界）   设计期→config↓    观察期→读 index(只读/CQRS)↑
═══════════════════════════════════════════════════════════════════════════
 外层 │ RUNNER ＝ 确定性状态机（纯代码，imperative shell）—— 不是节点
      │ 定义阶段·类型契约·路由·副作用收敛·loop/terminate（愚蠢而确定，不推理）
      │ spawn 节点 → 收 typed 产出 → 写 index → 据 verdict 做确定性转移
═══════════════════════════════════════════════════════════════════════════
 中层 │ boxed agent 节点 ＝ functional core，每阶段全新 session、强制 typed 产出
      │ 【蓝图】8 阶段：[1假设]→[2文献]→[3选定]→[4验证] → [5结构]→[6生成·对接]→[7模拟]→[8报告]
      │ 【现状】只跑 stage-0 `disease-overview`（deep-research 五阶段）
═══════════════════════════════════════════════════════════════════════════
 底层 │ tools/MCP（封装算法：OpenTargets·文献·后续 FUSION/GRN_transfer/Vina/GROMACS/AF3…）
      │ INDEX ＝ 权威数据源：context 每节点可丢，知识/状态持久累积
═══════════════════════════════════════════════════════════════════════════
```

完整蓝图（含 scatter-gather 放大）见 [ARCHITECTURE §0](docs/ARCHITECTURE.md)；当前 TS 引擎架构见 [ARCHITECTURE §0.5](docs/ARCHITECTURE.md) + [engine-ts-status.md](docs/engine-ts-status.md)。

---

## 文档地图（按状态分层）

> 状态图例：🟢 **TIMELESS**（哲学/科学，不过时） · 🧭 **CURRENT**（当前栈/现状） · 🟡 **MIXED** · 📒 **RECORD**（历史记录） · 🗄️ **HISTORICAL**（已归档的旧版本设计）。每篇顶部都有 STATUS 横幅。

**先读这两篇了解现状：**

| 文档 | 状态 | 内容 |
|---|---|---|
| [docs/engine-ts-status.md](docs/engine-ts-status.md) | 🧭 CURRENT | **当前栈的单一真相**：Python→TS 端口映射、线上 vs 代码、judge 现状、cutover 剩余 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 🧭 §0.5 现状 / 🟡 §0 蓝图 | 三层架构、组件职责、关键设计决定；§0=8 阶段蓝图，§0.5=当前 TS 引擎 |

**设计哲学与现行设计：**

| 文档 | 状态 | 内容 |
|---|---|---|
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | 🟢 TIMELESS | 设计哲学：LLM=纯函数、context 污染、副作用=state、代数效应、agent-as-tool、信息索引化 |
| [docs/deep-research-port-plan.md](docs/deep-research-port-plan.md) | 🧭 CURRENT | 当前唯一在线阶段（disease-overview）的设计源（措辞为 Python，已 port 到 TS） |
| [docs/bun-migration-eval.md](docs/bun-migration-eval.md) | 🧭 CURRENT | Python→TS/bun 迁移评估与 GO 决策（实际进度见 engine-ts-status） |
| [docs/DOMAIN.md](docs/DOMAIN.md) | 🟡 MIXED | 领域落地：anchor dry-AMD→ROCK→ripasudil、领域↔harness 绑定、真实 schema（§1–4 有效；§5 全流水线=蓝图；§6 设计段访问约束） |

**领域科学调研（长期有效）：**

| 文档 | 状态 | 内容 |
|---|---|---|
| [docs/discovery-logic-chain.md](docs/discovery-logic-chain.md) | 🟢 TIMELESS | 靶点发现逻辑链（文献支撑）+ gpu/cpu/data 数据可得性；anchor 纠偏（genetics→补体） |
| [docs/target-validation.md](docs/target-validation.md) | 🟡 MIXED | 多角度验证方法学 + 本地工具映射（TWAS/coloc/MR/in-silico 扰动…）；stage-4 编排=旧版，工具调研=有效 |
| [docs/REFERENCES.md](docs/REFERENCES.md) | 🟢 TIMELESS | 参考项目分析：Robin / Biomni / pi / coder-loop；含内部 manifesto 副本 `docs/refs/` |

**记录与归档：**

| 文档 | 状态 | 内容 |
|---|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | 📒 RECORD | 进度时间线（覆盖到 Phase A；TS cutover 见 engine-ts-status） |
| [CHANGELOG.md](CHANGELOG.md) | 📒 RECORD | 发布粒度的变更记录 |
| [docs/history/DETAILED-DESIGN.md](docs/history/DETAILED-DESIGN.md) | 🗄️ HISTORICAL | Phase A **Python** 细节设计（schema/接口/路线图）；概念有效，代码=旧栈 |
| [docs/history/phase-a-plan.md](docs/history/phase-a-plan.md) | 🗄️ HISTORICAL | Phase A 执行计划/记录（M0–M5 已完成） |

---

## 怎么运行

> 运行环境在 **`gpu-zhouy1:~/Projects/drug-discovery-agent`**；本地编辑 → `git push` → gpu `git pull` 跑。

**当前线上（deep-research，Python 后端 + web）：**

```bash
# gpu 上：Python API 已常驻 127.0.0.1:8099（uvicorn dd_agent.api:app），web 在 :5173
# 浏览器访问（gpu tailscale）：http://10.202.2.224:5173  或  ssh -L 5173:localhost:5173 gpu-zhouy1
# 触发一次研究：POST /api/campaigns {disease, real:true}
```

**TS 引擎（迁移目标，部署后顶替 8099）：**

```bash
cd ~/Projects/drug-discovery-agent/engine-ts
bun install
bun test            # 全模块有 *.test.ts
bun src/server.ts   # 起 Hono API（与 api.py 路由兼容，前端不用改）
```

**Phase A 旧发现段 CLI（已归档，需切分支）：**

```bash
git checkout legacy-discovery-pipeline
PYTHONPATH=src python -m dd_agent.cli run --disease "dry AMD" --campaign c1
```

---

## 状态

**Phase A（Python，已完成 → 归档）**
- [x] 架构方向（三层 + index + observer）、节点执行器选型、anchor（dry-AMD→ROCK→ripasudil）
- [x] 发现段调研：逻辑链 + 数据可得性（[discovery-logic-chain.md](docs/discovery-logic-chain.md)）
- [x] 发现段 M0–M4a + observer M5 跑通（提名→文献→选定→验证 全链真实 + web），详见 [PROGRESS.md](docs/PROGRESS.md)
- [x] judge 形态定稿：gate + `claude -p` + `submit_verdict`（agentic，std≈0.025）

**当前（TS cutover + deep-research）**
- [x] deep-research 引擎（scope→search→fetch→verify→synthesize）+ web
- [x] bun/TS 迁移 GO（Phase 0 spike：非 Anthropic 后端驱动 forced-tool 通过）
- [~] **engine-ts cutover**：phase 1–3c + circuit-breaker 已并入 master；**线上 8099 暂仍 Python，engine-ts 待 gpu 部署 + 对拍切流量** → [engine-ts-status.md](docs/engine-ts-status.md)
- [ ] 发现段（stage 1–4）在 TS 上重建（现归 `legacy-discovery-pipeline`）

**Phase B（设计，阻塞）**
- [ ] qiaoy1 工具访问（AlphaFold3/Vina/GROMACS/RDKit/ORCA）→ 解决后 wrap 为 MCP（建议迁共享 `/data`）
