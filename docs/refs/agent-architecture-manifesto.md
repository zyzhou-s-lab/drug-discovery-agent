# 长程 AI Agent 架构设计：状态机优于编排器

> **核心观点：给 AI 设定起止点和边界，边界之外程序化，边界之间靠路由。**

---

## 一、Agent SDK 是写 Agent 的，不是写 Prompt 的

### 什么是 Claude Agent SDK？

[Claude Agent SDK](https://github.com/anthropic/agent-sdk) 是 Anthropic 提供的 Python/TypeScript 开发框架，用于构建自治 AI Agent。它的核心能力是：

- **定义 Agent 行为**：通过 system prompt + tool 列表，精确控制一个 Agent 实例的能力边界
- **工具调用**：Agent 可以调用外部 CLI、API、文件系统等工具，形成「感知 → 思考 → 行动」的闭环
- **子 Agent 派生**：一个 Agent 可以启动子 Agent，实现分层任务分解
- **程序化控制**：开发者用代码定义 Agent 的启动条件、终止条件、循环逻辑——而非在对话中口头描述

简言之：**CC（Claude Code）是你跟 AI 对话的界面；Agent SDK 是你用代码定义一个 AI 该怎么自主工作的开发框架。** 前者是交互工具，后者是构建工具。

### 计费与认证：订阅 vs API Key

一个很实际的问题：能不能用 Claude Pro/Max 的订阅额度来跑 Agent SDK？**看你怎么用。**

| 使用场景 | 能否用订阅（OAuth） | 必须 API Key？ |
|---------|-------------------|---------------|
| `claude` CLI 交互使用 | ✅ | 否 |
| `claude -p` 本地脚本调用 | ✅ | 否 |
| Agent SDK **个人本地实验/开发** | ✅ | 否 |
| Agent SDK **构建给别人用的产品/服务** | ❌ | 是 |
| 提取 OAuth token 做第三方后端 | ❌ | 是 |

> **`claude -p` 是什么？** `-p` 即 `--print`，是 Claude Code CLI 的**非交互模式**。普通 `claude` 启动的是交互式对话界面；`claude -p "你的指令"` 则直接执行指令并把结果输出到 stdout，没有 UI，适合用在脚本和管道中。常用参数：
> - `claude -p "重构这个函数"` — 执行单次任务并输出结果
> - `claude -p --output-format json "分析这段代码"` — 输出结构化 JSON
> - `claude -p --max-turns 3 "修复 bug"` — 限制最大执行轮数
> - `claude -p --max-budget-usd 5.00 "大型重构"` — 限制最大花费
> - `cat file.py | claude -p "review 这段代码"` — 管道输入
>
> 本质上，`claude -p` 就是**CLI 层面的 Agent SDK**——同样的模型、同样的工具调用能力，但通过命令行而非 Python/TypeScript 代码调用，且可以用订阅额度。

**红线在哪？**

- ✅ **个人本地用**：你自己机器上跑 Agent SDK 实验、写脚本、搞研究——可以用订阅，Anthropic 明确表示个人本地开发是允许的。
- ❌ **给别人用**：构建产品/服务、提取 OAuth token 做后端、让别人通过你的订阅凭证访问 Claude——这违反消费者服务条款，必须走 API Key 按量计费。

简言之：**订阅是给你个人用的，不是给你的产品用的。** 你自己写 Agent 自己跑，没问题；你写了 Agent 让别人跑、或者部署成服务，必须 API Key。

> **注意：** 如果你同时设了 `ANTHROPIC_API_KEY` 环境变量和 OAuth 登录，Claude Code CLI 会**优先使用 API Key**，导致你的使用按 token 计费而非走订阅额度。想用订阅的话，确保 `unset ANTHROPIC_API_KEY`。

### 自定义 API 接入：换通道，不是换模型

一个容易产生的误解：Agent SDK 的「自定义 API」**不是让你接别的模型（GPT-4、Gemini、Llama），而是让你选择通过哪条通道访问 Claude**。

> 打个比方：你可以选择坐飞机、坐高铁、还是自己开车去北京（通道），但目的地只能是北京（Claude），不能改成上海（GPT-4）。

| 接入方式 | 配置方法 | 本质 |
|---------|---------|------|
| **Anthropic 官方** | `ANTHROPIC_API_KEY` | 直连 Anthropic 的 Claude |
| **Amazon Bedrock** | `CLAUDE_CODE_USE_BEDROCK=1` | 通过 AWS 访问 Claude |
| **Google Vertex AI** | `CLAUDE_CODE_USE_VERTEX=1` | 通过 GCP 访问 Claude |
| **Azure AI Foundry** | `CLAUDE_CODE_USE_FOUNDRY=1` | 通过 Azure 访问 Claude |
| **自定义代理** | `ANTHROPIC_BASE_URL` | 通过你的代理访问 Claude |

### 能不能在代理层做协议翻译，偷换模型？

思路是对的：在 `ANTHROPIC_BASE_URL` 背后放一个代理（如 LiteLLM），收到 Anthropic 格式的请求后翻译成 OpenAI 格式，转发给 GPT-4 或其他模型，再把响应翻译回来。**这条路技术上可行，LiteLLM 就是这么干的。**

但实际效果取决于你用到 Agent SDK 的哪一层能力：

| Agent SDK 功能 | 协议翻译难度 | 换模型后的效果 |
|---------------|------------|--------------|
| **基础对话** | 容易——消息格式可以 1:1 映射 | ✅ 基本正常 |
| **工具调用 (tool_use)** | 中等——Claude 用 `tool_use` / `tool_result`，OpenAI 用 `tool_calls` / `function`，结构不同但可翻译 | ⚠️ 简单场景可用，复杂嵌套容易出错 |
| **extended_thinking** | 不可能——Claude 独有特性，其他模型没有对应概念 | ❌ 完全不可用 |
| **prompt_caching** | 不可能——Anthropic 服务端特性 | ❌ 字段被忽略 |
| **PDF/图片理解** | 取决于目标模型——多模态格式各家不同 | ⚠️ 需要代理额外处理 |
| **streaming** | 中等——SSE 格式的 delta 结构不同 | ⚠️ 需要代理逐 chunk 翻译 |

**结论：能不能用？能。好不好用？看你用多深。**

- 只用基础对话 + 简单工具调用 → 协议翻译代理够用，LiteLLM 开箱即用
- 依赖 extended_thinking、prompt_caching 等 Claude 独有特性 → 没法翻译，直接损失功能
- 还有一层**语义问题**：Agent SDK 内部的 system prompt 是针对 Claude 行为模式调优的，换模型后 prompt 效果可能劣化（如 Claude 对 XML 标签敏感，GPT 对 JSON 更友好）

### 真的想用别的模型做 Agent？

那 Claude Agent SDK 从一开始就不是正确的选择。你需要的是**模型无关的 Agent 框架**：

| 框架 | 特点 | 适用场景 |
|------|------|---------|
| **Vercel AI SDK** | 统一接口，provider 热切换 | 想在 OpenAI/Anthropic/Google 之间灵活切换 |
| **LangGraph** | LangChain 生态，状态机 + 任意模型 | 需要复杂 Agent 工作流 + 模型自由 |
| **裸写 API** | 直接调各家 SDK，最灵活 | 对框架没依赖，自己控制一切 |

> **总结：** Claude Agent SDK 是 Anthropic 的「专车」——坐着舒服、功能强大，但只去一个地方。你可以偷偷把引擎换了（协议翻译），短途能跑，长途大概率抛锚。真要去别的地方，还是老实换车。

### 关键认知分层：Prompt 的优先级差异

| 层级 | 工具 | Prompt 优先级 | 用途 |
|------|------|--------------|------|
| **应用层** | Claude Code (CC) | 低 — prompt 淹没在对话上下文中 | 日常编码、问答、轻量脚本 |
| **Agent 层** | Claude Agent SDK | **高** — prompt 是 Agent 的灵魂 | 构建可复用、可调度的自治 Agent |

在 CC 里写 prompt，实际上优先级很低——它会被对话历史、文件上下文、用户指令稀释。但在 Agent SDK 里写 prompt，优先级极高，因为那就是 Agent 的行为定义本身。

**真正的长程任务，应该直接用 Agent SDK 现写一个 Agent。** 定义好循环的启动条件和终止条件，让程序自己跑。

---

## 二、用程序状态机替代 AI Orchestrator

### 两个概念：Orchestrator 与状态机

在 AI Agent 领域，「谁来控制任务流转」是架构设计的核心问题。目前有两种主流范式：

**Orchestrator（编排器）** 是一种以 AI 为中心的调度模式。一个"总管 Agent"坐在顶层，它理解全局目标，把任务拆成子任务，分配给子 Agent 执行，收集子 Agent 的结果，再决定下一步做什么。本质上，**Orchestrator 把调度逻辑也交给了 AI**——让 AI 既当干活的，又当管事的。典型代表如 AutoGPT、MetaGPT 的多角色编排层，以及各种 "plan-and-execute" 框架。

**程序状态机（Finite State Machine）** 是一种以代码为中心的调度模式。任务的所有可能状态、状态之间的转换条件，全部用**确定性代码**定义好。AI 只负责在某个状态内执行具体操作（比如操作页面、解析内容），但「现在在哪个状态」「下一步去哪个状态」「什么时候停」全由程序决定。**调度逻辑是硬编码的，不消耗 AI token，不依赖 AI 的判断力。**

| | Orchestrator（AI 调度） | 程序状态机（代码调度） |
|---|---|---|
| 调度逻辑 | AI 运行时动态决策 | 代码预定义，确定性执行 |
| Context 消耗 | 高——必须持有全部子任务状态 | 零——状态存在变量/文件里 |
| 容错性 | 子任务故障可能污染全局 | 故障隔离在单个状态内 |
| 灵活性 | 高——可应对未预见情况 | 低——只能走预定义路径 |
| 适用场景 | 开放式、探索性任务 | 固定流程、可枚举状态的任务 |

核心洞察：**绝大多数被当作"需要 AI 编排"的任务，实际上是固定流程。** 它们的状态可以枚举，转换条件可以硬编码。把 Orchestrator 换成状态机，成本直线下降，可控性直线上升。

### Orchestrator 的致命缺陷

当你确实用一个 AI Orchestrator 来调度时，会遇到三个**概念层面**的问题：

1. **Context 爆炸** — 编排器必须持有所有子任务的状态，上下文窗口迟早打满
2. **盯盘成本** — 编排器要持续轮询子 Agent 是否完成，浪费 token
3. **故障扩散** — 某个子任务出问题，会污染编排器的整体判断

以及三个更致命的**工程层面**的硬约束：

#### 4. 任务本身就是状态

状态机不止是路由器——**任务的进度天然编码在状态机的当前状态中**，不需要 AI 额外维护一个 TODO list。

| | Orchestrator | 状态机 |
|---|---|---|
| 进度跟踪 | AI 要在 context 里记住"做了 A、B，还没做 C" | 当前状态就是进度，`state = "C"` |
| 持久化 | AI 自己总结和维护，容易丢信息 | 程序变量/文件，确定性存储 |
| 中断恢复 | AI 要重新理解整个 context 才能接着做 | 直接从上次的状态继续 |

#### 5. Cache Token 浪费 → 账单爆炸

Anthropic 的 prompt caching 机制：**只有主 agent 的请求才享受 cache（约 1 小时 TTL）**。如果 Orchestrator 占了主 agent 位置：

```
Orchestrator 占主 agent：

主 Agent = Orchestrator（缓存了调度指令、TODO list…）
  └─ SubAgent A（实际任务）← 不享受主 agent 的 cache
  └─ SubAgent B（实际任务）← 不享受主 agent 的 cache

→ 主 agent 缓存的是编排逻辑（每轮都变，命中率低，缓存了也没用）
→ 真正干活的 SubAgent 每次都是全价 input token
→ 该缓存的没缓存，缓存了的没有用 → 账单爆炸
```

```
状态机方案：

程序状态机（零 token）
  └─ 每轮启动的 Agent 本身就是主 agent
     └─ 它的 system prompt + 工具定义被有效缓存 ✅

→ 每轮 Agent 的 prompt prefix 高度相似，缓存命中率高
→ 账单可控
```

#### 6. SubAgent 递归禁止 → 执行层能力腰斩

当前几乎所有 agent 框架都**不允许 subagent 递归启动 subagent**。如果 Orchestrator 占了主 agent：

```
主 Agent = Orchestrator
  └─ SubAgent = 任务执行者
       └─ ❌ 调不了 browser_subagent（递归被禁）
       └─ ❌ 调不了代码分析 agent（递归被禁）
       └─ 只能用最基础的单次调用工具
```

关键在于：**很多「工具」本质上就是 subagent，不是简单的函数调用。** 浏览器交互、代码搜索、文件分析——这些 tool 底层自己就需要多轮推理。Orchestrator 占了主 agent 位置，它的 subagent 就没有 subagent 可用了，能力直接腰斩。

状态机方案则完全不存在这个问题：

```
程序状态机（不是 agent，不占层级）
  └─ Agent = 任务执行者（它就是主 agent！）
       └─ ✅ 可以开 SubAgent
            └─ browser_subagent ✅
            └─ 代码分析 agent ✅
            └─ 完整的工具链 ✅
```

> **六个缺陷总结：** 概念层面——context 爆炸、盯盘成本、故障扩散；工程层面——进度需要 AI 维护而非天然编码、cache token 浪费导致账单失控、subagent 递归禁止导致执行层能力腰斩。前三个是「不好用」，后三个是「根本不可行」。

### 解法：确定性状态机 + 文件信号

以「自动找房」为例——这是一个**纯固定任务**，不需要 AI 做调度决策：

```
┌─────────────┐
│  程序状态机   │  ← 纯代码，零 AI token 消耗
│  (循环控制器) │
└──────┬──────┘
       │
       ▼
┌─────────────┐     成功     ┌──────────────┐
│  启动 Agent  │ ──────────→ │ 写入结果文件  │
│  执行单次任务 │             │              │
└──────┬──────┘             └──────────────┘
       │ 
       │ 页面异常 / 无法继续
       ▼
┌─────────────────────────┐
│  Agent 写入 can_do_next  │
│  文件（含下一步信息）      │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  程序检测到文件 → 开新   │
│  Agent 实例继续执行       │
└─────────────────────────┘
```

**关键设计原则：**

- **AI 判断「在哪」，程序决定「去哪」。** Agent Browser 负责感知当前页面状态（AI 擅长的），但任务进度的推进由程序状态机控制（不需要 AI）。
- **文件即信号。** Agent 完成后留下一个 `can_do_next` 文件；程序检测到文件存在，就开新的 Agent 实例继续跑。没有文件，就停。
- **故障隔离。** 如果页面发生意外，那是**那一次任务**的问题，在那个 Agent 实例内部解决。不会上传、不会扩散、不会污染全局状态。

> 这种模式完全可控。不存在 Orchestrator context 爆掉的可能性。它也不需要盯着看 sub-agent 跑完没有。

---

## 三、Agent Browser 的正确封装姿势

Agent Browser 本身可以再包一层，做成小脚本。但这里有一个关键的职责划分：

- **AI 的职责**：执行具体的页面交互任务（点击、填表、提取数据），以及感知「页面当前跑到哪了」。
- **程序的职责**：决定任务进度——能不能继续、要不要开新的 Agent、什么时候终止。

**任务进度的调度不需要 AI 调度。** AI 只管执行和感知；程序根据 AI 留下的文件信号做调度决策。

```python
# 伪代码：Agent Browser 封装范式
while state_machine.has_next():
    task = state_machine.current_task()
    
    # AI 执行页面任务（AI 只负责干活）
    result = agent_browser.run(task.prompt)
    
    # --- 以下全是程序逻辑，不消耗 AI token ---
    
    # 检查 AI 是否留下了 can_do_next 文件
    if os.path.exists("can_do_next.json"):
        # 有文件 → 程序开新的 Agent 继续跑
        next_info = json.load(open("can_do_next.json"))
        os.remove("can_do_next.json")
        state_machine.advance(next_info)
    else:
        # 没有文件 → 任务结束，不跑了
        break
```

- **AI 执行任务**，干完活之后，如果还有后续可做，留下一个 `can_do_next` 文件。
- **程序检查文件**：有文件 → 开新 Agent 跑下一轮；没文件 → 收工。
- **AI 不做调度决策。** 它不判断「能不能继续」——它只管干活，干完就留信号走人。程序来决定要不要继续。

---

## 四、实战：目录即身份的多 Agent 批处理

### 多 Agent 协作的本质问题

有人用「开多个 session，互读彼此生成的文档」来搞多 Agent 协作。但不用 Agent SDK 框架，你做不到真正的"新开 session"——你只能用 `claude -p` 启动独立进程。至于 prompt 怎么传（写文件里还是命令行参数），没区别。

**真正重要的不是 prompt 怎么传，而是工作目录怎么组织。**

### 目录 = Agent 的身份证

Claude Code 和 Codex 都有项目级配置机制。当一个 agent 启动在某个目录下时，它会自动加载那个目录的：

| 配置 | 作用 | 类比 |
|------|------|------|
| **CLAUDE.md** | 系统指令——告诉 agent 这个项目是什么、该怎么做 | 员工的岗位说明书 |
| **Skills 目录** | 可用工具集——该 agent 能调用哪些 skill | 员工的工具箱 |
| **MCP 配置** | 强制注入的工具和上下文 | 员工的标配装备 |
| **Memory** | 持久化的项目记忆 | 员工的工作笔记 |

**控制目录 = 控制 agent 的能力、指令、和可见范围。** 这意味着你可以通过预先设计目录结构，精确定义每个 agent 的身份。

### 批处理架构：目录预分 + 状态机启动

```
project/
├── task-A/
│   ├── CLAUDE.md              ← "你负责做 A，只用 skill-X"
│   ├── .claude/
│   │   └── skills → [skill-X]       ← 只可见 skill-X
│   └── input_data/
│
├── task-B/
│   ├── CLAUDE.md              ← "你负责做 B，用 skill-Y 和 skill-Z"
│   ├── .claude/
│   │   └── skills → [skill-Y, skill-Z]
│   └── input_data/
│
├── task-C/
│   ├── CLAUDE.md              ← "你负责做 C，不用任何 skill"
│   └── input_data/
│
└── shared/                    ← 共享信息交换区
    └── results.json
```

程序状态机逐个启动：

```bash
# 每个 agent 启动在自己的目录
# 自动获得不同的指令、不同的 skill 可见性、不同的上下文
cd project/task-A && claude -p "执行任务"
cd project/task-B && claude -p "执行任务"
cd project/task-C && claude -p "执行任务"
```

> **为什么这里用 `claude -p` 而不是 Agent SDK？** 这是两条路：Agent SDK 是正道（可以创建 session、控制子 agent 生命周期、完整的程序化管理），`claude -p` 是不想写 SDK 代码时的轻量替代。这里展示的是**即便不用 Agent SDK，光靠目录规划 + `claude -p` 也能实现多 agent 协作**。核心智能在目录结构的设计里，不在启动方式里——同样的目录结构用 Agent SDK 启动效果更好，但 `claude -p` 也够用。

### Agent SDK 版本：同样的架构，更强的控制

如果用 Agent SDK，同样的批处理模式会变成：

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

# 定义每个任务的 agent 配置
TASKS = [
    {
        "cwd": "project/task-A",
        "prompt": "执行任务 A",
        "tools": ["Read", "Edit", "Bash"],
        "system_append": "你只负责任务 A，只使用 skill-X"
    },
    {
        "cwd": "project/task-B",
        "prompt": "执行任务 B",
        "tools": ["Read", "Edit", "Bash", "Agent"],
        "system_append": "你负责任务 B，可以使用 skill-Y 和 skill-Z",
        # SDK 独有：可以定义 subagent
        "agents": {
            "code-reviewer": AgentDefinition(
                description="代码审查专家",
                prompt="分析代码质量并提出改进建议",
                tools=["Read", "Glob", "Grep"],
            )
        }
    },
]

async def run_task(task):
    """每个任务是一个独立的 agent 实例"""
    results = []
    async for message in query(
        prompt=task["prompt"],
        options=ClaudeAgentOptions(
            allowed_tools=task["tools"],
            cwd=task["cwd"],                       # 工作目录 → 自动加载该目录的 CLAUDE.md、skills
            system_prompt_append=task.get("system_append", ""),
            agents=task.get("agents"),              # 可选的 subagent 定义
            permission_mode="auto",                 # 自动批准，无需人工干预
            max_turns=20,                           # 防止无限循环
        ),
    ):
        if hasattr(message, "result"):
            results.append(message.result)
    return results

async def main():
    # 方式一：串行执行（等价于 claude -p 逐个跑）
    for task in TASKS:
        await run_task(task)

    # 方式二：并行执行（SDK 独有——claude -p 做不到）
    await asyncio.gather(*[run_task(t) for t in TASKS])

asyncio.run(main())
```

**Agent SDK 相比 `claude -p` 多了什么？**

| 能力 | `claude -p` | Agent SDK |
|------|-------------|-----------|
| 工作目录配置 | ✅ `cd dir && claude -p` | ✅ `cwd` 参数 |
| Skills/CLAUDE.md 加载 | ✅ 自动 | ✅ 自动 |
| **Session 管理** | ❌ 每次是独立进程 | ✅ 可以 `resume=session_id` 继续上次对话 |
| **定义 SubAgent** | ❌ | ✅ `AgentDefinition` 精确控制子 agent 的 prompt 和工具 |
| **并行执行** | ❌ 只能 bash 后台 `&` | ✅ `asyncio.gather` 原生并行 |
| **Hook 拦截** | ❌ | ✅ `PreToolUse`/`PostToolUse` 拦截每次工具调用 |
| **结构化输出** | 有限 `--output-format json` | ✅ `--json-schema` 强制输出结构 |
| **成本追踪** | ❌ | ✅ 实时 token/费用统计 |
| **中途恢复** | ❌ | ✅ 捕获 session_id，崩溃后从断点续跑 |

> **总结：** `claude -p` 是 bash 层面的批处理——简单、快速、零开发成本。Agent SDK 是 Python/TypeScript 层面的程序化控制——session 管理、subagent 定义、并行执行、hook 拦截、成本追踪，一个都不少。两者共享同一个核心思想：**目录结构定义 agent 身份，程序控制任务调度。**

**这些批处理任务不必是完全一样的。** 你要精细调就给不同目录配不同的工具——skills 本来就已经写好了，Agent SDK 调用 skills 和 CC 是一样的。

### 四级控制体系：从代码到自然语言的控制谱系

Agent 系统中的控制手段不止三级——完整的谱系从硬到软共四层：

| 控制等级 | 机制 | 特点 | 用于 |
|---------|------|------|------|
| **最硬** | 程序状态机 | 代码写死，100% 确定性，零 token | 流程控制：先做 A 再做 B，循环、分支 |
| **硬** | MCP Tool | 主动注入 context，LLM 始终可见 | 每一步都必须执行，不允许遗漏 |
| **软** | Skill | 被动存在，agent 可能用也可能不用 | 常规能力扩展，偶尔不调也行 |
| **最软** | Prompt / CLAUDE.md | 一次性文本指令 | 临时任务说明、风格偏好 |

设计原则：

- **确定性流程控制** → 程序状态机（代码）
- **必须执行的步骤** → MCP Tool（主动注入，不可遗漏）
- **常规能力扩展** → Skills（被动可用，允许偶尔不用）
- **一次性指令** → Prompt / CLAUDE.md

### Skill 和 MCP 的真正区别：不是"Prompt vs 软件"

一个常见误解：Skill = 一段 Prompt 指令，MCP = 一个软件工具。**错。两者都可以随意构建——都可以包含指令，也都可以启动软件。**

比如一个 Skill 的 `SKILL.md` 里完全可以写"请先运行 `docker compose up`"——效果上和 MCP 启动一个 server 没区别。

**真正的差别只有一个：注入方式。**

```
MCP Tool 的注入：

Agent 的每次 API 请求 {
  system_prompt: "...",
  tools: [
    { name: "mcp_tool_A", description: "...", schema: {...} },  ← 完整定义
    { name: "mcp_tool_B", description: "...", schema: {...} },  ← 始终在这里
  ]
}

→ LLM 从第一个 token 就知道有这些工具，从头到尾都知道
```

```
Skill 的注入：

Agent 的 API 请求 {
  system_prompt: "...你有以下 skills 可用:
    paper-fetch, docx, semantic-scholar..."   ← 只有文件名列表
}

→ Agent 心想：要不要读一下 SKILL.md？
  → 可能读了 → 执行
  → 可能没读 → 跳过了
  → 降智的 opus 点名都不看 💀（真实案例）
```

> **结论：** Skill 和 MCP 都能启动软件、都能包含指令。区别只是 MCP 把完整工具定义塞进每次请求，LLM 不可能不知道；Skill 只告诉 LLM "有个文件在那里"，读不读全看 AI 心情。

### MCP 的杀手锏：Push 模式（v2.1.80+）

传统 agent 是 **Pull 模式**——agent 主动去拉数据：

```
Pull 模式（传统）：

Agent: "有没有新消息？" → 调用 tool → 拿到结果
Agent: "有没有新消息？" → 调用 tool → 拿到结果
Agent: "有没有新消息？" → 调用 tool → 拿到结果
           ↑
    浪费 token 不断轮询
```

Claude Code 2.1.80 之后，MCP 支持通过长连接向 agent **主动推送通知**，变成 **Push 模式**：

```
Push 模式（MCP 长连接）：

Agent 在等待...（不消耗 token）
                 ↑
MCP Server → 推送通知 → "工具列表变了 / 有新数据 / 外部事件发生"
                 ↓
Agent: 收到推送 → 立即响应
```

| | Pull 模式 | Push 模式（MCP 长连接） |
|---|---|---|
| 谁发起 | Agent 主动轮询 | MCP Server 主动推送 |
| Token 消耗 | 高——每次轮询都消耗 | 低——只在事件发生时消耗 |
| 实时性 | 差——取决于轮询频率 | 好——事件发生即通知 |
| 适用场景 | 短任务、主动查询 | 长时间运行、事件驱动、监听类任务 |

Push 模式让 agent 可以：
- **被外部事件唤醒**（Telegram 消息、webhook、文件变更）
- **休眠等待而不消耗 token**
- **实现反应式架构**——不是 agent 去找事情做，而是事情找到 agent

> **一句话：目录是 agent 的身份证，CLAUDE.md 是它的任务书，Skills 是可选工具箱，MCP Tool 是强制装备 + 事件推送通道。通过目录结构预先定义好每个 agent 的能力边界和任务指令，用程序状态机逐个启动——这就是不用 Agent SDK 框架也能做多 Agent 协作的方法。**


---

## 五、为什么 Skills 承载不了严肃任务

### Skills 的定位：轻量、单点、凑合用

Skills 适合不严谨的场景——快速搜个文献、格式化一段文本、跑个固定脚本。但它有根本性的架构限制：

> **Skills 模式下只有一个主 Agent。** 它自己把注意力分散完，然后丢三落四。从一开始列 TODO list 就是遗漏的。

### 严肃任务需要什么：以 Code Review 为例

一次严谨的 Code Review 至少涉及**三个完全不相关的维度**：

| 维度 | 需要的能力 | 需要的基础设施 |
|------|-----------|--------------|
| **产品理解** | 读文档、理解需求、验证功能完整性 | 产品文档、PRD、用户故事 |
| **代码评估** | 读代码、跑测试、验证边界条件 | 测试环境、容器编排、端口分配 |
| **UI/交互评估** | 截图、逐页点击、验证交互逻辑 | 浏览器自动化、E2E 测试框架 |

每一个维度本身就是一条流水线，且每条流水线都需要大量 sub-agent 协助：

- **代码评估**不是光看代码——那什么意义都没有。得有测试环境：起容器起在哪？端口怎么分配？是函数接口还是 API 接口？测试写的是 UT 还是 E2E？数据能不能覆盖边界条件？
- **UI 评估**基本上就是 E2E 测试：得有截图，得挨个点。Agent 自己给自己截图——别糊弄。

### Agent SDK 的解法：多入口 + 上下文隔离 + 共享通信

```
┌─────────────────────────────────────────┐
│            程序状态机 (主控)              │
├─────────┬───────────┬───────────────────┤
│ Agent A │  Agent B  │     Agent C       │
│ 产品理解 │  代码评估  │    UI/交互评估     │
├─────────┼───────────┼───────────────────┤
│ 独立     │  独立      │    独立           │
│ Context │  Context  │    Context        │
└────┬────┴─────┬─────┴────────┬──────────┘
     │          │              │
     └──────────┼──────────────┘
                ▼
     ┌─────────────────────┐
     │  共享信息交换文件     │
     │  (JSON/临时 list)    │
     │  三个 Agent 各自读写  │
     └─────────────────────┘
```

用 Agent SDK 自己写 Agent，你可以：

- **定义三个 Agent 入口**，各跑各的维度
- **临时写一个信息交换的 list**，让三个 Agent 工作在各自的 context 但能沟通
- **各调各的 CLI 和 Skills**，爱开多少 sub-agent 开多少
- 每个 Agent 的注意力集中在自己的维度，**不会相互稀释**

---

## 六、Prompt 工程的本质：系统工程，不是角色扮演

### 两种 Prompt 工程的对立

大多数人理解的「prompt 工程」是 RPG（Role Playing Game）——给 AI 设定一个角色：

> *"你是一个拥有 20 年经验的资深架构师，精通分布式系统，请用严谨专业的语气回答……"*

这就是在玩**角色扮演**——给 AI 捏人设，期待它因为「入戏」而表现更好。

真正的 prompt 工程是**系统工程**：

> **把不该由 AI 做的事情程序化，并且给 prompt 路由。**

| | RPG 式 prompt | 系统化 prompt 工程 |
|---|---|---|
| 在做什么 | 给 AI 加 buff（「你是专家」） | 给 AI 划边界（「你只做这一件事」） |
| 控制方式 | 祈祷 AI 理解你的角色设定 | 用代码强制执行流程 |
| 出错时 | 加更多角色描述，写更长的 prompt | 缩小 AI 的职责范围，增加程序控制 |
| 可复现性 | 低——同样的 prompt 可能出不同结果 | 高——程序路由是确定性的 |
| 本质 | **创意写作** | **软件工程** |

### 系统化 Prompt 工程的架构

```
用户请求
    │
    ▼
┌──────────────┐
│  程序逻辑     │  ← 分拣：哪些该程序做，哪些该 AI 做
│  (路由器)     │  ← 路由：选哪段 prompt、发给哪个 Agent
└──┬───┬───┬──┘
   │   │   │
   ▼   ▼   ▼
 P1   P2   P3    ← 每段 prompt 精确、专一、有明确输入输出
```

核心动作：

1. **分拣** — 一个任务里哪些部分是确定性的（不该让 AI 做），把它们写成程序
2. **路由** — 剩下真正需要 AI 的部分，用程序逻辑决定「哪段 prompt 在什么时候发给 AI」

Prompt 工程不是写一段万能 prompt，而是**设计一个系统**来管理多段 prompt 的调用时机。

### 一句话总结

> **给 AI 设定起止点和边界，边界之外程序化，边界之间靠路由。**

这句话有三层：

| 层 | 动作 | 例子 |
|---|---|---|
| **起止点** | 定义 AI 从哪开始、到哪结束 | Agent 只负责操作当前页面，不负责决定下一步 |
| **边界之外** | 用程序处理 AI 不该做的部分 | 状态机控制循环、文件信号控制调度 |
| **边界之间** | 用路由串联多段 AI 调用 | 程序决定哪段 prompt 在什么时候发给哪个 Agent |

---

## 七、总结：架构选择决策树

```
你的任务是什么？
│
├─ 一次性、轻量 → CC 直接做 / Skills 凑合
│
├─ 固定流程、可循环 → 程序状态机 + Agent SDK
│  └─ 文件信号驱动，故障隔离，context 永不爆
│
└─ 多维度、高质量评估 → 多 Agent 并行流水线
   └─ Agent SDK 定义多入口
   └─ 共享文件通信，独立 context
   └─ 每个 Agent 专注一个维度
```

> **一句话：让 AI 做 AI 擅长的事（感知、判断、生成），让程序做程序擅长的事（调度、循环、状态管理）。** 别让 AI 当项目经理——它记不住事。
