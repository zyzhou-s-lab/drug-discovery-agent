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

### M2 完成记录（2026-06-01）
`--real --only target-hypothesis --disease "dry AMD"`：4 角度并行 fan-out → 确定性合并 **11 候选** → judge `converged=true, score=0.9`。补体多角度命中：CFH/C3(genetic+literature)、CFI(literature)。
**两点观察**：
1. **evidence.kind 不可信**：LLM 倾向填 datatype 名（`genetic_association`）而非 angle 名 → gather 的跨角度佐证计数语义乱。**已修**：Runner `_run_angle` 确定性给每条 evidence 盖 angle 戳（佐证统计不再依赖 LLM 守规矩）。
2. **expression/network 角度在 OT datatype 下对 dry AMD 空转**（AMD 遗传驱动，`rna_expression`/`affected_pathway` 分值弱）→ 印证第 2 点：独立源（GTEx/STRING/Europe PMC）是必要的证据增强，延到 M3。

## M3 切法（决定 2026-06-01）
M3 拆成 **M3a**（stage 间数据流 + stage 2 literature-evidence）+ **M3b**（stage 3 target-selection + stage-1 独立源 GTEx/STRING）。

### M3a 完成记录（2026-06-01）
- **stage 间数据流**：`NodeInput.prior_candidates` + `Runner._build_input` 从 index 读最近上游候选串给下游（确定性，节点仍 boxed；CONCEPTS §5）。
- **stage 2 literature-evidence**：worker（`_literature_worker`）读 10 个上游候选 → Europe PMC（`tools/europepmc.py`，stdlib）查**真实文献** → 每候选附真实 PMID（ARMS2:42180516 与工具自检结果复现一致，证明未编造）→ judge `converged=true, score=0.85`。worker 重构为按 stage 分发（`_hypothesis_worker`/`_literature_worker`/共享 `_run_session`）。
- **修复 bug**：`--only` 原先过滤 pipeline list，害 `_build_input` 看不到上游 → 改为 Runner 始终持完整 pipeline，`--only` 仅限制执行哪个 stage（`run(only=...)`）。
- **可观察性教训**：artifact 是 content-addressed（hash 命名），`glob[-1]` 非最新；**查产出认 index 的 `stage_state.output_json`（权威），别按 artifact 文件名排序**（印证 index-as-authoritative-source）。

### M3b 完成记录（2026-06-01）
完整发现链 **1→2→3 端到端跑通**（durable：stage1/2 复用，stage3 新跑）：
- **stage-3 target-selection**：worker 读 stage-2 的 10 候选 → 逐个 OT `target_profile`（tractability + gnomAD 约束 + safety，**一个 OT 源替代 ChEMBL/gnomAD/GTEx 三个 API**）→ **选定**：
  - **C3 = Top**（遗传 0.85 + 机制 0.9 + 小分子可成药 0.8 + 临床验证 pegcetacoplan/avacincaptad）
  - **CFH = 保留 + modality 分支**：worker 正确识别 AMD 风险变异是**功能减弱型 → 需增强而非抑制 → 推荐 antibody/AAV**（避开"CFH 小分子抑制剂"错误方向）
  - **HTRA1 = 次选**（蛋白酶抑制、可成药 0.75，缺临床验证）；其余 7 个按证据弱/不可成药/安全淘汰
  - judge `converged=true, score=0.85`
- **OT schema 踩坑**（自检逐个修正）：search hits 无 `approvedSymbol`；Target 无 `knownDrugs` 字段（`has_known_drug` 改从 tractability label 推断）。
- **stage-1 独立源（GTEx/STRING）= M3 剩余项**，延后（不阻塞发现链；M2 暴露的 expression/network 空转是质量问题，非链路问题）。

**发现段 stage 1-3 至此全部真实跑通**（提名 → 文献 → 选定）。

## M4 切法（决定 2026-06-01，路线 (i)：先机制 + 轻量真实工具）
M4 两块正交：① 机制（planner 动态选角度 + 动态 scatter + 加权/冲突 judge）；② 重型本地工具（FUSION/GRN_transfer/slurm/durable）。先做 ①（M4a），② 留 M4b。

