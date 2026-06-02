# 架构

承接 [CONCEPTS.md](CONCEPTS.md)。这一页定义组件、职责、边界、以及节点执行器的选型。细节 schema 见 [DETAILED-DESIGN.md](DETAILED-DESIGN.md)。

---

## 0. 总览图

图例：`[…节点]` = boxed agent session（worker / planner / judge）；**RUNNER 与聚合 = 确定性代码，不是节点**；箭头 = 数据流。

```
                              人类（仅在系统边界）
    设计期 ─ 把需求“编译”成 config  ↓             观察期 ─ 读 index（只读 / CQRS，不能写进程）↑
═══════════════════════════════════════════════════════════════════════════════════
 外层 │ RUNNER ＝ 确定性状态机（纯代码，imperative shell）── 【不是节点】
      │   职责：定义阶段 · 类型契约 · 路由 · 副作用收敛 · loop/terminate（愚蠢而确定，自己不推理）
      │   循环：spawn 节点 → 收 typed 产出 → 写 index → 据 verdict 做【确定性转移】
═══════════════════════════════════════════════════════════════════════════════════
 中层 │ 8 阶段 pipeline（boxed agent 节点 ＝ functional core；每阶段一个全新 session）
      │
      │   ┌────── 发现段 (per disease；stage 2–4 per 候选靶点) ──────┐   桥接      ┌──── 设计段 ────┐
      │    [1 假设] → [2 文献] → [3 选定] → [4 验证]            →   [5 结构] → [6 生成·对接] → [7 模拟] → [8 报告]
      │      └SG·角度固定              └SG·动态 planner
      │   · 每个阶段都挂 1 个 [judge 节点]（验收 → verdict）
      │   · SG ＝ scatter-gather（stage 1 与 4，↓ 放大）；其余为单 worker
═══════════════════════════════════════════════════════════════════════════════════
 底层 │ tools / MCP（封装算法：OpenTargets · FUSION · iRIGS · GRN_transfer · Vina · GROMACS · AF3 …）
      │ INDEX ＝ 权威数据源（落共享 /data）：context 每节点可丢弃，知识/状态持久累积于此
═══════════════════════════════════════════════════════════════════════════════════
```

**scatter-gather 阶段放大（以 stage 4 `target-validation` 为例；stage 1 同构但角度固定、无 planner）：**

```
   Runner（代码）
     │
     │ ① 规划
     ▼
   [planner 节点] ── 出类型化 plan：选哪些角度 + 每角度【工具集 & 策略】，记入 index
     │                关键角度=consensus（2+工具取一致）· 其余=best · 失败/缺数据→fallback
     │ ② Runner 并行 fan-out（一个角度 = 一个顶层 worker 节点）
     ├─→ [遗传 worker]   TWAS(FUSION/iRIGS) + coloc/MR     （consensus 多工具 = 节点内调用，不算多节点）
     ├─→ [扰动 worker]   in-silico KO(GRN_transfer/CellOracle/scTenifoldKnk) + 对照(负=随机基因/正=已知靶点)
     ├─→ [表达 worker]   单细胞 / GTEx                       （长算 GPU/MD：submit → resume，跨 session 挂起）
     ├─→ [网络 worker]   STRING / DRKG
     └─→ [安全 worker]   gnomAD / GTEx
     │ ③ barrier：等全部角度到齐
     ▼
   [聚合 gather] ＝ 确定性代码  ── 【不是节点】，并合各 ValidationResult
     │ ④
     ▼
   [judge 节点] ── verdict：加权(因果遗传 > 相关) · 冲突(一等输出) · robustness(leave-one-out，仅“通过边缘”靶点)
     │ ⑤
     ▼
   Runner（代码）：通过 → 下一阶段；不足/冲突/脆弱 → 回 stage 1/3 重排·补证据
```

**一眼要点：**
- **两类东西**：`[…节点]` = 智能/不确定，需装箱 + fresh context + judge 验收；**Runner 与聚合 = 确定性代码**（编排者，不验收、不计为节点）。
- **judge 出裁决、Runner 做转移**：状态机不在节点里。
- **scatter-gather** 在 stage 1（证据提名）与 stage 4（验证）复用；barrier 在此正确。
- **粒度**：算法 = 被节点调用的工具（不单开 session）；一个节点 = 一个角度/完整工作流。
- **两层 fan-out**：纵向 over 候选靶点（stage 2–4），横向 over 验证角度（stage 4 内）。

> 组件职责见 §2，关键设计决定见 §3，发现段节点清单见 [DOMAIN §5.1](DOMAIN.md)。

## 1. 三层 + index + observer

