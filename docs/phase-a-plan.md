# Phase A 实现计划（发现段 stage 1–4 端到端跑通 dry-AMD）

> 决策依据散见 [ARCHITECTURE](ARCHITECTURE.md) / [DOMAIN](DOMAIN.md) / [DETAILED-DESIGN](DETAILED-DESIGN.md) / [target-validation](target-validation.md)；本页是落地编排。
> **代码家 = `gpu-zhouy1:~/Projects/drug-discovery-agent`**（运行环境：Agent SDK、领域工具、SQLite、`/data` 都在 gpu）。本地编辑 → push GitHub → gpu `git pull` 运行/验证。

## 范围 & 前置（已定）
- **语言 Python**；栈：`claude-agent-sdk`(worker) + `anthropic`(judge `messages.parse`) + `pydantic` + `mcp` + `sqlite3`。`uv` 管理。
- **只做发现段 stage 1–4**（无 qiaoy1 阻塞）；设计段 5–7 = Phase B。
- **durable = (c) 级**：SQLite 状态 + 重启从断点续（节点分钟级，重跑代价小）；完整 **daemon watchdog + tool 幂等 hook（(a)，照 coder-loop）留接口、接 GPU 长算再上**。
- **计费（§13）**：worker 走订阅；judge 用独立 `DD_JUDGE_API_KEY`。
- **DoD**：`dd-agent run --disease "dry AMD"` 跑完 stage1–4 → 补体(CFH/C3)进 top-N、选定靶点过多角度验证（含对照/leave-one-out）、各 judge 校准、产物落 SQLite+artifact、**中途 kill 能 resume**。

## 文件树
```
drug-discovery-agent/
├── pyproject.toml          # uv; M0 deps=pydantic；M1+ 加 claude-agent-sdk/anthropic/mcp
├── src/dd_agent/
│   ├── schemas.py          # DETAILED §2 落码（M0：NodeInput/Output/Verdict/TargetCandidate/Evidence）
│   ├── index.py            # SQLite(WAL) state-DB + content-addressed artifact-store（吸收 coder-loop）
│   ├── runner.py           # 确定性状态机：for-stage / 重试 / scatter-gather fan-out+barrier / 断点恢复
│   ├── worker.py           # boxed CC session（M0=dummy；M1=Agent SDK + submit_result）
│   ├── judge.py            # raw API messages.parse（M0=dummy；M1=真实 typed Verdict）
│   ├── planner.py          # stage4 ValidationPlan（M4）
│   ├── pipeline.py         # PIPELINE=[Stage...]（8 阶段；Phase A 激活 1–4）
│   ├── daemon.py           # (a) watchdog 占位接口（接 GPU 时照 coder-loop 填）
│   └── cli.py              # dd-agent run / status / resume
├── mcp/                    # 领域工具 MCP（M1+：opentargets/pubmed/...）
├── .claude/skills/<stage>/SKILL.md · stages/<stage>/CLAUDE.md
├── tests/                  # smoke（M0 dummy 零 API）
└── /data/drug-discovery/projects/{campaign}/{state.sqlite, 01_discovery/, reports/}
```

## 里程碑（垂直切片，M0 先）
| M | 目标 | 做什么 | DoD |
|---|---|---|---|
| **M0 骨架(dummy)** | 证明控制流，零 API | schemas + index(SQLite+artifact) + runner(状态机+scatter-gather+断点恢复) + dummy worker/judge + pipeline(1–4) + cli | `dd-agent run --campaign dummy` 跑通 1–4；state.sqlite 有记录；**中途 kill 能 resume**；scatter 并行+barrier 正确 |
| **M1 stage-1 单角度真实** | 一条真实切片 | opentargets MCP；worker→Agent SDK+submit_result；judge→messages.parse；填 stage-1 CLAUDE.md；先只遗传、不 fan-out | dry-AMD 候选含**补体(CFH/C3)**；judge 校准 |
| **M2 stage-1 scatter-gather** | 多证据并行 | 加 pubmed/gtex/string MCP；runner fan-out（asyncio+semaphore）4 角度→聚合→judge | 多角度并行；补体 top-N、ROCK 机制候选 |
| **M3 stage 2–3** | 证据综述+选定 | stage2=paper-fetch/europepmc 带引用；stage3=三联评估(OT+ChEMBL+gnomAD+GTEx)选定 | 选定补体/ROCK |
| **M4 stage-4 验证段** | 多角度验证(发现侧) | planner(菜单选)；MCP 封 twas(FUSION/iRIGS)/insilico_ko(GRN_transfer/CellOracle)/expr/network/safety；scatter+加权·冲突 judge+leave-one-out；coloc/MR 装 R 后补 | 选定靶点过 ≥N 角度 |
| **M5 收尾** | 端到端+observer | observer 只读 dashboard；端到端 DoD | 全 DoD 通过 |