### M4a 完成记录（2026-06-01）
**发现段 1-4 全链真实跑通**（提名 → 文献 → 选定 → 验证）：
- **planner**（`planner.py`，messages forced-tool `emit_plan` → typed `ValidationPlan`）：从固定菜单 `[genetic, safety]` 为每个选定靶点动态选角度——**第一次"运行时决定跑哪些角度"**（stage-1 是固定，§3.7 E）。实测对 C3/CFH/HTRA1 各选 genetic+safety。
- **Runner 动态 scatter**（`Stage.planner` + `_planner_validate`）：planner → 按 plan fan-out per (target×angle)（6 worker）→ `_merge_by_symbol` per target → judge；`_default_plan` fallback 让无 planner_fn 的 dummy/M0 也能跑。
- **验证 worker**（`_validation_worker`）：genetic→OT 遗传关联交叉确认；safety→OT `target_profile`（gnomAD 约束/安全）。
- **加权/冲突 judge**（`_VAL_RUBRIC`）：实测 `converged=true, score=0.45`——遗传稳健支持（通过），但**显式标注 C3 的 safety 冲突**（LoF constraint + 代谢综合征 triglyceride 风险），冲突拉分不一票否决。加权而非投票，符合设计。
- **修 bug**：DeepSeek 兼容层偶发在 forced-tool 返回空 input → `Verdict.model_validate({})` 崩 → `api_judge` try/except fallback（attempts=2 重试后过）。

### M4a 补强：stage-4 synthesis 节点 + 完整链端到端（2026-06-02）
完整 5-stage 链（含 stage-0）首次端到端连跑，暴露并修复 stage-4 的结构缺口：
- **现象**：stage-4 `target-validation` exhausted 3/3（judge 0.5/0.6 边缘震荡持续打回）。gate 过、worker 产出正常（5 靶点各 genetic+safety、sourced）——**不是 judge bug 也不是 gate**。
- **根因（架构缺口）**：stage-4 = `planner → per-(靶点×角度) worker → 确定性 union(_merge_by_symbol) → judge`。每个 worker **盲于跨角度**（genetic session 看不到 safety），union **只机械合并不裁决** → rubric 要的「加权裁决（genetic 主导）+ 显式冲突标注」**无产出者**，summary 机械写"N validated"。且 judge 的 `retry_feedback` 喂回原子 worker 也**没用**（worker 做不到跨角度裁决）。
- **修复（用户选 A）**：union 之后加 **synthesis 节点**（`_validation_synthesis` + dispatch `angle=="synthesis"` + runner `_planner_validate` 接线 + dummy 兜底回 union）。它看全部角度，做加权裁决（PASS iff genetic≥0.6；弱/空标 WEAK/FAIL）+ 显式标 genetic-safety 冲突，是 `retry_feedback` 的正确落点。**呼应 stage-0 split-and-merge**，但更细：union 保原始（消融用）+ synthesis 出裁决（rubric 用）。ARCHITECTURE §3.7(A)/(F) 更新。
- **验证（`fc5fef0`）**：stage-4 **1 次过 score 0.80**（148s，原 exhausted 3/3 耗 672s）。裁决：**C3(genetic 0.88)/HTRA1(0.66) PASS**、C9(0.58) WEAK、**C5/CFD(genetic 0.0) FAIL** 并标 `CONFLICT: genetic-null vs safety-ok`——synthesis 正确区分"**药理验证 ≠ 遗传验证**"（C5 有获批药 Izervay、CFD 限速步骤，但 dry AMD 遗传信号空 → 按 rubric 不通过）。**完整发现段 stage 0-4 端到端 1 次连跑通**。
- **附：literature judge 三层修复**：完整链中 stage-2 曾 exhausted，三层根因依次修——① full JSON 太大 judge 不调 submit_verdict（精简 `_summarize_output`，`92c5e4c`）② judge turn 耗尽（`max_turns` 8→25，`b40ab03`）③ **judge 越权用 WebSearch 查 PubMed 误判真 EuropePMC PMID**（2026 新文献 PubMed 未收录）→ `disallowed_tools` 禁 CC 内置工具（`722982f`）。score 0.25→0.75。**设计确认**：judge 纯评判、禁内置工具、不自核查；真实性由 worker 真工具产出时保证（§3.4）。

