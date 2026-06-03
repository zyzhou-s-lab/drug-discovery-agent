# deep-research → SDK 复写计划(stage-0 disease-overview,可复用引擎)

> 目标:把 Claude Code 内置的 **deep-research Workflow** 的编排逻辑,用 **claude-agent-sdk** 在 dd-agent 自有栈(gpu / DeepSeek)上**复写成一个参数化引擎**,首个实例 = `disease-overview`(stage-0),并预留 nomination / validation 复用。
>
> 蓝本(逐字参考):落盘脚本 `…/workflows/scripts/deep-research-wf_*.js`(五阶段 prompt/schema/编排/去重/计票全在内)。SDK 范例 = 本仓库 `worker.py`(`_run_session` + `_*_server` forced 工具)、`judge.py`(consensus)、`events.py`(`emit`)。
>
> 状态:**规格基本锁定**;Scope prompt 已定稿;其余 4 prompt 改动已审;最后开 M1。本页为该工作的单一真相。

---

## 0. 关键调研结论(已实测,决定路线)

| 问题 | 结论(实测) |
|---|---|
| SDK / `claude -p` headless 有没有 `Workflow` 引擎? | **没有**(工具清单实测确认)。`Workflow` 只在交互式/HAPI 会话暴露,pipeline 程序化拿不到 |
| WebSearch / WebFetch 在 SDK + DeepSeek 能用吗? | **能**(实测:`websearch_call:true`,返回正确结果)。是 harness 侧实现,不依赖 Anthropic API |
| 单个 forced-tool 在 DeepSeek 能用吗? | **能**(`submit_verdict`/`submit_result` 已在用) |
| deep-research 那次为什么垮? | **不是 quota 直接停的根因**:① web agent 同时带 forced StructuredOutput + WebSearch,WebSearch 自带"末尾列 Sources"约定盖过强制输出 → 散文收尾 → 每 agent nudge 2 次重试 → token 暴涨;② 重试风暴把 **5 小时会话用量顶到 100%** → 触发 session limit 硬停(手机截图证实)。两者是一条因果链 |

**推论**:不能搬 Workflow 引擎,只能用 SDK 复写**它被用到的少数原语**(`agent({schema})`/`parallel`/`pipeline`/`phase`/`log` + budget);TUI / resume / 通用脚本加载器**不需要**。复写量 ≈ 数十行 asyncio 胶水 + 你已有的 `_run_session`/`emit`/judge。

---

## 1. 架构:参数化引擎 + 多 stage 实例

deep-research 的 `scatter → 整合 → 对抗式 verify` 与 `DOMAIN.md` 的 stage-1(提名,scatter-gather)、stage-4(验证,scatter-gather + verify)**是同一架构**。故引擎做成**参数化**,一次投入多处复用:

```
orchestrate.py   迷你引擎:_agent() + gather_capped() + Budget(参数:angles/schemas/data_sources/output_shape)
deep_research.py 编排:scope() + research(angles)(port .js body + 纯逻辑)
schemas.py       pydantic: Angle / SearchResult / Claim / Verdict / Report(+ 复用 TargetCandidate)
```

| 实例 | 角度(Scope) | Fetch 抽取 schema | 输出 schema | 排序骨架 |
|---|---|---|---|---|
| **overview(stage-0,先做)** | 疾病特征 6 角度(见 §5) | 通用 claim | prose 报告(REPORT) | vote confidence |
| nomination(stage-1,复用) | 靶点证据轴(遗传/表达/网络/功能/文献) | 靶点 claim{gene,kind,score} | 排序 `TargetCandidate[]` | **OpenTargets association score 为主**,verify 作验证层 |
| validation(stage-4,复用) | 验证角度 | 验证 claim | 验证结论 | 加权/冲突 |

> nomination caveat:**别用票数置信替代 OpenTargets 打分**;OT 直接给排序靶点,deep-research 的增量是"文献/web 证据挖掘 + 对抗式验证",不是重做 OT 排序。

---

## 2. 锁定的决策

