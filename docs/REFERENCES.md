# 参考项目与开源现状

> 🟢 **STATUS：TIMELESS / RECORD（参考审计）** · as-of 2026-06-24
> 外部项目审计，基本不过时。**一处已反转**：原文多处"本项目定 Python → 把 coder-loop 算法照 Python 重写"，但语言已改判为 **TS/bun**——而 coder-loop 本身就是 TS+Bun+SQLite，**现在是同语言直接参考**（见下方 coder-loop 段已标注）。

本页记录我们调研过的参考系统，以及它们对本方案的具体借鉴/取舍。

---

## Agent architecture manifesto（内部笔记，强对齐）

来源：`zhouy1@gpu-zhouy1:/data1/home/zhouy1/Documents/notes/agent_architecture_manifesto.md`（《长程 AI Agent 架构设计：状态机优于编排器》）。**已 copy 进本 repo：[`docs/refs/agent-architecture-manifesto.md`](refs/agent-architecture-manifesto.md)**（单机备份 + 版本化，repo 自包含）。

核心句：**"给 AI 设起止点和边界，边界之外程序化，边界之间靠路由。"** —— 与本项目的 imperative shell / functional core **几乎同构**，是对架构方向的强背书。已吸收进各文档的点：
- **状态机 > orchestrator**、AI 判断"在哪"/程序决定"去哪"、任务即状态、文件即信号、故障隔离 —— ARCHITECTURE / CONCEPTS（早已对齐）。
- **节点必须顶层 main agent**（缓存只惠及主 agent + subagent 递归禁令）—— 新增 ARCHITECTURE §3.6 + DETAILED-DESIGN §9。
- **目录 = agent 身份**（每阶段 scoped cwd + CLAUDE.md + 收窄 skills）—— 新增 DETAILED-DESIGN §1。
- **Skills vs MCP = 注入方式**（必做步骤别只放 Skill）+ **四级控制谱系** —— 新增 DETAILED-DESIGN §12。
- **计费/认证**（worker 可走订阅；judge raw API 需 key，冲突与解法）—— 新增 DETAILED-DESIGN §13。
- **Push 模式 MCP**（长外部计算休眠唤醒）—— 新增 DETAILED-DESIGN §8。

一处刻意分歧：manifesto 用 agent 自写 `can_do_next` 文件做路由信号；本项目额外加**独立 judge** 做质量验收（不信 in-session 自评）。`can_do_next` 类信号可作**路由提示**，但**完成与否拍板权在外层 judge**。

## PL 源笔记（harness）

[`docs/refs/pl-driven-agent-harness-design.txt`](refs/pl-driven-agent-harness-design.txt) —— 用 PL/代数效应思想设计 harness 的**原始笔记**（原文 + 逐句解读），是 [CONCEPTS.md](CONCEPTS.md) 的来源。CONCEPTS.md 是蒸馏后的**规范版**；本文件是 raw 源 + 备份（与 manifesto 互补：manifesto 偏"状态机 vs 编排器"，本文件偏"纯函数/副作用/Koka"）。

## 计算药物发现工具链与参考流程（domain）

见 [`docs/refs/drug-design/`](refs/drug-design/)（来源 `gpu-zhouy1:~/Documents/notes/multiagents_ref/`，2026-05-13）：集群**实际安装**的药物设计软件调查（AlphaFold3 / AutoDock Vina / GROMACS / RDKit / ORCA / 扩散模型 已装）+ **小分子 & 多肽**计算设计 3 阶段参考流程（图+PDF）+ AI 编排愿景图。
- **关键发现**：这是计算药物**设计（下游）**，与本项目当前的**靶点发现（上游）相邻但不同**——如何并入 scope **待定**。一种接法：设计流程对应本项目下游阶段（candidate-generation ← 对接/生成；data-analysis ← MD/QM），AlphaFold3 结构准备是发现→设计的桥接，「统一数据底座」≈ 本项目 index。
- **⚠️ 访问约束**：工具链装在协作者 `qiaoy1` 账户下，`zhouy1` 可能无权激活其 conda/读其 home；共享 `/data`(401T) 可用。**落地前需解决工具访问**（协作 / 迁共享 /data / 自装）。
- 详见 [`docs/refs/drug-design/README.md`](refs/drug-design/README.md)。

---

## pi / oh-my-pi（harness 学习对象）

- `earendil-works/pi`（即 `badlogic/pi-mono`，TypeScript monorepo，作者 @mariozechner）——一个 LLM coding agent harness，把底层做成可复用运行时。
- `can1357/oh-my-pi`（fork，8.5k★，TS + ~27k 行 Rust）——大量增强。

