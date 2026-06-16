# deep-research → SDK 复写计划(stage-0 disease-overview,可复用引擎)

> 目标:把 Claude Code 内置的 **deep-research Workflow** 的编排逻辑,用 **claude-agent-sdk** 在 dd-agent 自有栈(gpu / DeepSeek)上**复写成一个参数化引擎**,首个实例 = `disease-overview`(stage-0),并预留 nomination / validation 复用。
>
> 蓝本(逐字参考):落盘脚本 `…/workflows/scripts/deep-research-wf_*.js`(五阶段 prompt/schema/编排/去重/计票全在内)。SDK 范例 = 本仓库 `worker.py`(`_run_session` + `_*_server` forced 工具)、`judge.py`(consensus)、`events.py`(`emit`)。
>
> 状态(2026-06):**M1(scope + 人审闸按钮)、M2(五阶段引擎,web-only)已完成并实测**;**M3(文献 + web + 轻量 DB 证据简报 + APA7 书目)规格已定**(见 §7/§10)。阶段边界按**工作性质**重定(§10):排序级 OT 分数归 nomination、数据集计算归 compute,均不在本步。本页为该工作的单一真相。

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
4. **数据源(2026-06 重定:见 §10)**:这一步 = **文献 + web + 轻量数据库/本体**背景挖掘。`source_type ∈ {web, paper, database}`,fetch 按类型分流。**OpenTargets 排序分数、数据集下载/计算不在本步**(见 §10 的工作性质划分)。文献检索做成 **agent 可调的 MCP 工具**(`search_literature`/`get_paper`,加法注入);DB/本体靠 agent 用 WebFetch 打 API(OLS4 等),prompt 显式邀请 + 护栏。
5. **Budget 与 .js 对齐**:.js **无 token budget**(靠结构常量约束)。故默认**无上限**,但**永远统计**(by_phase in/out/cache/usd/calls,从每个 `query()` 的 `ResultMessage.usage`/`total_cost_usd`)。**实测成本锚点**:真实 AD 全量跑 = **109 agent / 3.7M token / 92 min**(5 角度→27 源→134 claim→25 验证→17 存活)。故 `DD_DR_BUDGET` 熔断 + 并发上限(`DD_DR_CONC` 默认 6)**M3 必须配好**,严禁无人值守裸跑。
6. **Scope-checkpoint = 「开始检索」按钮(已实现,M3 前置)**:Scope 自动跑完 → UI 展示方向供审/增删 → 用户点「开始检索」才触发 `research(angles)`。**已取代**"scope 后自动跑 research"那条路径;worker 的 `DD_STAGE0=deep` 自动路径作废。后端 `POST /campaigns/{c}/search` + `GET /report`,复用 events 流(stage 标 `deep-research`)。
7. **引擎参数化**:`research(angles, ...)`,供 overview/nomination/validation 复用(nomination/validation 是不同**工作性质**,见 §10)。
8. **强制结构化输出 = `submit_*` 工具,不用 `output_format`(2026-06 实测)**:SDK 的 `output_format={"type":"json_schema"}`(透传 `--json-schema`)在 **DeepSeek 上不生效**——后端收下标志但不执行,agent 散文+Sources 收尾(实测 13 次 WebSearch/15 轮、JSON parse 失败)。故所有阶段沿用 in-process MCP `submit_*` 工具(function calling,DeepSeek 原生支持)+ prompt 缓解语收尾。

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
4. Genetic architecture & heritability (risk loci to be identified by search) — the strongest target prior
5. Dysregulated pathways & gene families
6. Therapeutic landscape & clinical-trial status

For each angle: a `label`, a `query`, and a 1-2 sentence `rationale` for why it matters to
target discovery. Avoid redundancy.

Write each `query` as a SEARCH GOAL — describe WHAT to find (specific about DIMENSION and
METHODS: GWAS / rare & LoF / single-cell / pathway enrichment / approved drugs & trials).
Do NOT pre-name specific genes, proteins, or drugs from prior knowledge — discovering those
is the downstream search's job; pre-baking unverified names anchors the search and isn't traceable.

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