1. **工具策略 = B(加法)**:每个 agent = **默认全工具集 + 额外加的 MCP 工具**(`submit_X` + 相关 OT/paperfetch),**不设收窄 allowed_tools**。连带:scope 也带 web(默认里,但 prompt 不喊它用)。
2. **结构常量写死(严格对齐 .js)**:`MAX_FETCH=15(全局共享)` `VOTES_PER_CLAIM=3` `REFUTATIONS_REQUIRED=2` `MAX_VERIFY_CLAIMS=25`;search 结果 maxItems 6、claims/源 maxItems 5。无 env。
3. **Verify 照抄**:对抗式 3 票,prompt + 计票逻辑逐字直译(只改收尾为 `submit_verdict`)。
4. **三数据源**(唯一有意偏离 .js 的纯 URL 管线):WebSearch + OpenTargets + paperfetch;search 的 results 容纳 `url|doi|efo_id` + `source_type`,fetch 按类型分流。
5. **Budget 与 .js 对齐**:.js **无 token budget**(靠结构常量约束)。故默认**无上限**,但**永远统计**(by_phase in/out/cache/usd/calls,从每个 `query()` 的 `ResultMessage.usage`/`total_cost_usd`);`DD_DR_BUDGET` 可选设熔断阈值 → 触发 .js 已有的 salvage 分支。
6. **Scope-checkpoint(人审角度)**:Scope 跑完**暂停**,UI 展示 angles 供审/增删/批准,批准后再跑 `research(angles)`。开关 `DD_DR_REVIEW`:交互默认暂停;无人值守自动用 LLM 角度继续(不卡 cron)。
7. **引擎参数化**:`research(angles, schemas, data_sources, output_shape)`,供 overview/nomination/validation 复用。

---

## 3. 编排保真规格(对齐 .js 审计)

| 维度 | .js 行为 | 复写要点 |
|---|---|---|
| LLM 决定维度(Scope) | LLM 拆 3–6 角度({label,query,rationale}),prompt 带领域示例 | Scope prompt 定稿(§5,疾病专用 6 角度);schema 原样 minItems3/maxItems6 |
| 子 agent prompt | 全指令在单 prompt 字符串,函数插值上游字段;无自定义 system | verbatim prompt 当 user prompt;system 最小;收尾改 `Call submit_X` |
| 上下文控制 | 每 agent 全新隔离,只拿 orchestrator 插的字段;Synth 拿拼好的 confirmed+killed block | 每个 `_agent` = 独立 `query()`,不跨 agent/不续会话 |
| **每阶段 fan-out** | Scope **1**;Search **=angles(3–6)**;Fetch **≤15(全局 fetchSlots,pipeline 无屏障)**;Verify **=claims(≤25)×3(barrier)**;Synth **1** | 见 §4 的 `angle_chain` 写法 |
| 并发 | min(16, cores-2) | `asyncio.Semaphore(DD_DR_CONC, 默认 6)`,注意 DeepSeek 限流 |
| 去重/排序 | normURL/seen/fetchSlots/budgetDropped/relRank | 纯 Python 直译 |
| claim 排序 | impRank/qualRank → slice 25 | 直译 |
| 投票存活 | 有效票≥2 且 refuted<2,**处理弃权** | 直译(勿漏弃权) |
| salvage | 无 claim / 全 refuted / synth skip | 直译 |
| schema | SCOPE/SEARCH/EXTRACT/VERDICT/REPORT + maxItems | 作 forced-tool 输入 schema 直译 |

**最坏 fan-out** = `1 + 6 + 15 + 25×3 + 1 ≈ 98` agent(= .js `agentCalls`)。

---

## 4. 关键实现骨架

