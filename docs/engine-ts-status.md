# engine-ts 现状（TS/bun 引擎 cutover）

> 🟢 **STATUS：CURRENT（单一真相：当前栈状态）** · as-of 2026-06-24 · stack: **TS/bun（迁移目标）+ Python（仍在线上）**
> 这是"现在到底在跑什么、迁到哪了"的权威页。设计哲学见 [CONCEPTS.md](CONCEPTS.md)，蓝图见 [ARCHITECTURE.md](ARCHITECTURE.md) §0.5，迁移评估见 [bun-migration-eval.md](bun-migration-eval.md)，被迁阶段的设计源见 [deep-research-port-plan.md](deep-research-port-plan.md)。

---

## 一句话现状

编排核心正从 **Python（`src/dd_agent/`）** 重写为 **TS/bun（`engine-ts/`）**；科学计算继续留 Python，藏在 MCP 工具后面。引擎↔计算的契约已是语言无关 JSON，所以引擎可换语言。**当前线上真正只跑一个阶段**：`disease-overview`（deep-research：scope → search → fetch → verify → synthesize）。8 阶段发现→设计全流水线是蓝图，其 Python 实现归档在 `legacy-discovery-pipeline` 分支。

## 部署现实（务必分清"代码"与"线上"）

| | 状态 |
|---|---|
| **engine-ts 代码** | ✅ 已并入 `master`（cutover phase 3a/3b/3c + circuit-breaker #49）；每个模块有完整 `*.test.ts` |
| **线上 8099** | ⚠️ **仍是 Python** `uvicorn dd_agent.api:app`（gpu pid 自 Jun20）——engine-ts **尚未上线** |
| **gpu 上 engine-ts 可跑吗** | ❌ 暂不可：`engine-ts/node_modules` 未装、`bun` 未上 PATH（Jun24 有人正在装 bun + `bun install`） |
| **web 前端 :5173** | ✅ 不变（React/Vite，经 `/api` 代理到 8099；TS API 与 Python API 路由/形状保持 byte 兼容，故前端不用改） |

> 结论：**"current = TS" 指代码已在 master，不是线上已切换。** 切换动作 = 在 gpu 装 bun + `bun install` + 用 `bun engine-ts/src/server.ts` 顶替 8099 的 uvicorn，并跑 `parity.ts` 对拍。

## Python → TS 端口映射（按代码内 `Phase-X TS port of …` 注释）

| engine-ts/src | ← Python `src/dd_agent/` | Phase | 角色 |
|---|---|---|---|
| `schemas.ts`（**zod**） | `schemas.py`（pydantic） | 1 | 类型契约；zod 取代 pydantic |
| `core.ts` | deep-research 纯逻辑 | 1 | 1:1 纯函数核 |
| `store.ts`（**bun:sqlite**） | `index.py`（sqlite3） | 2 | Index = SQLite(WAL) 状态 + 内容寻址产物存储 |
| `events.ts` | `events.py` | 2 | per-stage JSONL 事件日志（`emit()`） |
| `orchestrate.ts` | `orchestrate.py` `run_agent` | 3 | **唯一的"装箱 forced-tool agent"原语**（fresh context + 强制 `submit_*` 结构化产出） |
| `scope.ts` | `scope.py` | 3b | deep-research stage-0 Scope：疾病分解为角度 |
| `litmcp.ts` | `deep_research.py` `_lit_server` | 3b | in-process MCP，暴露文献工具 |
| `deep_research.ts` | `deep_research.py` `research()` | 3c | 五阶段引擎 Search→Fetch→Verify→Synthesize |
| `intake.ts` | `intake.py` | — | 疾病输入校验门（gate + forced-tool typed） |
| `app.ts`（**Hono**） | `api.py`（FastAPI） | 4 | HTTP API + SSE（路由/形状与 Python 兼容） |
| `config.ts` | `api.py` 设置 | 4b | 用户可配置项（设置页，写入 ANTHROPIC_* env） |
| `server.ts` | — | 4c | 服务入口：先 apply 持久化设置再起 app |
| `run.ts` | `api.py` `_run_search` | 4c | 后台 Search runner（= 确定性 Runner 那一层） |
| `present.ts` | `api.py` `_present_report` | 5 | 把结构化结果转叙述报告 |
| `parity.ts` | — | 5 | cutover 对拍：Python vs TS 报告的结构化 diff |
| `assets.ts` | `research/assets.py` | — | per-campaign 结构化资产投影（CQRS 读模型） |
| `llm.ts` | （judge/旁路直连） | — | 非 agent 的 Messages 直连（旁路对话 / intake 翻译） |
| `tools/opentargets.ts`, `tools/paperfetch.ts` | `tools/` | — | 领域工具（OpenTargets / 文献） |

## 关键设计：保留了什么 / 变了什么

**保留（语言无关，不变）：**
- **三层结构**：`run.ts` = 确定性 Runner；`orchestrate.runAgent` 跑的每个 session = 装箱节点；`store.ts`+`events.ts`+`assets.ts`+artifacts = INDEX/CQRS 读模型。
- **gate + forced-tool + typed output**：`submit_*` 强制工具产出在 `orchestrate/scope/intake/deep_research` 全部保留（这是 [CONCEPTS](CONCEPTS.md) 的"LLM 出 typed struct"统一形态）。
- **provider 注入**：`llm.ts`/`config.ts` 走 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`（+ `DD_JUDGE_BASE_URL/MODEL` 覆盖），**只用 AUTH_TOKEN、不用 ANTHROPIC_API_KEY** → 兼容 DeepSeek/Kimi/mimo 等 Anthropic-compat 后端。spike 已验证非 Anthropic 后端能驱动 forced-tool。

**变了（实现层）：**
- pydantic → **zod**；sqlite3 → **bun:sqlite**；FastAPI/uvicorn → **Hono**；Python `claude_agent_sdk` → **`@anthropic-ai/claude-agent-sdk`(TS)**。
- 取消跨进程 daemon 线程的合作式取消，改用 TS 的 **AbortController**（比 Python daemon-thread 干净）。

## 判官（judge）现状 —— 解决文档里的自相矛盾

历史文档（[history/DETAILED-DESIGN.md](history/DETAILED-DESIGN.md) §4 raw API vs §13 `claude -p`）对 judge 形态有矛盾，原因是它描述的是 **Phase A 发现段**那套带独立 judge 节点的流水线（最终结论：`claude -p` + `submit_verdict`，agentic 形态更稳，std≈0.025）。

**当前线上 deep-research 流没有独立 judge 节点**——其验证是 `deep_research.ts` 内联的 **Verify「3 票对抗」**阶段。发现段的独立 `claude -p` judge 随 stage 1–4 一起在 `legacy-discovery-pipeline` 分支；将来在 TS 上重建发现段时，按"gate + claude -p + submit_verdict"那套结论重做。

## cutover 剩余 + 下一步

1. **gpu 部署**：装 bun → `cd engine-ts && bun install` → `bun src/server.ts` 顶替 8099 的 uvicorn（先并存对拍）。
2. **对拍**：`parity.ts` 对同一疾病跑 Python vs TS，做报告结构化 diff（golden-master）。
3. **切流量**：nginx/web 的 `/api` 指向 TS 8099；保留 Python 一段时间可回滚。
4. **之后**：发现段（stage 1–4）从 legacy 分支按本页结论在 TS 上重建；Phase B 设计段仍阻塞于 qiaoy1 工具访问（见 [DOMAIN.md](DOMAIN.md) §6）。