### M5 observer 已并行起步（HAPI，2026-06-01）
gpu 上由 **HAPI** 做出 M5 observer 并合并入主线（`cfa49d0`，与 M4a 在 worker.py 正交、零冲突）：`api.py`（Index 之上 CQRS 只读 HTTP/SSE + run trigger，**非节点，Runner 仍是唯一 writer**）+ `events.py`（Agent SDK 消息流 → per-stage JSONL step cards）+ `web/`（vite/tailwind/radix/mermaid 前端）+ worker `_emit_stream` + pyproject `api` extra + `scripts/seed_demo.py`。**待对接**：events 落盘的 `DD_ARTIFACTS`/path（本次 stage-4 未生成 events 目录，emit 被 worker 的 try 静默吞掉）。

### M5 联调完成（2026-06-01）
- **events 对接修复**：`events.emit` 靠 `events_dir_var`（ContextVar），cli 原先没设 → noop。修 `cli.py` 跑前 `events_dir_var.set(artifacts/campaign/events)`，cli run 现在落 step events（与 api 的 `_run_pipeline` 一致）。
- **api 起 + serve 真实数据**：`pip install .[api]` → `uvicorn dd_agent.api:app :8099`（`DD_DB`/`DD_ARTIFACTS` 指向真实 m3 库）。read 端点 serve 真实发现 run（含 M4a stage-4：C3/CFH/HTRA1 各 genetic+safety、judge 0.45），**非 seed replay**。
- **events 流验证**：cli 重跑 stage-3 → `events/target-selection.jsonl`（110 events：thinking / tool_use×39 / tool_result×39 / result）→ `/events` 端点 serve。
- **前端**：`web/` typecheck 过，`vite dev :5173`（proxy /api→:8099）起，全栈联通（proxy /api/health 200）。**浏览器访问 `http://10.202.2.224:5173`**（gpu tailscale IP；或 `ssh -L 5173:localhost:5173 gpu-zhouy1` 转发）。
- observer 本体是 HAPI 写的（前端组件 lifted 自 `tiann/hapi`，AGPL）；本次仅加 cli events 对接 + 指向真实 db。

## stage-0 disease-overview + 三层 fan-out 粒度（决定 2026-06-01）
审计后调整（ARCHITECTURE §3.7 F）：**撤回**"session 内 agentteam = 委派层级超限"的错误反对——查证 CC subagent 是硬性一层 + context 隔离（parent 只收 output）；真正的取舍是**聚合/judge 粒度**，不是层级。三层落地：
- **stage-0 `disease-overview`（新增，已实现）**：一个 session **split-and-merge**——用 OT `search_disease` + Europe PMC `search_literature` 查疾病子型/组织/机制/通路 → LLM synthesize 出 **disease brief** → 存 index。`Runner._build_input` 把 brief 串给下游所有 worker（`NodeInput.disease_brief`，经 `_run_session` 注入 system），给角度调查**聚焦背景**（缓解 M2 expression/network 空转）。**pipeline 现 5 stage（0-4）**。代码：schemas `disease_brief`、pipeline `disease-overview`+`_OVERVIEW_RUBRIC`、runner brief 传递、worker `_overview_worker`+`_brief_block`、`stages/disease-overview/CLAUDE.md`。
- **角度内 split-and-merge（backlog）**：角度 session 内 `Task` fan-out 子 agent——需 `allowed_tools` 含 `Task` + 验证 DeepSeek subagent 兼容，**延后**（stages/target-hypothesis/CLAUDE.md 已写 `genetics-analyst` 等占位）。
- **跨角度 scatter（保留）**：顶层 Runner scatter + 确定性 gather + 外部 judge——因 §3.7C 的 consensus/leave-one-out **必须 judge 看到各角度原始产出**。

### M4b 待办
重型本地工具（FUSION TWAS / GRN_transfer in-silico KO / coloc / MR）+ 独立源（GWAS Catalog / GTEx / STRING）+ **stage-1 planner 回填** + 可能 slurm + durable (a) 层；菜单扩 `perturbation`/`expression`/`network`。