**可复用的通用 core（领域无关）**：
- `packages/ai`（`pi-ai`）：多 provider LLM 抽象、流式、模型注册。
- `packages/agent`（`pi-agent-core`）："**general-purpose agent** with transport abstraction, state management"——主循环 `agent-loop.ts`、上下文压缩 `harness/compaction/`、session、`AgentTool` 抽象（JSON schema）、`beforeToolCall`/`afterToolCall` hook（= 执行前 gate 副作用 / 改写或丢弃，正是 CONCEPTS §7 的味道）。

**编码专用、对本项目无关的**：整个 `coding-agent` 包 + Rust crates（`pi-ast`/`pi-shell`/`pi-natives`）——LSP/DAP/ast/hashline/code-review/编辑器集成。

**对本方案的意义**：pi-agent-core 是"CC 级 harness 当库"的另一实现；与 **Claude Agent SDK** 同性质。worker 节点引擎可二选一：Agent SDK（官方、省事）或 pi core（TS、可深改）。注意别被那张"用不到的功能表"误导——Shell、eval（持久 Python）、web/autoresearch、task（子 agent）、mcp、tool-discovery(BM25)、memory 这些**不是编码专用，是本项目刚需**。

## Robin（FutureHouse）—— 状态机 pipeline 的实物范本

- `Future-House/robin`（Apache-2.0）——**唯一明确做"靶点→候选药"端到端**的开源系统。真实案例：为干性 AMD 找出 ROCK 抑制剂 ripasudil。
- **它不是自治 agent，是多轨 pipeline orchestrator / 状态机**。核心 = `multitrajectory_runner.py`：
  - `Step`（pydantic）：typed job —— name / prompt_template / **input_files / output_files** / parallel / **post_process** / prompt_generator。
  - `MultiTrajectoryRunner.run_pipeline`：upload → 提交 `TaskRequest` 给 `EdisonClient` → `arun_tasks_until_done` → download → post_process → 存 JSON。
  - 真正的 agent loop 在**远程 Edison/FutureHouse 托管 agent（Crow/Falcon/Finch）**；Robin 还用 LiteLLM(o4-mini) 做排序/综合。
  - 领域 workflow 在 `assays.py`→`candidates.py`→`analyses.py`；`prompts.py`（835 行）装领域知识。
- **映射到本方案**（一一对上，验证了我们的设计）：
  - `Step` 的 typed I/O = 我们的节点契约（纯函数 schema）。
  - `post_process` = effect handler 的"收敛"（写回 index）。
  - `parallel` + `prompt_generator` = 动态 fan-out。
  - 固定 DAG = 状态机。
- **取舍**：Robin 把 loop **外包给 Edison**（付费 API，无本地 GPU 计算）。本方案选**自托管**：用 CC harness 当节点引擎，把 Robin 的 pipeline 结构 + workflow + prompts 借过来，但执行换成自己的 boxed CC session。
- 部署：已装在 `gpu-zhouy1:~/Projects/robin`（notebook 默认 `robin_demo.ipynb` / `robin_full.ipynb` + 11 个疾病示例；需 `EDISON_API_KEY` + `OPENAI_API_KEY`）。

## Biomni（Stanford SNAP）—— 领域工具的来源

- `snap-stanford/Biomni`（3k★，Apache-2.0）——最成熟的**通用生物医学** agent，自带大量工具/数据库集成，覆盖靶点/基因/组学/实验设计。
- **对本方案的意义**：**别重造领域工具**。把 Biomni 的工具/数据库集成清单当 `mcp/` 的来源照搬。注意：默认以 full system privileges 执行 LLM 生成代码，生产要 sandbox。

## paper-agent（用户当前的雏形）

- `gpu-zhouy1:~/Projects/paper-agent`——一个 **pi extension**（TS，414 行），**不是独立 agent**：pi 跑 loop，它加了一个 typed 工具 `search_arxiv`、branch-aware session-state 重建、render hooks、`/papers` 命令、防复读 guard（MAX 2）。
- 是 pi 扩展系统的学习 demo。**定位**：它是"一个节点执行者"的种子——把它从交互式（A 型）改造成 boxed（B 型：固定输入 schema + headless + 新鲜 context + 类型化返回），就成了本方案的一个 worker 节点。
- 已知小 bug：格式化文本里用 `p.author`（应为 `authors`），LLM 看到的作者恒为 N/A。