- **M1 = scope-only + 人审闸**:✅ 完成。`scope()` 产 angles + Budget 统计 + `emit`/落库 + 前端展示 angles + 用户自定义角度。`setting_sources=[]` 隔离 host CLAUDE.md(gpu MemOS 块)。
- **M2 = `research(angles)` 全五阶段**:✅ 完成(`src/dd_agent/research/{orchestrate,deep_research}.py`)。`angle_chain` pipeline(search→dedup→fetch,无屏障)+ 25-claim 3 票对抗 verify(barrier)+ synth;schema/prompt/去重/排序/计票逐字移植;forced StructuredOutput 用"submit_* 为唯一收尾动作"替代。
  - **关键风险已排除**(plan §8.1):search agent 在 DeepSeek 上 WebSearch ×5 → 调 `submit_results` ×1,**不 prose-ending**(实测,~32k tok)。
  - **错误兜底**:agent 撞 max_turns / 跑飞 → `run_agent` 捕获返回 None(fetch 丢源 / verify 弃权,`survives()` 处理)。
  - **端到端实测**(ALS,2 角度,fetch_budget=3,max_verify_claims=6):search→fetch(4 源/19 claims)→verify(6→确认 3/否决 3,含 1 弃权)→synth(3 条发现),agentCalls=26,质量高(真实 loci + 置信度 + 开放问题),弱 claim(NUP50)被对抗式否决 0-3。
  - **成本**(此受限run):verify 占大头(~514k tok / 18 calls);全量 25-claim 估 ~2M+ tok/病。`budget.report().usd` 是 DeepSeek 错价,只看 token。`DD_DR_CONC`(默认 6)控并发;`DD_DR_BUDGET` 熔断 + salvage 待 M3 接 worker 时一并验。
  - 测试:13 个离线单测(dedup/rank/survives/norm_url + happy-path/no-claims/all-refuted salvage,monkeypatch `run_agent`)。
  - **未做(留 M3)**:三源融合(OT+paperfetch,`extra_mcp` 钩子已留)、DD_DR_BUDGET 熔断实测、前端富步骤卡。
- **M3 = 文献 + web + 轻量 DB 证据简报(范围见 §10)**。前置已完成:scope-checkpoint「开始检索」按钮 + `POST /search` + `GET /report` + 前端 `DeepReportView`(findings/置信/来源/caveats/openQ/refuted/stats)。剩余分阶段:
  - **M3.1 文献 + DB 检索作为 agent 能力**:新增 in-process MCP `lit`(`search_literature` 包 paperfetch.search_literature_multi;`get_paper(doi)` 取 abstract),经 `extra_mcp` 注入 search/fetch agent(加法,默认 WebSearch/WebFetch 仍在)。SEARCH_PROMPT 加任务项:"用 WebSearch 找 web、search_literature 找论文、并主动检索权威 **数据库/本体** API(EFO/MONDO via OLS4、Ensembl/ClinVar/gnomAD、ClinicalTrials.gov),每条标 `source_type`"。**护栏**:DB 仅用于识别/分类/定性事实(ID、子型、基因角色),**禁止抓取或目测定量关联分数/靶点排序**(归 nomination)。
  - **M3.2 `source_type`/`doi` 贯穿**:SEARCH_SCHEMA results 加 `source_type ∈ {web,paper,database}`、paper 带 `doi`;EXTRACT 时 claim 挂 `source_type` + `sourceUrl`(web/db)或 `doi`(paper)。FETCH 三路分流:web→WebFetch;paper→get_paper(abstract);database→WebFetch 打 API URL 抽结构化事实(`sourceQuality=primary`,API URL/ID 作 quote)。
  - **M3.3 书目在最终输出生成**(纯 Python,复用 `cite_by_doi`):synth 后从 confirmed findings 收唯一来源,拆三段——`references`(DOI→APA7)、`webSources`(title+URL)、`dbSources`(DB 名 + 记录 URL/ID)。
  - **M3.4 前端**:`DeepReportView` 加「参考文献(APA7)/网络来源/数据库来源」三节(APA7 复用 `Bibliography`)。
  - **M3.5(延后)Verify 按源路由**:首版统一 3 票(AD 实测 OLS4 事实 3-0 通过,统一票不出错只多花 token);后续 DB 事实改"跳过/1 票 provenance",文献"1 票 quote-check",web/跨源综合"3 票对抗"。
  - **M3 必配**:✅ `DD_DR_BUDGET` 熔断(`api._budget_from_env` → `Budget(total_tokens)` 传入 `research()`,跳闸走 `exhausted()`→salvage;未设=无上限)+ `DD_DR_CONC` 并发上限(`research()` 默认 6)(成本锚点见 §2.5,真实 3.7M/病)。