### 4.1 `_agent`(= `agent({schema})`,基于 `_run_session`)
```python
async def _agent(phase, prompt, submit_name, schema, extra_mcp, budget, sem):
    if budget.exhausted(): return None
    cap = {}
    @tool(submit_name, "Submit structured result. Call exactly once.", schema)
    async def _submit(args): cap["v"]=args; return {"content":[{"type":"text","text":"ok"}]}
    servers = {"o": create_sdk_mcp_server("o","1.0",[_submit]), **extra_mcp}   # 加法:默认工具 + 这些 mcp
    opts = ClaudeAgentOptions(mcp_servers=servers, permission_mode="bypassPermissions", max_turns=12)
    # 注意:不设收窄 allowed_tools(保留默认工具集);M1 验证 SDK 在此配置下默认工具+mcp 工具都在
    async with sem:
        async for msg in query(prompt=prompt, options=opts):
            if type(msg).__name__=="ResultMessage":
                budget.add(phase, getattr(msg,"usage",{}) or {}, getattr(msg,"total_cost_usd",0))
        emit("deep-research", phase, "agent_done", spent=budget.spent())
    return cap.get("v")
```

### 4.2 pipeline(search→fetch 无屏障)——`angle_chain`,**不是两道 gather**
```python
seen, slots, lock = {}, [MAX_FETCH], asyncio.Lock()
async def angle_chain(angle):
    sr = await _agent("search", SEARCH_PROMPT(angle), "submit_results", SEARCH_SCHEMA, SRC_MCP, budget, sem)
    if not sr: return []
    async with lock:
        novel = dedup(sr["results"], seen, slots)         # normURL/relRank/fetchSlots 直译
    return [f for f in await asyncio.gather(
        *[_agent("fetch", FETCH_PROMPT(src,angle), "submit_claims", EXTRACT_SCHEMA, SRC_MCP, budget, sem)
          for src in novel]) if f]

per_angle = await asyncio.gather(*[angle_chain(a) for a in angles])   # pipeline:链间并发;唯一屏障在此
claims = rank_claims([c for ch in per_angle for s in ch for c in s["claims"]])[:MAX_VERIFY_CLAIMS]

# Verify:barrier(claim 池建好后)
voted = await asyncio.gather(*[
    asyncio.gather(*[_agent("verify", VERIFY_PROMPT(c,v), "submit_verdict", VERDICT_SCHEMA, {}, budget, sem)
                     for v in range(VOTES_PER_CLAIM)]) for c in claims])
confirmed = [c for c,vs in zip(claims,voted) if survives(vs)]   # 有效票≥2 且 refuted<2,处理弃权
```

### 4.3 Budget
```python
class Budget:
    def __init__(self, total_tokens=None): self.total_tokens=total_tokens; self.by_phase={}
    def add(self, phase, usage, usd):
        b=self.by_phase.setdefault(phase, {"in":0,"out":0,"cache":0,"usd":0.0,"calls":0})
        b["in"]+=usage.get("input_tokens",0); b["out"]+=usage.get("output_tokens",0)
        b["cache"]+=usage.get("cache_read_input_tokens",0); b["usd"]+=usd or 0; b["calls"]+=1
    def spent(self): return sum(p["in"]+p["out"] for p in self.by_phase.values())
    def exhausted(self): return bool(self.total_tokens) and self.spent()>=self.total_tokens
    def report(self): return {"spent_tokens":self.spent(), "by_phase":self.by_phase}
```

---

## 5. Scope prompt(定稿)+ schema

**职责**:疾病 → 特征刻画角度(背景,**非靶点提名**——提名是 stage-1)。工具 = 默认 + `submit_angles`(加法,web 不用)。

```
Decompose this disease into complementary research angles for a DISEASE-OVERVIEW brief
that will focus downstream drug-target discovery. This is BACKGROUND CHARACTERIZATION of
the disease — NOT target nomination or scoring.

## Disease
{QUESTION}

## Task
Generate distinct, high-signal search queries that together characterize the disease from
these complementary angles. Cover every angle that applies; merge or drop one only if it is
clearly irrelevant for this disease:
1. Disease definition, subtypes & clinical classification
2. Affected tissues, cell types & key anatomy
3. Core pathological mechanisms (molecular & cellular)
4. Genetic architecture & key risk genes (GWAS / rare & LoF / Mendelian) — the strongest target prior
5. Dysregulated pathways & gene families
6. Current therapeutics, known targets & clinical-trial landscape (background only)

For each angle: a `label`, a specific `query` (suited to web search + biomedical databases),
and a 1-2 sentence `rationale` for why it matters to target discovery. Avoid redundancy.

Return: the disease (verbatim or lightly normalized), a 1-2 sentence decomposition strategy,
and the angles. Call `submit_angles` exactly once with {question, summary, angles};
that is your only output (no prose answer, no Sources list).
```
SCOPE_SCHEMA(原样):`{question, summary, angles[{label, query, rationale?}]}`,angles minItems3/maxItems6。
> 角度依据:`discovery-logic-chain.md`(遗传是最强先验,Nelson 2015/Minikel 2024)→ 比原 5 多列遗传学;有 Scope-checkpoint 后这 6 个是**种子提议**,人审时补全。