## 其它开源 agent（按"能否 fork 当 harness"分层）

**端到端可 fork**：Robin、Biomni（首选通用底座）、STELLA（自进化）、CLADD（Genentech，LangGraph，免微调 RAG 做 drug-target 预测）、AgentD（MCP server，含 Boltz 结构）、Prompt-to-Pill（全链路但很小、⚠️无 license）。

**工具/组件**：PaperQA2（`Future-House/paper-qa`，8.5k★，文献 RAG，可独立嵌入——本项目 stage 2 直接可用）、GeneAgent（NCBI，基因集分析）、CACTUS/ChemCrow（化学，ChemCrow 已停更）。

**框架/gym**：Aviary + ldp（FutureHouse 训练/编排底座）。**模型**：TxGemma（开放权重，可当 backbone）。**索引**：`aristoteleo/awesome-bioagent-papers`。

**避坑**：DrugAgent（无官方 repo）、CellAgent / Prompt-to-Pill（无 license）、Coscientist（Commons Clause 禁商用）、gemma-cookbook（已 deprecated）。

---

## 选型结论（重申）

1. **节点引擎（worker）**：Claude Agent SDK / `claude -p`（自托管，复用 CC harness）；可选 pi-agent-core。
2. **judge**：raw Messages API 结构化输出。
3. **领域工具**：照搬 Biomni 集成 + PaperQA2（别造轮子）。
4. **workflow 形状**：照 Robin 的 Step/pipeline + 它的 prompts/阶段划分，执行换成自托管 CC session。
5. **avoid**：把 loop 外包（Managed Agents / Robin→Edison）——除非明确要托管容器。

---

## Agent 框架 & 持久化/恢复机制调研（2026，web 核实）

两轮 web 调研，支撑【语言=Python】与【durable 设计】（见 ARCHITECTURE §3.1 / §3.8）。

**框架对比**：LangGraph、OpenAI Agents SDK、Microsoft AutoGen（已进 maintenance，合并入 **Microsoft Agent Framework**；AG2 为社区 fork——别押停更分支）、CrewAI、Temporal、FutureHouse aviary/ldp、DSPy、Claude Agent SDK、pi/oh-my-pi、Robin、Biomni。要点：
- **科学发现 agent 几乎全 Python**（Biomni 82% / Robin / aviary·ldp 94% / DSPy）；无主流科学 agent 用 TS 做骨架（pi 是编码 agent）。
- **checkpoint ≠ durable execution**（Diagrid）：LangGraph/CrewAI 只存 state、恢复/防重复要自己来。
- **Temporal 是唯一与"哑 Runner + 隔离 session"哲学对齐的 durable 底座**（只做 durable 编排、不强加 agent 抽象）。

**持久化/恢复机制（CC/Codex 等）**：
- **Claude Code/Agent SDK**：transcript JSONL（`~/.claude/projects/<cwd>/<id>.jsonl`）+ `--resume/--continue/fork_session`；`/rewind` 文件 checkpoint **仅 Edit/Write**（bash 改的文件不追踪）；跨主机 resume 不自动。
- **Codex**：rollout JSONL + `codex resume`；cloud=每任务临时容器（缓存≤12h，`--attempts` best-of-N）。
- **Aider**=git auto-commit/`/undo`；**Devin**=VM 快照（Blockdiff）+checkpoint；**Cursor 云端**=唯一真 durable，**靠外挂 Temporal**。
- **共性**：都是 session 级恢复；**resume 会重复发起 tool call**（transcript 不追踪副作用是否已发生）；无 exactly-once。→ 印证 durable + 长作业幂等必须我们自建（ARCHITECTURE §3.8）。