```
┌─────────────────────────────────────────────────────────────────────┐
│ 外层  RUNNER / 状态机   (imperative shell, 纯代码, deterministic)      │
│   • 定义节点（阶段）+ 每个节点的 typed I/O 契约                          │
│   • 路由：成功→下一阶段；失败→重试/恢复；judge 说没收敛→重跑            │
│   • 副作用收敛：把节点产出 download/post_process 进 index               │
│   • loop / terminate                                                  │
│   • 必须"愚蠢而确定"——绝不是常驻的聪明 agent                           │
└───────────┬───────────────────────────────────────────┬───────────────┘
            │ 为每个阶段 spawn 一个全新节点                │ 调 judge 拿 verdict
            ▼                                             ▼
┌───────────────────────────────┐         ┌──────────────────────────────┐
│ 中层  WORKER 节点 (boxed agent) │         │  JUDGE 节点 (stateless)        │
│   一次性 CC session 自主跑完     │         │   读 index 摘要 → 出 typed     │
│   • CC harness：skills / 子agent │         │   verdict {converged,score,…} │
│     / tools / todo 自跟踪        │         │   • raw API + structured out   │
│   • 固定 system prompt(角色)     │         │   • 无状态：每次全新 context    │
│   • allowed_tools / max_turns    │         │   • 顾问，不编排                │
│   • 全新 context, 一次性 cwd      │         └──────────────────────────────┘
│   • 收尾 submit_result(typed)    │
└───────────┬───────────────────────────────────────────────────────────┘
            │ 通过工具够到知识
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 底层  TOOLS / MCP / 外部 INDEX (权威数据源)                            │
│   文献检索 / 数据库 / 结构预测 / docking …                             │
└─────────────────────────────────────────────────────────────────────┘
            ▲ 只读投影
┌───────────┴───────────────────────────────────────────────────────────┐
│ 旁路  OBSERVER (read-only, CQRS)  人类只读 index/事件流, 不能写进程       │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 组件职责与不变量

### Runner（外层 / imperative shell）
- **纯代码、确定性**。是 effect handler / 状态机：定义节点、类型契约、路由、副作用收敛、loop/terminate。
- **硬不变量**：Runner 不是常驻的聪明 agent，不带累积 context。否则 context 污染搬到顶层，全套白做。
- 做两类决定：
  - **(a) 确定性路由**（成功→下一步，失败→重试/恢复）= 纯 if/else。
  - **(b) 需要智能判断时** → 调一个**无状态 judge 节点**拿 typed verdict，再由代码 act on it。

### Worker 节点（中层 / boxed agent = functional core）
- 一个节点 = 一个**有界阶段** = 一次**全新的 CC session**，一次性自主跑完。
- **本身就是顶层 main agent**（Runner 是纯代码、不占 agent 层级，所以自动成立）；其缓存意义与"节点内子 agent 只有一层"的注意事项见 §3.6。
- 内部**尽情用 Claude Code 的 harness 能力**：skills、子 agent / agent team、内置+MCP 工具、todo 自跟踪。
- **盒子由 Runner 钉**：固定 system prompt（角色）、`allowed_tools`、`max_turns`、全新 context（跨节点不 resume）、一次性 cwd（脏堆）、headless 预授权、收尾产出 typed 结果写进 index。
- **harness 给 loop，不给盒子**——schema / 终止 / 隔离 / 类型化返回仍是我们的活。

### Judge 节点（决策智能）
- **无状态**：读 index 的有界摘要 → 出 `verdict`（typed）→ 写回 index。每次全新 context。
- 它**行为上有状态**（试了几次、上次结论都在 index 里），**实现上无状态**（fresh context 读进来）。
- **顾问不编排**：只产 verdict，"据此干什么"是 Runner 的确定性代码。
- 不需要 CC harness（只对摘要推理），用 **raw Messages API + 结构化输出**最省。

### Index（权威数据源）
- 唯一持久状态。副作用收敛于此。worker 的"返回值"= 写进 index 的标准化输出。
- 跨迭代**累积/更新**的是 index；**context 每节点重置**。两者不能混。
- 同时提供**可观测性**：observer 读 index → headless 但不黑箱。

### Observer（只读旁路 / CQRS）
- 人类的会话界面被降级成**只读观察者**：读 index / 事件流，**没有写路径**，不能影响进程。
- 会话那份危险的"有状态"挪到只读下游就无害了。
- 若要人类干预：走**同一个 index / typed-input 边界**，作为新的类型化输入由下一轮拾取——**绝不**中途往运行中的 loop 灌自由文本。

## 3. 关键设计决定

### 3.1 节点执行器选型

目标：worker 节点要**一次性跑完 + 复用 CC harness（skills/子agent/tools/todo/编排）+ 自托管 + 不造轮子**。

| 方案 | 给你什么 | loop 在哪 | 自定义工具 | 选用 |
|---|---|---|---|---|
| raw Messages API + 手动 loop | 只有模型 + tool_use 协议，harness 自己造 | 你 | JSON schema 工具 | ❌ worker（会重造轮子）；✅ **judge** |
| **Claude Agent SDK** (`claude-agent-sdk` / `@anthropic-ai/claude-agent-sdk`) | **CC 整套 harness 当库**，headless | **你的机器（自托管）** | **进程内 `@tool`** + MCP | ✅ **worker（首选）** |
| **`claude -p` CLI 子进程** | 同上（SDK 底层就是 spawn 它） | 你的机器 | 只能外部 MCP | ✅ worker（要进程隔离 / 非 Py·TS 时） |
| Managed Agents | harness + 托管容器 | Anthropic（外包，类比 Robin→Edison） | host-side custom tools | ⚪ 备选（想要托管容器时） |
| pi / oh-my-pi core | 同 Agent SDK 性质（在学的那套，TS，可深改） | 你的机器 | 扩展系统注册 | ⚪ 备选（要深度定制 harness 时） |

**决定**：
- **worker 节点 = Claude Agent SDK（或等价的 `claude -p` 子进程）**，headless 一次性跑完，复用 CC 的 skills/子agent/tools/todo。
- **judge 节点 = claude -p（Agent SDK session）+ `submit_verdict` in-process tool（typed）**（2026-06-02 实测演进，见 §3.4；原设计为 raw Messages API，但 claude -p 同样拿 typed、且评分稳 ~10×，前置确定性 `_gate` 查格式）。
- **Runner / observer = 我们自己的薄代码**。
- `claude -p` 与 Agent SDK **起的是同一个 claude 引擎、同一条 session**；SDK 只是这条 session 的官方客户端。选 SDK（进程内自定义工具）还是裸 CLI（进程隔离 / 非 Py·TS）按需。

### 3.2 不造轮子：领域流程写成 CC 原生资产
外层**不**用代码编排领域流程，而是把它**声明成 CC 原生资产**：
- `.claude/skills/*/SKILL.md`——每个阶段怎么做、何时拉子 agent、调哪个工具；
- `.claude/agents/*.md`——agent team 成员；
- `.claude/commands/*.md`——一句话入口（slash command）。

节点 = 一次性 `claude -p "/target-discovery <input>"`，CC 自己加载 skill、拉子 agent、跟踪 todo、跑完。**外层代码缩到「按固定顺序 spawn 节点 + judge + 写 index」。**

### 3.3 粒度
- **一个节点 = 一个有界阶段 = 一个全新 CC session**（内部可任意 fan-out 子 agent）。
- **CC 的编排力用在阶段内**；**我们的状态机管阶段间**。
- ❌ 不要把整条多阶段 campaign 塞进一个 session——那就退回"一个大 agent"：context 污染、不可复现、自检不可信、中断没法续。

### 3.4 验收：judge 外置，不信 CC 自检
- CC 的"任务是否完成"是 **session 内自评**（todo 打勾、模型自己说做完了），会**过早宣布完成**。
- 所以"这阶段产出够不够好 / 要不要重跑"由**外层无状态 judge** 独立裁决。**节点内自检 ≠ 外层验收**，两者都要，拍板的是外层。

**judge 最终形态（2026-06-02 实测演进，三层 + 两条被实测推翻的旧结论）**：
- **三层职责拆分**：
  1. **`_gate`（确定性脚本）**：查业务硬规则（候选非空/有 source、overview 不提名）——**零 LLM 成本先跑；格式/完整性归脚本，不归 LLM**（否则浪费 + 拖累评分稳定）。
  2. **claude -p judge**（`claude_agent_sdk.query` session + `submit_verdict` in-process tool = **typed** Verdict）：**只评语义质量**（领域合理性 / 证据是否真支持 / 逻辑 / 冲突）；**只挂 `submit_verdict`、不挂外部工具——judge 评判不行动**（核查交独立 worker，如 stage-4；事实真伪由 worker 用真工具产出时保证）。
  3. **harness 决策**：pass = `mean_score ≥ DD_JUDGE_PASS`(默认 0.6)；**LLM 的 `converged` 布尔仅 advisory**（实测它噪声最大）。即 **judge advises score / harness decides threshold**——LLM 给它擅长的评分，"过不过"由 harness 用确定阈值定。
- **被实测推翻的两条旧说法**：
  - ~~"claude -p 失去 schema 校验"~~ → **错**。claude -p 经 `submit_verdict` in-process tool 同样拿 typed（与 worker 的 `submit_result` 同机制）；旧说法只针对 `--output-format json` 解析 result 文本那条路（实测会得到 `result:"DONE_CP"`，不可控）。
  - ~~"DeepSeek 不适合当 judge"~~ → **半错**。不稳的根是 **raw API 形态**（一次性 forced-tool 拍脑袋打分）不是模型：同一 brief，**raw judge std≈0.2**（0.95/0.733/0.533），**claude -p judge std=0.025**（0.9-1.0，9 次）——**agentic（有 thinking/多轮深思）让同一个 DeepSeek 评分稳 ~10×**。
- **设计经验 + 参数**：需要**稳定判断**的任务，**agentic 形态 > raw 一次性 forced-tool**（同模型亦然）。`DD_JUDGE_VOTES` 默认 **1**（claude -p 单票就稳，far from 0.6）；consensus（N 票 mean score）留作降噪手段。成本 ~$0.156/次（~27k ctx + agentic），`DD_JUDGE_VOTES`/`DD_JUDGE_PASS`/`DD_JUDGE_MAX_TURNS` 均 env 可调。代码：`judge.py`（`_gate`/`_verdict_server`/`_judge_once_claude`/`api_judge`），commits `a34c930`(gate)/`4f11783`(claude -p)。

**通用模式：`gate + claude -p + typed 出口`（2026-06-02 提炼，全项目同构）**——judge 的三层其实是项目里**所有"LLM 出 typed 结构"节点的统一形态**，不止验收：

| 节点 | 角色 | gate（脚本，先跑） | claude -p（语义） | typed 出口 | 外部工具 |
|---|---|---|---|---|---|
| **judge** `api_judge` | 验收 | `_gate` 业务规则 | 评 rubric | `submit_verdict`→Verdict | 无（评判不行动） |
| **planner** `plan_validation` | 规划 | 菜单 clamp（角度∈菜单） | 选验证角度 | `submit_plan`→ValidationPlan | 无 |
| **intake** `validate_disease` | 守门 | 空/超长/纯符号 | 翻译+判是否真疾病 | `submit_intake`→DiseaseIntake | **仅** OT `search_disease`（命中 EFO=证据） |
| worker `sdk_worker`（执行变体） | 执行 | —（产出交 judge 验收） | 推理+调工具+产出 | `submit_result`→NodeOutput | **多**（OT/EuropePMC，要真做事） |

- **三个判断/决策节点（judge/planner/intake）现已全部 = 脚本 gate + claude -p + in-process typed tool**，且全部 `disallowed_tools` 禁 CC 内置工具（否则会用 WebSearch 越权"核查"——见 literature judge 教训）。**planner 此前是最后一个 raw forced-tool 节点**（std≈0.2 不稳、无 gate、无 submit 时校验），2026-06-02 统一到 claude -p（拿 std 0.025 稳定性 + submit 时菜单 clamp）。
- **worker 是同构变体**：同样 claude -p + typed，但**执行**节点——无 gate、**挂多个外部工具**（真查 OT/文献）。**判断节点禁工具（评判/规划/守门不行动）、执行节点给工具（做事）**——工具归属区分见 §3.7(D)；intake 是例外中的例外（守门需 1 个只读工具 search_disease 作判据，但 EFO 命中本身是证据，非"行动"）。
- **intake = pipeline 前的 input 守门**：用户输入翻译成英文 + 查 OT EFO，**只放真实疾病进流程**（中文/别名归一化成 OT 标准英文名 + EFO 喂下游），非疾病/恶意输入挡门外。`--real` only（dummy 跑控制流不调 LLM）；拒绝时 stage-0 标 exhausted + reason（web 可见）。实测放行 `老年黄斑变性`→`age-related macular degeneration`(EFO_0001365)、`type 2 diabetes`→`…mellitus`(MONDO_0005148)；拒 `帮我写首诗`、`'; DROP TABLE --`(识别为注入串)。
- **收口位置 = `Runner.run`，不是某个入口（2026-06-02 教训 `ab8ef28`）**：`intake_fn` 注入进 `Runner.run`（像 `judge_fn`，Runner 不 import intake、保持哑）。**因为能启动 pipeline 的入口有两个**——cli `dd-agent run`（`cli.main`）和 api `POST /api/campaigns`（web UI → `api._run_pipeline`），各自构造自己的 Runner。初版只把守门写进 `cli.main` → **web 触发的 run 走 api 那条、绕过了它**（`帮我写首诗` 直接进 stage-0）。守门必须放在**两入口的唯一共同收口 `Runner.run`**（所有入口最终都调它启动 pipeline）才全覆盖；同时修了 api 漏传 `planner_fn`（web run 的 stage-4 曾退化到 `_default_plan`）。代码 `intake.py`/`planner.py`/`runner.py`，commits `6f7ca23`/`ab8ef28`。

### 3.5 headless 无人值守的硬要求
- 必须**预授权**（`permission_mode="bypassPermissions"` 或 `can_use_tool` 回调 / `--allowedTools`），否则节点卡在等人确认。
- `max_turns` 定终止；fresh session 每节点；一次性 cwd 当脏堆。

### 3.6 为什么 Runner 保持哑代码、阶段保持独立 session（理由 + 节点内嵌套注意）

> **"节点是顶层 main agent" 不是一条要记住去执行的纪律——它是架构的自然结果**：Runner 是纯代码、不是 agent，所以它经 Agent SDK / `claude -p` 起的每个节点天然就是顶层 `claude` session（主 agent）。本节记录两件事：**(A) 为什么必须保持这样**（支撑 §3.3/§3.4 两个已做决定的理由），**(B) 真正要在节点内部盯的唯一一件事**。

#### A. 两个理由 —— 守住"Runner 哑"(§3.4) 与"每阶段独立 session"(§3.3)

别被诱惑去把 Runner 升级成"聪明的 orchestrator agent"，也别把多个阶段塞进一个大 session 当 stage-subagent。否则同时踩两个坑：

1. **缓存命中**：Anthropic 的 prompt cache **只惠及主 agent 的请求**（~1h TTL）。一旦某个 orchestrator agent 占了主位，真正干活的 worker 沦为 subagent → 不享受主 agent 缓存；被缓存的反而是每轮都变的编排逻辑（命中率低）→ 干活的全价 input → 账单爆炸。**节点作为顶层主 agent 时，它稳定的 system+tools 前缀才真正被缓存**（见 DETAILED-DESIGN §9）。
2. **子 agent 递归被禁**：框架**只允许一层委派**（主 agent → subagent；subagent 不带 Task 工具，开不了下一层）。若 orchestrator 占主位、worker 是 subagent → worker **再也开不了自己的子 agent**，节点内 agent team 能力归零。**节点作为顶层主 agent 时，才保得住"节点内 fan-out 一队子 agent"的能力**（§2）。

→ 所以编排只能在 Runner（纯代码、不占 agent 层级）里发生；**绝不引入"主 agent 当总管"**。参考 manifesto《状态机优于编排器》§二.5/§二.6。

#### B. 节点内部唯一要盯的：子 agent 只有一层（且只限"再开 agent"，不限工具）

上面第 2 条的另一面——节点（depth-0 主 agent）可以 fan-out 一队子 agent（depth-1），但 **depth-1 成员不能再 spawn 子 agent（depth-2 静默不可用）**。三个澄清，避免误读：

- **天花板只管"再 spawn agent（Task）"，不管"调工具"**：depth-1 子 agent 照样自由用 Bash / 文件 / Grep / WebFetch / **MCP 领域工具**——这些是工具调用，不吃委派层级。
- **正常扁平 fan-out 完全没问题**：节点 → 一队子 agent，每个子 agent 各自用工具干活 = depth-1，合法。**SDK 的一层上限正好兜住，这种结构不用操心。**
- **唯一要避开**："让一个子 agent 自己再当小 orchestrator 去委派下一层"——那本身就是该避免的迷你 orchestrator。
- **设计规则**：需要"再委派"的活，要么**节点本身（depth-0）直接做**，要么把那个能力**包成 MCP/工具**（不吃层级），别让 depth-1 成员去 spawn depth-2。

> 一句话：顶层（节点=主 agent）是设计自带、不用管；要管的只有"别在节点里套第二层 agent"，而把能力做成工具就绕开了。

### 3.7 fan-out 验证（scatter-gather）+ 节点/工具粒度原则

**(A) scatter-gather 验证模式**（用于 stage 4 `target-validation`，并可复用到 stage 1 多证据提名）：
`planner 节点(无状态, 出类型化 plan) → Runner 并行 fan-out「一个(靶点×角度)=一个 worker 节点」(barrier) → 确定性 gather(union, 保各角度原始) → synthesis 节点(LLM 加权裁决 + 冲突标注) → 无状态 judge 出 verdict → Runner 确定性转移`。
- 一个角度 = 一个**顶层 worker 节点**（**不是**单节点内 fan-out 子 agent）。理由：① §3.6.B——顶层节点才能再开自己的子 agent（如 TWAS 跨组织 fan-out）；② §3.4——聚合/判定交**外部 judge**，不信节点内自评。
- barrier 在此**正确**（judge 需全部角度才判）；长算角度用 submit→resume 异步（见 B-2），别让 barrier 干等。
- 动态选角度 = planner；**模式 (a)**：只从「已封装工具菜单」选（(b) 自动封装未接工具 / (c) 安装新工具算法 = 未来规划）。plan **记入 index**（可复现、有界：角度数/预算上限 + 每角度理由）。
- 并行由 **Runner（确定代码）**发起；**别让 LLM 节点在一次 thinking 里并行 SSH**（取消级联污染 thinking 签名）。
- **gather 之后需 synthesis 节点（2026-06-02 补，验证完整链时发现）**：确定性 union（`_merge_by_symbol`）保各角度原始证据（可复现 / judge 透明 / 可消融），但**只机械合并、不裁决**。stage-4 rubric 要的「**加权裁决**（因果向 genetic 主导，弱/空者标 WEAK/FAIL，不因 safety 好就笼统通过）+ **显式冲突标注**（如 genetic-null vs safety-ok）」是**语义判断**——此前**无产出者**，summary 机械写"N validated"、裁决缺失 → judge 持续打回（stage-4 exhausted 3/3）。补一个 **synthesis 节点**（union 之后、judge 之前）专做这步裁决。它还是 **judge `retry_feedback` 的正确落点**：per-(靶点×角度) 原子 worker **盲于跨角度**（genetic session 看不到 safety），即便收到"标 X 的冲突"也做不到；synthesis 看全部角度，才能据 feedback 定向改。**分工**：union 保原始（消融用）、synthesis 出裁决（rubric 用）——比 stage-0 的 session 内 split-and-merge 更细（stage-0 无独立 union 层）。**synthesis 为 stage-4 验证特有**（裁决是验证语义）；stage-1 提名 union 即可（judge 评覆盖度，无需加权裁决）。验证：补节点后 stage-4 **1 次过 score 0.80**（C3/HTRA1 PASS、C9 WEAK、C5/CFD FAIL 并标 CONFLICT——正确区分"药理验证 vs 遗传验证"），judge 不再 0.5/0.6 边缘震荡。

**(B) 节点 vs 工具的粒度原则**——"算法工具一律封装为工具调用、不单开 session；节点 session = 一个角度/完整工作流，不是单个工具"。**成立**，与 §12 控制谱系、agent-as-tool 区分、§3.6 成本一致：
- **算法 = 确定性工具**（`f(params)→result`，无需推理循环）→ 封装为 **MCP/in-process 工具**由节点**调用**；为跑一条命令单开 session = 浪费 + 抽象倒置。
- **节点 session = 一个角度/完整工作流**（推理 + 调若干工具 + 解读 + 出类型化结果），**不是单个工具**。
- 三条细化：
  - **B-1 边界=要不要推理**：纯计算无判断的角度（跑一次 vina 出分）可由 **Runner 直接调工具**（更便宜更确定）；需选参/解读/迭代/纠错的角度才配 agent 节点——节点挣的是"推理"的钱。
  - **B-2 长异步重算**（MD/AlphaFold）：工作流在异步边界**挂起→续跑**（submit-节点拿 job-id 后 session 结束 → headless 跑 → Runner 完成时唤起 resume/解读节点），**别在一个 session 里干等数小时**（= 代数效应 suspend/resume）。
  - **B-3 注入形式（§12）**：算法**调用** = 工具/MCP（硬、必调）；角度**方法学/how-to** = skill 或节点 CLAUDE.md（软）。**别把必调算法藏在 skill 里**（可能被跳过）。
- 副效益：工具调用可复现（`vina(params)` 可重放，整段 session 不可）；§3.6.B——节点调工具不吃委派层级，节点仍保留 fan-out 子 agent 的能力。

**(C) 工具选择 + 消融判断**（同一验证目标内，审计补强）：
- **工具选择**：planner 为一个角度给**工具集 + 策略** —— `best`(选一个) / `consensus`(2+ 同类并跑取一致，**关键角度=遗传/扰动 默认**) / `fallback`(按 priority，失败或数据缺则降级)。选择判据：数据可用 / 组织·modality 匹配 / 成本 / 历史可靠性（结构化，非自由文本）。
- **方法消融**：in-silico KO 即基因消融，**强制对照**（负=随机/无关基因，正=已知靶点如 ROCK/ripasudil）→ 判效应**特异**而非伪影。
- **敏感性消融**：judge 做 **leave-one-angle-out**（去掉任一角度结论是否翻转 → `robustness` = robust/fragile）+ 看同角度多工具一致度（`tool_consensus`）；**仅对"通过边缘"靶点做**（明显通过/失败跳过，省算力）。

**(D) 工具调用的决策归属**（"菜单 by harness / 调用 by model"——审计补强）：
谁决定调 OpenTargets？**不是 harness**。边界划在「工具/阶段」之间，不划在「调不调工具」上：
- **harness 决定"上桌哪些工具"**：每个角度/阶段挂哪些工具（mode (a) 预封装菜单）由 harness 钉死——这是**领域知识**（如 stage-1 遗传角度挂 OpenTargets，因其聚合 GWAS Catalog + L2G locus-to-gene 打分，是遗传证据权威源）。
- **模型决定"动不动筷子、先夹哪盘"**：节点 session 内，**要不要调、调哪个 endpoint、查什么、查几次、怎么组合多工具、怎么解读** —— 全是 node 内 LLM 自主。harness **不发"去调 OpenTargets"指令、不替它拼 query**。
- **harness 不命令调用，而用 judge 的验收标准"逼"模型自己去调**：stage-1 judge rubric 要求"候选必须有遗传证据支撑"→ 模型空手提假设会被打回重试 → 它**自洽地意识到"要过 verdict 我得查 OT"**而主动调用。这是 perform/handle（设定"什么算完成"），不是 micro-manage（命令调哪个工具）。
- **边界**：**做不做哪一步（阶段/角度）= harness 钉死**（领域逻辑链固化 → 不漏、可复现，否则退化成自由对话 agent）；**怎么完成这一步（用哪些工具）= 模型自主**。
- **演进**：(a) 菜单固定（Phase A）→ (b) 模型动态增删工具 → (c) 模型即时写工具（未来，见本节 (A)）。

**(E) 角度集的决策归属**（stage 1 固定 / stage 4 planner——审计补强）：
"调哪些工具"由模型自主((D))，但"跑哪些角度"在两个发现阶段**故意不同**：
- **stage 1 提名 = 固定角度（无 planner）**：遗传/表达/网络/文献是疾病/靶点**无关**的标准证据普查维度（发现逻辑链 1a–1f）。此刻还没有具体靶点可供"因材施教"，且提名角度都便宜（API 查询）、漏一个=漏证据（无省算力动机）→ **固定 = 不漏 + 可复现**；planner 在此收益小、漏证据风险高。
- **stage 4 验证 = planner 动态选角度**（见 (A)）：已有选定靶点，验证角度依赖**靶点特异性质**（有无 eQTL→可否 coloc/TWAS、是否 TF→in-silico KO 选型、组织特异性、安全侧写）→ 必须 planner 看具体靶点+文献后定。
- **本质差异**：stage 1 是"普查"（标准项目人人查），stage 4 是"定制实验"（看病情定检查）。
- **可演进（统一 planner）**：把 planner 做成通用"角度规划"节点，两阶段共用——`stage1-planner(disease)` 从提名菜单选（默认全选，可按疾病裁剪/加权/加角度）；`stage4-planner(target+文献)` 从验证菜单选（靶点特异）。固定 4 角度退化成 planner 的默认值。
- **决定（2026-06-01）**：M2 先固定角度把 scatter-gather 机制跑通，**stage-1 planner 延到 M4 建 planner 时回填**（避免 scatter 与 planner 两个新机制耦合调试）。

**(F) fan-out 的三个层次（审计修正 2026-06-01，查证 CC subagent 机制后）**：
**先纠错**：早先反对过"一个 session 内 agentteam 做多角度 = 委派层级超限"——**此反对撤回**。CC subagent **硬性一层**（官方："Subagents cannot spawn other subagents"），层级限制自动满足；且 subagent **独立 context、parent 只收 output（不收 reasoning）**，CC 主动保持 orchestrator context 干净。所以 session 内 **split-and-merge**（orchestrator + 并行 subagent + synthesize）是 CC 原生模式，技术成立、不破坏盒子无状态。
**真正的取舍 = 聚合/judge 的粒度**（不是层级）：
- session 内 **LLM synthesize**：灵活、连贯综合（Robin 式）、少 Runner 代码；**但聚合不可复现、外部 judge 看不到各角度原始产出 → 做不了 §3.7C 的 consensus / leave-one-out 消融**。
- 顶层 **确定性 gather + 外部 judge**：可复现、judge 透明、可消融；但 gather 机械、Runner 多代码。
**本项目的三层 fan-out 粒度（决定）**：
| 层次 | 怎么做 | 聚合 | 为什么 |
|---|---|---|---|
| **stage-0 disease-overview** | 一个 session **split-and-merge**（文献理解疾病：子型/组织/机制/通路） | session 内 LLM synthesize → disease brief | 此处无"各角度独立验收"需求，synthesize 合适；brief 存 index 喂下游角度 + stage-4 planner |
| **角度内**（如 genetic 内跨组织/多源） | 角度 session 内 **subagent split-and-merge**（Task fan-out 子 agent） | session 内 synthesize 该角度结论 | "角度内分解"，不跨角度；CLAUDE.md 的 `genetics-analyst` 等即此。实现需 `allowed_tools` 含 `Task` + 验证 DeepSeek subagent 兼容（backlog） |
| **跨角度**（genetic vs expression…） | 顶层 **Runner scatter + 确定性 gather(union) + synthesis 节点 + 外部 judge** | union (`_merge_by_symbol`) 保原始 → synthesis 出加权裁决/冲突标注（见 (A)） | **保 union**：§3.7C 关键角度 consensus + 边缘靶点 leave-one-out **必须 judge 看到每角度独立产出**；**裁决**（加权/冲突）union 机械合并做不到 → 加 synthesis（stage-4 验证特有，提名不需要） |
**一句话**：overview 与角度内用 split-and-merge（连贯、CC 原生）；**跨角度的聚合判定用顶层 scatter（保消融与可复现）**。

### 3.8 持久化与恢复（CC 边界 + Runner 的 durable 责任）

**调研结论（2026，见 [REFERENCES](REFERENCES.md)）**：所有本地/SDK 编码 agent（Claude Code、Codex、Aider、Amp、Devin）只做到 **session 级恢复**（重放 transcript + 文件快照）；**唯一做到 workflow 级 durable execution 的是 Cursor 云端，且靠外挂 Temporal**。→ **durable 是独立引擎，agent 不自带；我们必须在 Runner/index 层自建。** 语言：**Python**（同类科学 agent 全 Python + 领域工具生态；Agent SDK 双语成熟，不构成 TS 理由）。

**两层要分清：**
- **session 级**（CC 白嫖）：持久化对话 transcript，resume 时重放进新 context。**关键陷阱：transcript 记录"调过哪些 tool"，不追踪"副作用是否已发生" → resume 会重复发起 tool call（重跑命令 / 重复提交作业）。**
- **workflow 级**（我们自建）：每步落盘，崩了从断点续，长作业**幂等 / exactly-once**。

**节点内可直接复用 CC/Agent SDK（免费）：**
- 单节点中断 → 存 `session_id` + `resume`（尤其 `error_max_turns`/`error_max_budget` 提限续跑）；`fork_session` 分支；transcript JSONL（`~/.claude/projects/<cwd>/<id>.jsonl`）当免费审计日志。
- ⚠️ `/rewind` 文件 checkpoint **只追踪 Edit/Write，不追踪 bash/外部工具改的文件**（我们领域工具几乎全是外部命令 → 别指望它）。
- ⚠️ 跨主机 resume 不自动（session 文件本地 + cwd 编码）。**Anthropic 自己建议：别靠 transcript 跨机恢复，把结果存成应用状态传给新 session ——正是本项目 index-as-权威源**（节点输出存 index，不靠 transcript）。

**Runner/index 层必须自建（CC 帮不上）：**
- **跨节点 pipeline durable**：index 存每条 pipeline 状态（哪些节点完成、产出、各节点可 resume 的 `session_id`）；崩了从第一个未完成节点续。节点产出当**内容寻址工件（content-addressed artifact）**落盘，不靠 transcript 恢复。
- **长 GPU/slurm 作业幂等（头号风险）**：见下模式。
- **原子提交**：节点产出写临时路径、成功后 rename；Runner 校验工件完整再标记完成。

**长作业循环模式（短-loop + 解耦 + 幂等）：**
```
✗ 错：节点里 submit_slurm(); 等几小时; 解读        # 崩了 resume → 重复提交

✓ 对：
  [submit 节点]  key = hash(node_id + inputs)
                 if index.has_job(key): jobid = index.get(key)      # 幂等：已提交→重连
                 else: jobid = sbatch(...); index.put(key, jobid)   # 先记 jobid 再算“已提交”
                 → 返回 jobid，节点退出（session 结束）
  [Runner 代码]  轮询 sacct(jobid) 到 DONE（崩了重启→读 index 拿 jobid 继续轮询，不重交）
  完成 → 起 [解读节点] 读产物（content-addressed）
```
即 Cursor 经 Temporal 得到的"short loops that exit + 解耦 loop 与机器状态"，我们手写轻量版。

**落地策略 (c)→(a) 渐进：**
- **Phase A 先 (c)**：快节点（LLM/API/分钟级）先跑通 loop 控制流，崩了重跑代价小，index 预留 durable 接口。
- **一接 GPU/slurm 长算就上 (a) 手写轻量**：idempotency key + 记 jobid + 重连而非重交（上面模式）。
- **(b) Temporal** 留到将来多用户/生产化（它不强加 agent 抽象，与"哑 Runner + 隔离 session"哲学对齐）。

**(a) 手写轻量 durable 的实现 ＝ 三件套（互补，缺一不可）：**

1. **恢复编排 ＝ daemon watchdog**（节点外的看守进程；比 hook 强在子进程崩了它还活着）：
   - subprocess 起每个节点 `claude -p --output-format stream-json --verbose`，拿 OS pid；从 stream-json 提取 `session_id`（init/result 消息）；
   - 监控会话流的 **API 错误码（如 524）/ 进程非零退出**；命中 transient → `claude --resume <session_id>` + 发"继续"自动续跑；
   - **重试上限 + 退避 + 区分 transient（524/网络 → 重试）vs terminal（逻辑卡死/judge 不过 → 不重试）**，防 524 无限 resume 死循环。
   - **现成参考实现：coder-loop**（见 [REFERENCES](REFERENCES.md)）——`recoverStaleSchedulerState`（启动杀进程组 → stale 节点回退 → 重拾取）、`decideResume`（transient-5xx/signal → resume；clean/timeout → fresh）、退避预算上限、`probe-claude-resume` 实证 resume 跨轮保留 context；**进程组级 kill 务必照做**。照其算法用 Python 重写即可省大量试错。
2. **幂等 / 不重复副作用 ＝ `PreToolUse`/`PostToolUse` hook + index 对账**（⚠️ 没它，上面的 resume 会**重复副作用**——**524 最危险：超时但作业可能已提交**）：
   - `PreToolUse`：`key=hash(node_id+tool+规范化params)` 查 index，已执行 → block + 返回已存的结果/jobid（确定性 gate、对 agent 透明，合 §3.7B/§12）；
   - `PostToolUse`：把副作用结果/jobid 持久化进 index；
   - 长作业 resume 后**先 `squeue/sacct` 查 key 是否已提交、重连 jobid，而非重交**；`PreToolUse 放行 → 执行 → PostToolUse 记录` 之间崩溃的残留窗口，靠此查重兜底。
3. **跨节点 pipeline + 进度 ＝ Runner/index（持久层 = SQLite + artifact-store 分离）**：**状态/队列/run 记账/各节点 `session_id`/幂等键放 SQLite(WAL)**（事务 + `busy_timeout` + `UNIQUE` 防重入队 + schema 版本化迁移——吸收自 coder-loop `sqlite-state.ts`）；**科学产物（targets/evidence/结构/MD 轨迹）仍 content-addressed 文件**。崩了从第一个未完成节点续；daemon 自身状态也在 SQLite（机器整崩则由 systemd/Runner 从 DB 重建——"谁看守看守者"）。

> **一句话分工**：**daemon** 管"挂了自动接着跑"；**hook/index** 管"接着跑时别重复已发生的副作用"；**Runner/index** 管"跨节点进度与崩溃重建"。三者合起来才是完整的 (a)。

## 4. 一次请求的生命周期

```
Runner.run(campaign_config):
  state = Index.load_or_init(campaign_config)         # 权威数据源
  for stage in PIPELINE:                              # 固定阶段序列（领域 workflow）
      while True:
          node_input = build_input(stage, state)      # 类型化输入（从 index 投影）
          out = spawn_worker(stage, node_input)        # 全新 CC session, headless, 一次性跑完
          state = Index.converge(state, stage, out)    # 副作用收敛进 index
          verdict = judge(stage, Index.summary(state)) # 无状态 judge, typed verdict
          if verdict.converged: break
          if attempts >= stage.max_attempts: break/escalate
      # observer 始终能只读 state
  return Index.final(state)
```
