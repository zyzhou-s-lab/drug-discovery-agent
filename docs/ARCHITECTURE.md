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
