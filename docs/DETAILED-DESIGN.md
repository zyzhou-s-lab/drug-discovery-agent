# 细节设计

承接 [ARCHITECTURE.md](ARCHITECTURE.md)。本页给到可实现的细节：schema、目录结构、各组件接口、领域阶段流程、headless 配置、caching、路线图。

技术栈默认：**Python**（Runner / judge / index），**Claude Agent SDK**（worker，底层 `claude` CLI），**MCP**（领域工具），模型 `claude-opus-4-8`（worker，adaptive thinking + effort=high）/ `claude-opus-4-8` 或更省的 judge 模型。

---

## 1. 仓库目录结构（目标）

```
drug-discovery-agent/
├── README.md
├── docs/                          # 本方案
├── pyproject.toml
├── src/dd_agent/
│   ├── runner.py                  # 确定性状态机：阶段序列、路由、收敛、loop
│   ├── pipeline.py                # 领域阶段定义 (PIPELINE = [Stage(...), ...])
│   ├── worker.py                  # spawn 一个全新 CC session 节点 (Agent SDK / claude -p)
│   ├── judge.py                   # 无状态 judge：raw Messages API + 结构化输出
│   ├── index.py                   # 权威数据源读写 + 投影 (build_input / summary / converge)
│   ├── schemas.py                 # pydantic：NodeInput / NodeOutput / Verdict / IndexEntry
│   └── observer.py                # 只读投影 / CLI dashboard
├── .claude/                       # CC 原生资产 —— 领域流程"声明"在这里, 不在代码里
│   ├── skills/
│   │   ├── target-hypothesis/SKILL.md
│   │   ├── literature-evidence/SKILL.md
│   │   ├── assay-proposal/SKILL.md
│   │   ├── candidate-generation/SKILL.md
│   │   └── data-analysis/SKILL.md
│   ├── agents/                    # 子 agent / agent team 成员
│   │   ├── literature-miner.md
│   │   ├── pathway-analyst.md
│   │   ├── critic.md
│   │   └── ...
│   ├── commands/                  # slash 入口（每阶段一个）
│   │   └── td-<stage>.md
│   └── settings.json              # 工具白名单 / 权限 / MCP 配置（headless 预授权）
├── stages/                        # 每阶段一个 scoped cwd（目录=身份；worker 启在这里）
│   └── <stage>/
│       ├── CLAUDE.md              # 本阶段角色 + 必做步骤（always-in-context, 不靠 SKILL.md 被读到）
│       └── .claude/skills/        # 只软链该阶段需要的 skill（收窄可见性）
├── mcp/                           # 领域工具 MCP servers
│   ├── chembl_server.py
│   ├── pubmed_server.py
│   ├── opentargets_server.py
│   └── structure_server.py        # AlphaFold/Boltz/docking
├── index/                         # 运行期权威数据源（git 跟踪关键产物；scratch 不跟踪）
│   └── <campaign-id>/
│       ├── manifest.json          # 当前状态 / 阶段进度 / 各阶段 verdict
│       ├── targets.jsonl          # 累积的候选靶点 + 证据 + 评分
│       ├── evidence/              # 文献/数据证据（带引用）
│       └── reports/               # 阶段报告
└── workspaces/                    # 一次性脏堆（.gitignore）—— 每节点一个 cwd, 跑完可删
    └── <campaign-id>/<stage>/<attempt>/
```