**关键路径**：M0 先（验证控制流+durable+scatter，不烧 API）→ M1 一条真实切片 → M2–M4 横向铺 → M5 收尾。

## 横切（贯穿）
- 环境：`uv` venv；`pip install gseapy mygene biopython`；headless 预授权（`permission_mode=bypassPermissions`/`allowed_tools` 白名单）。
- 测试：每 M 配 smoke；dummy 层零 API，真实层小 `--limit`。
- 数据底座：`/data/drug-discovery/projects/{campaign}/`（zhouy1 可写共享 /data）；state.sqlite + content-addressed artifact。

## M0 完成定义
`dd-agent run --campaign dummy --disease "dry AMD"` 跑通 stage1–4（dummy worker/judge，零 API）→ `state.sqlite` 有 4 阶段记录 → 再跑（或 kill 后重跑）= 全 done 跳过（durable resume）→ scatter 阶段并行+确定性聚合正确。

## M1 完成记录（2026-06-01）
**DoD 达成**：`dd-agent run --real --only target-hypothesis --disease "dry AMD"` 端到端跑通——worker（Agent SDK）自主选 `MONDO_0100114`(dry AMD) 并调 OpenTargets，候选含补体 **C3(genetic 0.71) / CFH(0.67)**（+CFI 提及）及 ARMS2/HTRA1/LIPC/APOE 等经典位点，每条 evidence 含 `source=OpenTargets`+genetic 分值可追溯；judge（typed Verdict）`converged=true, score=0.9`，missing 指出 CFI 未进 top10、CORO2B/COL10A1 功能注释薄弱——校准合理。

**对原计划的三处实现偏离**（更简单/更兼容，等价或更优）：
1. **in-process SDK MCP** 替代独立 stdio `mcp/opentargets_server.py`：用 `claude_agent_sdk.create_sdk_mcp_server`+`@tool`，无子进程；纯查询函数留在 `src/dd_agent/tools/opentargets.py`（urllib，可脱离 SDK/key 自检）。
2. **judge forced-tool** 替代 `messages.parse`：anthropic SDK 无 `.parse`；强制单 `emit_verdict` tool（`tool_choice`）是等价的 typed 结构化输出标准做法。
3. **real deps 改 optional extra `[real]`**：dummy 层 + OT 工具保持仅 `pydantic` 依赖。

**运行后端实证**：gpu 的 claude code 后端 = **DeepSeek（Anthropic 兼容层）**，`base_url=https://api.deepseek.com/anthropic`、`model=deepseek-chat`，token 在 `~/.claude/settings.json` 的 `env`、非 shell env → 运行时注入 `os.environ`。**DeepSeek 兼容层成功驱动了 Agent SDK 的 MCP 工具循环 + judge 的 forced-tool 结构化输出** → M2-M4 可沿用此后端，不必额外 Claude key。

## M2 切法（决定 2026-06-01，路线 (i)）
**先把 scatter-gather 机制用真实 worker 跑通，不引入 planner**（角度集决策归属见 ARCHITECTURE §3.7(E)：stage-1 角度固定，planner 延到 M4 回填）：
1. **角度暂用 OpenTargets 的 4 个 datatype 切分**：genetic→`genetic_association`、expression→`rna_expression`、network→`affected_pathway`、literature→`literature`。最小新代码、聚焦验证**并行机制**（4 个独立 boxed-agent session 并行 → 确定性去重合并 → judge）。
2. **独立证据源**（GTEx / STRING / Europe PMC）= 证据质量增强，延到 M2 后段或 M3（原 M2「加 pubmed/gtex/string MCP」据此推迟；datatype 切分先行）。
3. **确定性 gather 去重合并**：多角度提同一 symbol（如 CFH 在 genetic+expression 都出）→ 按 symbol 聚合 evidence + 合并各角度 scores（聚合=确定性代码，非节点）。
4. **DoD**：`--real` 跑 target-hypothesis 时 4 角度并行 fan-out → 合并候选（补体应多角度命中）→ judge 过；scatter 在真实 worker 下并行+barrier 正确。