- **M4**:dry AMD 端到端 + token 报告,校准推荐 `DD_DR_BUDGET`;评估简报质量/成本。
- **(后续)nomination / validation = 不同工作性质的独立阶段(见 §10)**:nomination = OpenTargets 结构化查询 + 排序(确定性,非对抗 verify)+ 在候选上补文献证据;validation = 数据集下载 + 计算(compute job,非文本 agent)。

---

## 8. 风险 / 待定

**风险(M1/M2 已验证)**
1. ~~prose-ending 在 DeepSeek 重现~~ → **已排除**:走 `submit_*` 工具 + prompt 缓解语,search agent 实测 WebSearch ×5 → 调 submit ×1、干净 JSON。注:`output_format` 那条替代路反而散文收尾(见 §2.8),所以不切。
2. ~~SDK "默认+加法"机制~~ → **已确认**:只加 `mcp_servers`、不设 `allowed_tools`,默认工具(WebSearch/WebFetch)+ MCP 工具都在。
3. **quota / 成本**:**仍是头号风险**。真实 3.7M token/病(§2.5);M3 必须 `DD_DR_BUDGET` 熔断 + `DD_DR_CONC` 限流,严禁无人值守裸跑。
4. **agent 自发抓 API 的不可靠性**:agent 会用 WebFetch 顺手打 DB API(AD 实测抓对了 OLS4)。轻量本体可接受,但**排序级 DB(OT 分数)靠 agent 目测不可靠** → 划到 nomination 专用工具(§10)。

**待定**
- Verify 第2步是否扩多源找反证(默认照抄,只 WebSearch)。
- M3.5 verify 按源路由的阈值(DB 跳过/1 票、文献 1 票、web 3 票)。
- nomination / validation 实例的具体 schema(复用时定)。

---

## 9. 文件落点
```
src/dd_agent/research/{orchestrate,deep_research}.py   (已建:run_agent + research 五阶段)
src/dd_agent/research/scope.py                          (已建:scope + setting_sources=[])
src/dd_agent/api.py   POST /campaigns/{c}/search · GET /report · _run_search(已建)
src/dd_agent/tools/paperfetch.py  search_literature_multi / cite_by_doi / format_apa7(已有)
前端 App.tsx  ScopeAngles(开始检索按钮)· DeepReportView · useReport(已建)
tests/test_deep_research.py  纯逻辑 + 编排 monkeypatch 单测(已建,13 个)
M3 新增:research/litsearch MCP(search_literature/get_paper);deep_research source_type 分流 + 书目三段
```

---

## 10. 工作性质划分(2026-06,决定阶段边界)

deep-research 这条管线的**工作单元 = 非结构化文本 → 抽可证伪 claim → 对抗核验 → 汇总**。它只对"文本性"工作有价值。按**工作性质**(不是按数据库种类)划分阶段,别把异质工作塞进一条管线:

| 工作性质 | 适合机制 | 归属阶段 |
|---|---|---|
| **非结构化文本**(文献全文/abstract、web 页面、综述) | 抽 claim + 对抗 verify | **overview(本步)** |
| **轻量数据库/本体查询**(EFO/MONDO ID、基因别名、子型;定性事实) | agent 用 WebFetch 打 API + verify;`source_type=database` | **overview(本步,带护栏)** |
| **排序级结构化 DB**(OpenTargets association score 等,排序权威) | 确定性专用工具直接查 + 数值保真,**非对抗 verify** | **nomination** |
| **数据集下载 + 计算分析**(Perturb-seq、跑 CIPHER/scGen) | 计算 job(可能 GPU),**非文本 agent** | **compute / validation** |

依据:
- agent **会**用 WebFetch 顺手抓 DB API(AD 实测拿到 EFO_0000249→MONDO_0004975、AD1–AD19,标 primary source、被 verify 3-0 确认)——所以"轻量本体"放本步是好事;
- 但 agent 撞 API 是**非确定性**的(可能找不到端点、拼错 URL、误读 JSON),**排序级分数**一旦读错整个提名就偏,故必须用专用工具(plan §1:"别用票数置信替代 OT 打分");
- 数据集计算根本不产生"可证伪文本 claim",溯源/对抗 verify 都不适用。

护栏(写进 SEARCH_PROMPT):本步 DB 仅用于**识别/分类/定性事实**,**禁止抓取或目测定量关联分数/靶点排序**。
