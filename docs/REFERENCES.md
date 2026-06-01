# 参考项目与开源现状

本页记录我们调研过的参考系统，以及它们对本方案的具体借鉴/取舍。

---

## Agent architecture manifesto（内部笔记，强对齐）

来源：`zhouy1@gpu-zhouy1:/data1/home/zhouy1/Documents/notes/agent_architecture_manifesto.md`（《长程 AI Agent 架构设计：状态机优于编排器》）。

核心句：**"给 AI 设起止点和边界，边界之外程序化，边界之间靠路由。"** —— 与本项目的 imperative shell / functional core **几乎同构**，是对架构方向的强背书。已吸收进各文档的点：
- **状态机 > orchestrator**、AI 判断"在哪"/程序决定"去哪"、任务即状态、文件即信号、故障隔离 —— ARCHITECTURE / CONCEPTS（早已对齐）。
- **节点必须顶层 main agent**（缓存只惠及主 agent + subagent 递归禁令）—— 新增 ARCHITECTURE §3.6 + DETAILED-DESIGN §9。
- **目录 = agent 身份**（每阶段 scoped cwd + CLAUDE.md + 收窄 skills）—— 新增 DETAILED-DESIGN §1。
- **Skills vs MCP = 注入方式**（必做步骤别只放 Skill）+ **四级控制谱系** —— 新增 DETAILED-DESIGN §12。
- **计费/认证**（worker 可走订阅；judge raw API 需 key，冲突与解法）—— 新增 DETAILED-DESIGN §13。
- **Push 模式 MCP**（长外部计算休眠唤醒）—— 新增 DETAILED-DESIGN §8。

一处刻意分歧：manifesto 用 agent 自写 `can_do_next` 文件做路由信号；本项目额外加**独立 judge** 做质量验收（不信 in-session 自评）。`can_do_next` 类信号可作**路由提示**，但**完成与否拍板权在外层 judge**。

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
