# Bun/TS 后端迁移 — 评估与计划

> 🟡 **STATUS：CURRENT 迁移计划（决策已执行中）** · as-of 2026-06-24
> 记录"要不要迁 / 怎么迁"的评估与 GO 决策（仍有效）。**实际迁移进度不在本页**——cutover 已推进到 phase 3c + circuit-breaker 并入 master，但**线上 8099 暂仍是 Python uvicorn，engine-ts 尚未在 gpu 部署**（`node_modules` 未装、bun 未上 PATH）。当前真实状态见 [engine-ts-status.md](engine-ts-status.md)。

> 评估「把后端/引擎从 Python 迁到 Bun/TS,科学计算继续留 Python 藏在 MCP 后」是否值得、怎么做。
> 触发点:计算层全在 MCP 后面、资产层是 JSON 文件 —— 引擎↔计算的契约**已经是语言无关的 JSON**,所以引擎理论上可换任意语言。

状态:**GO — Phase 0 spike 已通过(§2b),Phase 1 已并入 master(#31);待决策后续迁移时机/范围**。结论见 §2。

---

## 1. 背景

- **现状栈**:Python 后端(FastAPI + deep-research 引擎 + 工具 + sqlite)+ **TS 前端**(React/Vite)。科学计算(scGen 等)= Python,**通过 MCP(stdio/HTTP,JSON 契约)调用**。
- **关键观察**:`perturb_tools`(MCP)+ 资产层(`assets/*.json`)已经把**引擎↔计算**这道缝做成了**定死的 JSON 契约**。因此「引擎用 Python 才能和计算共享对象」这个论点**不成立** —— 引擎是纯编排 + I/O glue + 纯逻辑,没有 Python 独占依赖。
- **动机**:前端 + 引擎统一成一种语言(TS)→ 共享类型(消灭手维护的 `web/src/types/dda.ts` 镜像)、一套工具链、Agent SDK 更原生(claude CLI 本身是 Node)。

## 2. 结论先行(TL;DR)

- **技术可行,无硬阻塞**。引擎是 I/O-bound 编排层,所有 Python 依赖都有 TS 对应(详见 §5)。
- **性能中性**:负载是 I/O-bound(等 mimo 远端推理 + 网络),Bun 不会让 agent 变快。**别为性能迁。**
- **真收益是工程一致性**:前端+引擎一种语言、zod 端到端共享类型、SDK 原生。**随项目变大而复利**(尤其消灭 `dda.ts` 漂移)。
- **真成本是一次性重写**:~4100 行 Python(20 模块)+ 测试,到行为 parity 有时间和回归风险。
- **越早迁越便宜**(后端只会变大),但**必须分阶段 + 对拍**,不能 big-bang。
- **建议**:先跑 **Phase 0 spike**(1–2 天,验证 TS Agent SDK 的强制结构化输出 + 自定义 base_url(mimo)+ in-process MCP),它要么给整件事去风险、要么早早杀掉。**独立地**先上 `pydantic→TS codegen` 拿到类型同步收益(零重写)。spike 后再定全量迁不迁。

## 2b. Phase 0 实测结果 — **GO**(2026-06-21)

跑了 §7 Phase 0 spike(`bun` + `@anthropic-ai/claude-agent-sdk@0.3.185`),把 §6.1 的最高风险坐实:

- **离线 parity ✅**:TS SDK Options 全有我们依赖的原语 —— `createSdkMcpServer`/`tool`/`query` + `model` / `mcpServers`(in-proc MCP)/ `settingSources:[]` / **`env` 逐 query 注入(base_url/token/proxy)** / `permissionMode:bypassPermissions`(+ `allowDangerouslySkipPermissions`)。
- **在线实测 ✅**:对**非 Anthropic 后端**(Kimi,`kimi-for-coding @ api.kimi.com/coding`,自定义 base_url)跑一次 query,模型**正确调用了 forced `submit_result`**,结构化参数有效(`{answer:"Paris",confidence:"high"}`),`is_error:false`,7.9s。

**含义**:整个迁移最大的未知(当年 DeepSeek 上 `output_format` 翻车、被迫用 `submit_*` 的那个行为面)在 TS 上**复刻成功**。**GO/NO-GO 闸 = GO**,迁移技术上有底。剩下的是工程量/时机,不是可行性。

> spike 脚本已入库:`scripts/bun-phase0-spike.ts`(可复现:`SPIKE_BASE_URL=… SPIKE_TOKEN=… SPIKE_MODEL=… bun scripts/bun-phase0-spike.ts`)。

## 3. 现状盘点(逐模块分类)

后端 = **20 模块 / 4088 行**(master `b005cbe`)。每个模块的去向:

| 模块 | 行 | 职责 | 去向 |
|---|---:|---|---|
| `api.py` | 1077 | FastAPI 读模型 + run 触发 + config + SSE | **PORT** → Hono/Bun.serve |
| `research/deep_research.py` | 748 | 五阶段引擎(逐字移植自 `.js` 蓝本)+ dedup/rank/survives | **PORT**(源自 .js,反而好移) |
| `tools/paperfetch.py` | 419 | OpenAlex + Semantic Scholar 文献检索(HTTP) | **PORT**(纯 HTTP+JSON) |
| `research/orchestrate.py` | 298 | `_agent()` + Budget + Semaphore + 强制 `submit_*` | **PORT**(依赖 Agent SDK) |
| `index.py` | 238 | sqlite(WAL)状态库 + 内容寻址 artifact store | **PORT** → `bun:sqlite` |
| `runner.py` | 199 | pipeline 状态机 —— **仍被 `cli.py:15` + `api.py:639`(`start_run`)import 实例化** | **PORT**(Phase 3 纳入;非 legacy,先确认其在 deep-research 流里的实际角色) |
| `tools/opentargets.py` | 184 | OpenTargets GraphQL(遗传证据 + target-profile) | **PORT**(纯 HTTP) |
| `intake.py` | 170 | 疾病入口校验 + EFO 解析 | **PORT** |
| `proxy_bridge.py` | 129 | HTTP→SOCKS5 桥(agent 出网),`api.py` 启动钩子调用 | **PORT** 或保留 Python 小进程(Phase 2 定) |
| `research/nominate.py` | 118 | 确定性 OT 排序 → TargetCandidate[] | **PORT**(HTTP + 排序,非重计算) |
| `worker.py` | 103 | SDK 消息流捕获 | **PORT** |
| `research/scope.py` | 94 | 疾病 → 角度分解(1 agent) | **PORT** |
| `cli.py` | 80 | 命令行入口 | **PORT** 或弃 |
| `events.py` | 77 | per-stage JSONL 事件日志 | **PORT**(JSONL + SSE) |
| `schemas.py` | 68 | pydantic schema | **PORT** → **zod**(前后端共享)— 已起步:`engine-ts/src/schemas.ts`(#31) |
| `research/assets.py` | ~75 | 资产层(sources/db_facts/candidates JSON) | **PORT**(纯 JSON IO)— 来自 PR #28(合并后入 master) |
| `pipeline.py` / `llm.py` / `__init__` | ~60 | 杂项 | PORT/弃 |
| **`perturb_tools/`(scGen 等)** | — | **科学计算(torch/scvi/scanpy)** | **KEEP Python**,作为 MCP server 不动 |

**不动的边界**:MCP 协议(JSON)+ 资产 JSON 契约 —— 迁移期间保持稳定,作为对拍锚点。

## 4. 目标架构

```
┌─ Bun 进程 ────────────────────────────────────────────┐
│  HTTP API (Hono) + SSE                                 │
│  deep-research 引擎 (TS Agent SDK)                      │
│  in-process TS MCP 工具: submit_* / paperfetch / OT    │
│  bun:sqlite (Index) + JSONL 事件 + assets/*.json       │
└───────────────┬───────────────────────────────────────┘
                │ MCP (stdio/HTTP, JSON)  ← 不变的边界
┌───────────────┴───────────────────────────────────────┐
│  Python MCP servers: perturb_tools/scGen, geneformer…  │  ← 科学计算,保持 Python
└────────────────────────────────────────────────────────┘

前端 (React/Vite, TS) ── /api ──► Bun 后端     共享 zod 类型(monorepo),无 dda.ts 镜像
```

## 5. 技术映射(1:1)

| Python(现) | TS/Bun(迁后) | 备注 |
|---|---|---|
| `claude_agent_sdk`(query/tool/create_sdk_mcp_server) | `@anthropic-ai/claude-agent-sdk` | **§7 Phase 0 必须先验证 parity**(见 §6) |
| `asyncio.gather` | `Promise.all` | 直译 |
| `asyncio.Semaphore(DD_DR_CONC)` | `p-limit` / 自写信号量 | 并发闸 |
| `asyncio.Lock`(dedup) | 单线程事件循环天然串行 / 小 mutex | 更简单 |
| `contextvars`(events_dir_var) | `AsyncLocalStorage` | 1:1 |
| pydantic | **zod** | 前后端共享,顺手生成 JSON Schema 给 forced-tool |
| FastAPI | Hono / Elysia / `Bun.serve` | SSE 原生 |
| `sqlite3`(WAL) | **`bun:sqlite`** | 原生、快 |
| `requests`/`httpx`(OT/paperfetch) | `fetch` | I/O 工具 |
| SSE `StreamingResponse` | `ReadableStream` / Hono SSE | tail JSONL |
| pytest | `bun test` / vitest | 测试重写 |
| `threading.Thread`(后台 run) | `Worker` / 后台 async 任务 | 进程内,不变 |
| proxy_bridge(http→socks) | 同款 TS,或保留 Python 小进程 | I/O |

## 6. 风险与未知(诚实清单)

1. **【最高】TS Agent SDK 的 parity**。我们重度依赖几件事,**必须先在 spike 里坐实**:
   - **强制结构化输出 = `submit_*` in-process MCP 工具**(因为 DeepSeek/mimo 上 `output_format=json_schema` 实测不生效,见 `deep-research-port-plan.md §8`)。TS SDK 的 `createSdkMcpServer`/forced-tool 是否同样工作?
   - **自定义 `ANTHROPIC_BASE_URL`(mimo)+ AUTH_TOKEN** 是否被 TS SDK 尊重?
   - **`settingSources:[]`**(不让宿主 CLAUDE.md 泄入)是否有对应?
   - **每 agent 注入 env**(模型覆盖 + proxy)是否支持?
   - 流式消息(thinking/tool_use/tool_result)结构是否够我们做事件日志?
2. **行为 parity / 回归**:引擎有 salvage 分支、计票、去重排序等微妙逻辑。需要**金标对拍**(同一 campaign 跑 Py 和 TS,diff `report.json` + `assets/*`)。
3. **冻结期**:迁移期间功能推进受影响(per-angle、nomination 接 run 等正在路上)。
4. **逐字 .js 逻辑**(dedup/rank/survives):反而**更好移**(本来就来自 .js)。
5. **生态细节**:OpenAlex/OT 的 HTTP 重试/限流、sqlite WAL 语义在 `bun:sqlite` 的对应。

## 7. 分阶段迁移计划(去风险 + 可对拍)

> 原则:**Python 后端全程在跑,逐块对拍,最后才切**。每阶段一个 PR。

- **Phase 0 — Spike / 去风险闸(1–2 天)**。一个一次性脚本,验证 §6.1 的 5 件事(forced submit_* + mimo base_url + in-process MCP + env 注入 + 流式)。**GO/NO-GO**:不过就停在这,改走 codegen-types 路线。
- **Phase 1 — 纯逻辑 + schema**。移 `norm_url/dedup/rank_claims/survives/Budget` + zod schema,带移植的单测,**对拍 Python 单测**。无 IO,零风险。
- **Phase 2 — 工具 + 存储**。`opentargets`/`paperfetch`(HTTP)、`bun:sqlite` Index、events JSONL + SSE。
- **Phase 3 — 引擎**。`scope` + `research()` 编排(TS SDK)。scGen MCP **原样调用**(Python 子进程)。
- **Phase 4 — API + SSE**。Hono 端点镜像 `api.py`,**与 Python 后端并行跑(不同端口)** 做 A/B。
- **Phase 5 — 切换**。真实 campaign **金标对拍**(report.json + assets 一致)→ 前端指向 Bun 后端 → 退役 Python 后端(只留 compute MCP servers)。

## 8. 成本 / 收益总账

| | 内容 |
|---|---|
| **成本** | 重写 ~3900 行 + 测试到 parity;迁移期功能冻结;一次性回归风险 |
| **收益(复利)** | 前端+引擎一种语言;**zod 端到端共享类型,消灭 `dda.ts` 漂移**;Agent SDK 原生;部署更简单(Bun 单运行时 + Python 只剩 compute MCP) |
| **非收益** | **性能**(I/O-bound,瓶颈在 mimo 远端 + 网络) |

## 9. 决策矩阵

**该迁,如果**:长期确定要前端+引擎统一 TS;**产品/agent 编排复杂度** 的增长 > **科学计算复杂度** 的增长;团队 JS 强;能承受 ~数周冻结。

**别迁 / 延后,如果**:未来重心是计算/科学(Python 锚定);承受不了冻结。→ 改用 **codegen-types 过渡**。

> 关键事实:**无论迁不迁,Python 都在**(科学层)。迁移不是"消灭 Python",是把语言边界从「前端↔后端」挪到已经定死的「引擎↔计算 JSON 缝」上。

## 10. 推荐路径

1. **现在(零重写)**:接上 `pydantic → TS 类型 codegen`(JSON Schema → TS),消灭 `dda.ts` 手维护漂移 —— 这是无论迁不迁都该拿的收益。
2. **决策前**:跑 **Phase 0 spike**(便宜、决定性)。过 → 迁有底;不过 → 停,留在 Python + codegen。
3. **若 GO**:按 §7 分阶段迁,**全程对拍**,最后切换。把它当**有计划的迁移项目**,不是顺手重构。
4. **手头**:先把 per-angle 分治 + 增量落资产做完(实打实能力提升),迁移作为独立 milestone。

## 11. Phase 5 — 切换 runbook(2026-06)

**状态**:Phase 1–4 全部完成并 merged。`engine-ts/` 已**整套镜像 `api.py`**:`core schemas store events orchestrate scope litmcp deep_research app config run server` + `tools/` —— **96 单测 + 6 个 live smoke**(各阶段单独实测 Kimi 通过),`tsc` 干净,`bun src/server.ts` 能起并服务 `/api/*`。

切换不需改前端:`web/vite.config` 代理 `→ :8099`,Bun server 默认也 `:8099`,所以切换 = **换进程**。

1. **对拍(金标)**:同一 campaign 分别跑 Python(`uvicorn dd_agent.api:app --port 8099`)和 TS(`bun src/server.ts`,临时 `PORT=8098`),各拿到 `report.json`,跑
   `bun engine-ts/scripts/report-parity.ts <py>/report.json <ts>/report.json`
   —— 它只比**结构**(顶层 key + findings/sources/references/databaseFacts 元素 shape + stats key),因为 LLM 内容本就 run-to-run 变。shape 一致即 parity。
2. **切换**:停 Python `uvicorn:8099` → 起 `PORT=8099 DD_DB=… DD_ARTIFACTS=… bun engine-ts/src/server.ts`(沿用同一 `DD_DB`/`DD_ARTIFACTS`,sqlite/artifacts 兼容)。前端代理不动。
3. **回滚**:停 Bun → 起回 `uvicorn:8099`。两者读同一 sqlite/artifacts,可来回切。
4. **退役**:稳定运行后,Python 栈保留在 **`python-stack` 分支**(已存档);master 的 `src/dd_agent/` 可标 legacy 或移除(单独决策)。

> 未移植/后续:agent 详细 step-stream(`worker._emit_stream`,只影响 UI 的逐步卡片,不影响 report)、intake/chat/files 端点、资产层(`assets.py`)的 TS 版 —— 都是增量,不阻塞切换。

---
*附:本评估基于 master `b005cbe` 的代码盘点(20 模块 / 4088 行)。Phase 1–4 已落地;MCP + 资产 JSON 契约是迁移的稳定锚点。*