> **index/ vs workspaces/**：index 是**权威、持久、可观测**（关键产物进 git）；workspaces 是**不可信、一次性**，随时清空重来。对应 CONCEPTS §6。
>
> **目录 = 身份（每阶段 scoped）**：worker 启动在 `stages/<stage>/`（用它当 `cwd`），自动加载该目录的 `CLAUDE.md` + 只可见该阶段的 skills——用**目录**而非仅 `allowed_tools` 收窄能力边界。盒子更紧、context 更小、缓存前缀更稳定。对应 manifesto §四"目录=agent 身份"。`workspaces/` 仍是真正的脏堆；`stages/<stage>/` 只放只读身份资产。

## 2. 核心 schema（`schemas.py`，pydantic）

```python
class NodeInput(BaseModel):
    campaign_id: str
    stage: str
    disease: str                      # e.g. "idiopathic pulmonary fibrosis"
    objective: str                    # 本阶段目标（人话）
    context_refs: list[str]           # 指向 index 的指针（不灌全文，只给路径/id）
    constraints: dict[str, Any] = {}  # 预算、物种、模态偏好等

class TargetCandidate(BaseModel):
    symbol: str                       # gene/protein, e.g. "ROCK1"
    rationale: str
    evidence_refs: list[str]          # index 里的证据 id
    scores: dict[str, float]          # tractability / novelty / safety / ...

class NodeOutput(BaseModel):          # worker 的 submit_result 收尾工具产出
    stage: str
    summary: str
    artifacts: list[str]              # 写入 index 的文件/记录路径
    candidates: list[TargetCandidate] = []
    self_assessment: str              # 节点自评（仅参考，不作数）
    open_questions: list[str] = []

class Verdict(BaseModel):             # judge 的 typed 裁决
    converged: bool
    score: float                      # 0..1
    reasons: list[str]
    missing: list[str] = []           # 缺什么（驱动下一轮 retry 的 input）
    retry_hint: str | None = None
```

**验证段 schema（scatter-gather，stage 4；见 ARCHITECTURE §3.7）：**

```python
class ValidationAngle(BaseModel):     # planner 选出的一个角度（模式 a：tool 取自已封装菜单）
    angle: str                        # genetic | perturbation | expression | network | safety
    tool: str                         # 已封装工具名（如 fusion_twas / cell_oracle_ko / coloc）
    params: dict[str, Any] = {}
    tier: int = 1                     # 1=便宜先跑(gate)  2=贵(GPU/MD, submit→resume)
    rationale: str

class ValidationPlan(BaseModel):      # planner 节点输出（记入 index，可复现、有界）
    target_symbol: str
    angles: list[ValidationAngle]

class ValidationResult(BaseModel):    # 每个角度节点输出
    angle: str
    tool: str
    metric: dict[str, float]          # 如 {twas_p: 1e-6, ko_signature_shift: 0.42}
    direction: str | None = None      # 与疾病方向是否一致
    passed: bool
    confidence: float
    evidence_refs: list[str]
```

类型即契约：固定的是 schema 形状，内部内容动态（CONCEPTS §5）。

## 3. Worker 节点（`worker.py`）

一次性、headless、自主跑完一个阶段；内部复用 CC harness。

```python
# 伪代码（Agent SDK；字段名以当前 SDK 文档为准）
from claude_agent_sdk import query, ClaudeAgentOptions, tool, create_sdk_mcp_server

def make_submit_tool(sink: dict):
    @tool("submit_result", "提交本阶段的最终结构化产出，调用后视为完成", NodeOutput.model_json_schema())
    async def submit_result(args):
        sink["output"] = NodeOutput(**args)        # 捕获 typed 输出
        return {"ok": True}
    return submit_result

async def run_node(stage: Stage, node_input: NodeInput, workdir: str) -> NodeOutput:
    sink = {}
    opts = ClaudeAgentOptions(
        system_prompt   = stage.role_prompt,                    # 固定角色
        allowed_tools   = stage.allowed_tools,                  # 能力边界（含 mcp__*）
        permission_mode = "bypassPermissions",                  # headless 预授权
        mcp_servers     = stage.mcp_servers + [make_submit_server(sink)],
        cwd             = workdir,                              # 一次性脏堆
        max_turns       = stage.max_turns,                      # 终止
        model           = "claude-opus-4-8",
        # setting_sources 指向 .claude/（加载 skills / agents / commands）
    )
    prompt = f"/td-{stage.name} {node_input.model_dump_json()}"  # slash 入口加载领域流程
    async for _ in query(prompt=prompt, options=opts):
        pass                                                    # 一次性跑完，无人插嘴
    return sink["output"]                                       # 必须 submit_result 才有
```

要点：
- **类型化返回**：给节点一个收尾工具 `submit_result(NodeOutput)`，要求"调用后才算完成"——拿到强类型产出（Agent SDK 不像 raw API 能强制 JSON，这是替代方案）。
- **全新 context**：每次 `query()` 全新；跨节点**不 resume**。
- **领域流程在 `/td-<stage>` 这个 command + 对应 skill 里**，不在 Python。
- 裸 CLI 等价：`claude -p "/td-<stage> ..." --output-format stream-json --allowedTools ... --permission-mode ... --mcp-config ... --max-turns ...`，要进程隔离时用它。
- **顶层 main agent（自动成立）**：Runner 是纯代码，所以 SDK/裸 CLI 起的节点天然是顶层 session——要盯的不是"顶层启动"（废话），而是"节点内子 agent 只有一层，且只限再开 agent、不限工具调用"，见 ARCHITECTURE §3.6.B。
- **成本上限**：可加 `claude -p --max-budget-usd <N>` 给每节点设花费天花板，与 `max_turns` 双保险。
- **cwd = `stages/<stage>/`**：让节点继承本阶段 scoped 的 `CLAUDE.md` + skills（目录=身份，见 §1）。

## 4. Judge 节点（`judge.py`）

无状态、不需要 harness、强制 typed verdict。

```python
import anthropic
client = anthropic.Anthropic()

def judge(stage: Stage, index_summary: str) -> Verdict:
    r = client.messages.parse(
        model="claude-opus-4-8",
        max_tokens=2000,
        system=stage.rubric_prompt,            # 本阶段验收标准（gradeable）
        messages=[{"role": "user", "content": index_summary}],  # 有界摘要，不灌全量
        output_format=Verdict,
    )
    return r.parsed_output
```
- 读 index 摘要（不是 worker 的自评），出 `Verdict`。
- 行为有状态（attempts/history 在 index），实现无状态（fresh context）。
- **顾问不编排**：Runner 据 `verdict.converged` / `verdict.missing` 决定下一步（确定性代码）。

## 5. Runner / 状态机（`runner.py` + `pipeline.py`）

```python
@dataclass
class Stage:
    name: str
    role_prompt: str          # worker system prompt
    rubric_prompt: str        # judge 验收标准
    allowed_tools: list[str]
    mcp_servers: list
    max_turns: int = 40
    max_attempts: int = 3

PIPELINE = [Stage("target-hypothesis", ...), Stage("literature-evidence", ...), ...]

def run(campaign_cfg):
    state = Index.load_or_init(campaign_cfg)
    for stage in PIPELINE:
        for attempt in range(stage.max_attempts):
            wd = make_workspace(campaign_cfg.id, stage.name, attempt)   # 一次性 cwd
            node_input = Index.build_input(stage, state)                # 投影出 typed 输入
            out = asyncio.run(run_node(stage, node_input, wd))          # boxed worker
            state = Index.converge(state, stage, out)                   # 副作用收敛
            verdict = judge(stage, Index.summary(state, stage))         # 独立验收
            Index.record_verdict(state, stage, attempt, verdict)
            cleanup(wd)                                                 # 丢弃脏堆
            if verdict.converged:
                break
        else:
            escalate(stage, state)   # 用尽 attempts → 标记 + 可走 human-in-loop（经 index）
    return Index.final(state)
```
Runner 全确定性：没有 LLM、没有累积 context（ARCHITECTURE §2 硬不变量）。

## 6. Index（`index.py`，权威数据源）

- 存储：文件系统 + JSONL（`manifest.json` / `targets.jsonl` / `evidence/` / `reports/`）。关键产物进 git（可复现 + 可观测）；scratch 不进。
- 接口：
  - `build_input(stage, state) -> NodeInput`：把当前状态**投影**成本阶段的类型化输入（给指针不给全文）。
  - `converge(state, stage, out) -> state`：把 `NodeOutput.artifacts` 落盘、合并 candidates、去重、更新 manifest（= effect handler 的"收敛"）。
  - `summary(state, stage) -> str`：给 judge 的**有界**摘要。
  - 检索：BM25 / 向量索引建在 `evidence/` 上，供 worker 的检索工具够到（CONCEPTS §8）。

## 7. 领域阶段流程（药物靶点发现 workflow）

> **权威 pipeline 见 [DOMAIN.md §5](DOMAIN.md)——scope 已扩为「发现→设计」全链路（7 阶段：发现 1-3 / 桥接 4=structure-prep / 设计 5-6 / report）。下表是早期 6 阶段 sketch，保留作结构示意。**

借鉴 Robin 的 pipeline 形状 + Biomni 的工具集（见 [REFERENCES.md](REFERENCES.md)）。每阶段一个 `.claude/skills/<stage>/SKILL.md` + `/td-<stage>` command + 若干子 agent。

| # | 阶段 (stage) | 输入 | 节点内部做什么（CC harness） | 产出（写 index） | judge 验收 |
|---|---|---|---|---|---|
| 1 | `target-hypothesis` | disease + 约束 | 子 agent 并行扫通路/组学/遗传学，提出候选靶点假设 | `TargetCandidate[]` + rationale | 假设是否有机制依据、是否可证伪、覆盖面 |
| 2 | `literature-evidence` | 候选靶点 | 文献检索子 agent（PubMed/Europe PMC）+ 带引用综述（PaperQA 式） | 每靶点的证据包 + 引用 | 证据是否充分、引用是否真实、是否有反证 |
| 3 | `assay-proposal` | 靶点+证据 | 提出可验证的实验/assay，排序 | assay 方案 + 排序理由 | 可执行性、与机制的契合 |
| 4 | `candidate-generation` | 选定靶点/assay | 生成调节该靶点的分子/方式（接化学工具/结构预测） | 候选 + 性质预测 | 新颖性、可成药性、安全性初筛 |
| 5 | `data-analysis` | 实验/计算数据 | 持久 Python 跑分析（CC 的 eval/bash）、可视化 | 分析结论 + 图 | 结论是否被数据支撑 |
| 6 | `report` | 全量 index | 汇总成靶点发现报告 | 报告（带引用、可复现） | 完整性、可追溯 |

- **阶段内**可任意 fan-out 子 agent（agent team）、调 skill、用 MCP 工具、用 todo 自跟踪。
- **阶段间**由 Runner 串、judge 验收、index 收敛。
- 循环复用：某阶段没收敛 → judge 的 `missing` 驱动下一轮 `NodeInput` → 重跑。

## 8. 领域工具（MCP，`mcp/`）

| MCP server | 工具 | 用途 |
|---|---|---|
| `pubmed_server` | search / fetch | 文献检索（也可直接接 PaperQA2） |
| `opentargets_server` | target-disease assoc | 靶点-疾病关联、遗传学证据 |
| `chembl_server` | bioactivity / compounds | 化学/活性数据 |
| `structure_server` | AlphaFold / Boltz / docking | 结构预测、蛋白-配体 |

> 不重造领域工具：优先参考 **Biomni** 的工具/数据库集成清单，能搬就搬（REFERENCES.md）。

**Push 模式（CC v2.1.80+）**：stage 4/5 若要等**长时外部计算**（docking、AlphaFold 跑几小时），用 **MCP 长连接推送**唤醒节点，而不是在 `bash` 里 `sleep`-轮询——节点休眠不耗 token，计算完成即响应，省 token 且实时。对应 manifesto §四 Push 模式。

## 9. Prompt caching（长循环优化）

- worker 节点被循环调用上千次：把**不变前缀（system 角色 + tools 定义）做 ephemeral 缓存**，只让 per-invocation 的输入变。
- 前缀必须**逐字节稳定**（别塞时间戳/UUID）——与"fresh 但确定"纪律一致。
- Opus 4.8 最小可缓存前缀 4096 tokens；命中后缓存读 ≈ 0.1× 价。
- judge 同理：缓存 `rubric_prompt`，只变摘要。
- **关键前提：节点是顶层 main agent**——prompt cache 只惠及主 agent 的请求。这就是 ARCHITECTURE §3.6 把"节点必须顶层 main agent"列为硬约束的原因：否则缓存命中率塌掉、账单爆炸。

## 10. Observer（`observer.py`，只读）

- 渲染 `index/<campaign>/manifest.json` + targets/verdicts 的只读 dashboard / CLI。
- **无写路径**。人类干预 → 写一条 typed input 进 index，由下一轮拾取（ARCHITECTURE §2）。

## 11. 失败模式 / 注意事项

- **不要一个大 session 跑全程**（污染/黑箱/自检不可信/不可续）。一个阶段 = 一个 session。
- **不信 CC 自检**做验收——judge 外置。
- **headless 必须预授权**，否则卡等确认。
- **远程编排串行执行 SSH/工具批次**：并行批次里一条出错会触发同级取消级联，可能损坏 thinking-block 签名 → 会话永久 400。大输出先落盘再读。
- Managed Agents / Robin 式托管会**外包 loop**——若选自托管路线（本方案默认），用 Agent SDK / `claude -p` / pi core。

## 12. 控制谱系与放置原则（什么放哪）

四级控制谱系（manifesto §四），从硬到软：

| 等级 | 机制 | 特点 | 本项目用在 |
|---|---|---|---|
| 最硬 | **程序状态机** | 代码写死、100% 确定、零 token | Runner：阶段序列、路由、loop/terminate |
| 硬 | **MCP Tool** | 主动注入每次请求，LLM 必然可见 | **必做步骤**：领域工具、`submit_result` 收尾 |
| 软 | **Skill** | 被动存在，AI 可能读也可能不读 | **可选**领域流程 / 能力扩展 |
| 最软 | **Prompt / CLAUDE.md** | 一次性文本 | 阶段角色、风格、临时说明 |

**放置原则（必读）**：
- **必须执行的步骤不要只放 `SKILL.md`**——Skill 只给 LLM 一个文件名列表，读不读看 AI 心情（manifesto 原话：「降智的 opus 点名都不看」）。把**必做脚手架**提升为 **MCP 工具**，或写进 **slash command 正文 / `stages/<stage>/CLAUDE.md`**（始终在 context）。
- `submit_result`（收尾、拿类型化输出）已是 MCP / in-process 工具 ✓，保持。
- **可选**能力（"如需可查 X"）才放 Skill。
- 一句话：**确定性流程 → 状态机；不可遗漏 → MCP；可选能力 → Skill；一次性指令 → Prompt/CLAUDE.md。**

## 13. 计费与认证（订阅 vs API Key）

manifesto §一 指出的实操约束，对本项目（个人本地、跑在 `gpu-zhouy1`）很关键：

- **worker（`claude -p` / Agent SDK，个人本地用）可走订阅额度（OAuth）**，无需 API Key。注意：若环境里**同时**有 `ANTHROPIC_API_KEY` 和 OAuth 登录，CLI **优先用 API Key**（按 token 计费）；想走订阅要 `unset ANTHROPIC_API_KEY`。
- **judge 用 raw Messages API（`anthropic.Anthropic`）必须有 API Key**，走不了订阅 → 与"worker 想 unset key 走订阅"**冲突**。

**决定（默认 (a)，可改）**：
- **(a)【默认】judge 显式传 key、用独立变量名**：`anthropic.Anthropic(api_key=os.environ["DD_JUDGE_API_KEY"])`，**不污染全局 `ANTHROPIC_API_KEY`** → worker 仍可走订阅。judge token 量小，按量计费可接受。
- (b) **judge 也改用 `claude -p --output-format json`**：可走订阅，但**失去 `messages.parse` 的强 schema 校验**（需自己校验 + 重试）。成本极敏感时选它。
- worker 另可加 `--max-budget-usd <N>` 设每节点花费天花板。

## 路线图

1. **骨架**（不接真实领域工具）：Runner + Index + 一个 dummy worker（`claude -p` echo skill）+ judge，跑通"阶段序列 + 验收 + 收敛 + 重试"的控制流。
2. **CC 原生资产**：写 `target-hypothesis` 的 SKILL.md + `/td-target-hypothesis` command + 1-2 个子 agent；headless 预授权跑通。
3. **第一条真实工具链**：接 PubMed/OpenTargets MCP，跑通 stage 1→2（假设→证据）。
4. **judge 校准**：用已知靶点（如 Robin 的 ripasudil/AMD 案例）做 eval，校 rubric。
5. **扩流程**：补 stage 3-6，接化学/结构工具（参考 Biomni）。
6. **observer + 持久化**：只读 dashboard；index 进 git 做可复现。

> 关联记忆：本项目在研；harness 设计走 PL 视角；参考 pi/oh-my-pi、Robin、Biomni。Robin 已部署在 `gpu-zhouy1:~/Projects/robin`（notebook 默认；纯 Edison API 编排，无本地 GPU 计算）。