出处：[LangChain durable-execution](https://docs.langchain.com/oss/python/langgraph/durable-execution) · [Temporal AI](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai) · [Diagrid: checkpoints≠durable](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows) · [Claude Code sessions](https://code.claude.com/docs/en/sessions) / [checkpointing](https://code.claude.com/docs/en/checkpointing) / [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions) · [Codex rollout (DeepWiki)](https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay) · [Cursor cloud-agent lessons (Temporal)](https://cursor.com/blog/cloud-agent-lessons) · [Aider git](https://aider.chat/docs/git.html) · [Devin Blockdiff](https://cognition.ai/blog/blockdiff) · [ZenML: why agents need durable execution](https://www.zenml.io/blog/why-agents-need-durable-execution)

## coder-loop（harness 骨架现成参考，2026-05；TS+Bun+SQLite）

[`mouriya-s-lab/coder-loop`](https://github.com/mouriya-s-lab/coder-loop)——项目无关的「N 角色字符串调度引擎」：哑引擎（loop/scheduler/daemon）读 preset + target runtime，按 phase spawn agent、据 SQLite 里 item status 推进；GitHub issue/PR 迭代只是内置 preset。与本项目「哑 Runner + 外部判断 + 状态契约 + durable」**几乎同构**，但落在软件工程域、TS 写、且对 LLM 判断信任度更高（其 gate 是**有状态 prompt 链**、非独立 typed judge）。

**硬约束**：~~本项目定 Python（领域工具生态），coder-loop 是 TS → 借鉴其算法/契约纪律用 Python 重写。~~ **【2026-06-21 已反转】引擎改判 TS/bun，与 coder-loop 同栈（TS+Bun+SQLite）→ 其 `sqlite-state.ts` / `daemon.ts` 可更直接地参考甚至移植，不再是跨语言重写。**

**该吸收（coder-loop 更成熟）：**
1. **持久层 = SQLite(WAL) state-DB + content-addressed artifact-store 分离**（`sqlite-state.ts`：事务/`busy_timeout`/`UNIQUE` 防重/schema 迁移）→ ✅ 已更新 ARCHITECTURE §3.8 / DETAILED §6 / DOMAIN §6。
2. **daemon watchdog 算法**（`daemon.ts:545 recoverStaleSchedulerState`、`:1300` 杀进程组、`loop.ts:4982 decideResume`、`:5051 runAgentWithBackoff` 退避预算、`scripts/probe-claude-resume.ts` 实证 resume 跨轮保留 context）→ ✅ §3.8 (a) 第 1 件套照此 Python 重写；**进程组级 kill 务必照做**（避免只杀子 agent、parent 残留）。
3. **把边界写进 prompt 契约**（`runtime-contract.md` 的 Program-FSM vs Agent-FSM、`state-contract.md` final-state 不变量 + 「不许发明 verdict」）→ 写进 `stages/<stage>/CLAUDE.md`，让节点自知「写终态/路由不归我」。[backlog]
4. **声明式 phase + `{item./config./runtime.}` 变量 DSL** + **item-trigger / chain-complete phase**（副作用后置阶段，对应长作业 resume 解读节点 / report）。[backlog]
5. **DAG `dependsOn` + 跨依赖 unblock + 环检测**（`sqlite-state.ts:1132`、`scheduler.ts:906`）→ 编排「候选靶点 × 验证角度」实例图。[backlog]
6. **gate 方法学**（四维覆盖 function/environment/integration/assumption + adversarial validation）→ 映射进 judge rubric。[backlog]
7. **supervisor in-loop 纪律**（`templates/supervisor/role.md`：只走只读 status/doctor/daemon API、duration 阈值判 stall、kill parent+children）→ 强化 observer + 「谁看守看守者」。[backlog]

**保留（本项目更强 / 科学域独有，别被带偏）：**
- **judge = 独立无状态进程 + 强 schema Verdict**（coder-loop 的 gate 是有状态 prompt 链、自然语言 verdict、无数值 score/robustness——科学验收必须 fresh-context + typed + 加权 + leave-one-out）。
- **scatter-gather**（单验证目标内多角度并行 + barrier + 确定性聚合）——coder-loop 只有「多 item 各跑各」的并行（按 `(chain,repoCwd)` 槽位 + git worktree），无单任务 fan-out。
- **worker 首选 Agent SDK（进程内 `@tool` 注 MCP）**——比 coder-loop 裸 CLI 更顺接 Python 领域工具。
- **tool 级幂等（idempotency-key + PreToolUse/PostToolUse hook + index 对账）+ 长 GPU/MD submit→resume**——coder-loop 工作单元是分钟级 PR 迭代、天然幂等，给不了参考；科学长作业「524 超时但作业可能已提交」只能自建（§3.8 第 2 件套）。

**关键文件**：`src/{loop,scheduler,daemon,sqlite-state}.ts`、`src/runners/session-id.ts`、`scripts/probe-claude-resume.ts`、`presets/gh-issue-pr-iteration/{preset.toml,contract.md,common/{runtime,state}-contract.md,review/*-gate.md}`、`CLAUDE.md`、`templates/supervisor/role.md`。

> **一句话**：coder-loop 是 §3.8 durable 三件套里「daemon watchdog + 状态契约/持久层」的成熟现成参考（照算法 Python 重写省力）；judge / scatter-gather / tool 幂等 / 长作业 / Agent SDK worker 全部保留自建。
