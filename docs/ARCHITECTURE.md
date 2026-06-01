# 架构

承接 [CONCEPTS.md](CONCEPTS.md)。这一页定义组件、职责、边界、以及节点执行器的选型。细节 schema 见 [DETAILED-DESIGN.md](DETAILED-DESIGN.md)。

---

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
- **judge 节点 = raw Messages API + 结构化输出**（不需要 harness，要纯净 + 强制 typed）。
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
`planner 节点(无状态, 出类型化 plan) → Runner 并行 fan-out「一个角度=一个 worker 节点」(barrier) → 确定性 gather → 无状态 judge 出 verdict → Runner 确定性转移`。
- 一个角度 = 一个**顶层 worker 节点**（**不是**单节点内 fan-out 子 agent）。理由：① §3.6.B——顶层节点才能再开自己的子 agent（如 TWAS 跨组织 fan-out）；② §3.4——聚合/判定交**外部 judge**，不信节点内自评。
- barrier 在此**正确**（judge 需全部角度才判）；长算角度用 submit→resume 异步（见 B-2），别让 barrier 干等。
- 动态选角度 = planner；**模式 (a)**：只从「已封装工具菜单」选（(b) 自动封装未接工具 / (c) 安装新工具算法 = 未来规划）。plan **记入 index**（可复现、有界：角度数/预算上限 + 每角度理由）。
- 并行由 **Runner（确定代码）**发起；**别让 LLM 节点在一次 thinking 里并行 SSH**（取消级联污染 thinking 签名）。

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