---

## 6. 其余 4 prompt 的改动(已审,定稿见蓝本 + 下列 delta)

- **Search**(L128–135):任务句加三源(WebSearch + `mcp__opentargets__search_disease` + `mcp__paperfetch__search_literature_multi`),results 加 `source_type`;收尾 → `Call submit_results … no prose / no Sources`。
- **Fetch**(L137–149):按 `source_type` 分流(web→WebFetch / paper→paperfetch / opentargets→OT);收尾 → `Call submit_claims …`。
- **Verify**(L151–166):**逐字照抄**,仅收尾 → `Call submit_verdict (refuted,evidence,confidence); evidence MUST be specific; no prose`。(checklist 第2步是否扩成 WebSearch/paperfetch/OT 找反证 = **待定**,默认保持照抄)
- **Synthesize**(L304–315):**逐字照抄**(6 条 instructions,勿漏 caveats),收尾 → `Call submit_report {summary,findings,caveats,openQuestions}`。

---

## 7. 里程碑(含 scope-checkpoint)

- **M1 = scope-only + 人审闸**:`scope()` 产 angles + Budget 统计 + `emit`/落库 + 前端展示 angles + "批准并继续"。**重点验**:① "默认+加法"工具在 SDK 生效;② search 带 WebSearch + 调 submit 时**不 prose-ending**(整移植最大单点风险,用一个 search agent 先验);③ budget 统计正确;④ 暂停/批准闭环。
- **M2**:`research(angles)` 全五阶段(`angle_chain` pipeline + 照抄 verify + synth),`DD_DR_BUDGET=50k` 熔断测试。
- **M3**:接成 stage-0 `_deep_overview_worker`(NodeOutput:summary=报告;literature DOI→evidence + APA7 书目);`DD_STAGE0=deep|simple` 灰度开关。
- **M4**:dry AMD 端到端 + token 报告,校准推荐 `DD_DR_BUDGET`(预期 0.8–1.5M/病);与 simple stage-0 对比质量/成本。
- **(后续)**:nomination 实例(§1 配置)+ validation 实例。

---

## 8. 风险 / 待定

**风险**
1. **prose-ending 在 DeepSeek 重现**:web agent + 要调 submit_X,弱模型可能散文收尾。缓解:prompt 硬写"唯一收尾动作是 submit_X,不要散文/Sources"。**M1 必先验掉**。
2. **SDK "默认+加法"机制**:确认"只加 mcp_servers、不设 allowed_tools"时默认工具 + mcp 工具都在(否则改成 allowed=默认名单+mcp名)。M1 验。
3. **quota**:全跑重(~98 agent);无人值守务必设 `DD_DR_BUDGET` 熔断,避免重演"顶爆 5 小时会话上限"。

**待定(开 M1 前可不阻塞)**
- Scope 6 角度最终确认(背景版 vs 纯描述 4 角度);角度固定 6 还是弹性 3–6。
- Verify 第2步是否扩三源找反证。
- nomination 实例的 schema 细节(留到复用时定)。

---

## 9. 文件落点
```
src/dd_agent/research/{orchestrate,deep_research,schemas}.py   (新)
src/dd_agent/worker.py  +_deep_overview_worker;pipeline.py DD_STAGE0 开关
前端:angles 审阅控件(复用 events/SSE/StepCards + stage 详情页)
tests/test_deep_research.py(纯逻辑 dedup/rank/survives 单测)
```
