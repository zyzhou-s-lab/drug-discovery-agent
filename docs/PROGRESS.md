# 进度记录（Progress Timeline）

> drug-discovery-agent harness 的里程碑流水，按完成时间排列。设计决策的细节见各
> `docs/*.md`（CONCEPTS / ARCHITECTURE / DOMAIN / DETAILED-DESIGN / phase-a-plan），
> 本页只做"何时完成了什么 + 对应 commit"的索引。
>
> **运行后端**：worker = Claude Agent SDK（in-process MCP 工具），judge = Messages API
> forced-tool 结构化输出；在 gpu-zhouy1 上经 **DeepSeek Anthropic 兼容层**运行
> （`base_url=api.deepseek.com/anthropic`, `model=deepseek-chat`）。DeepSeek 兼容层成功
> 驱动了 Agent SDK 的工具循环与 forced-tool 结构化输出。

## 设计期（2026-05-30 → 05-31）
三层架构（确定性 Runner + boxed agent 节点 + index + 只读 observer）、执行器选型、
PL 设计哲学在对话中确定，落入 `docs/{CONCEPTS,ARCHITECTURE,DETAILED-DESIGN}.md`。

| 时间 | 里程碑 | commit |
|---|---|---|
| 05-31 13:04 | 初始设计：harness 方案入私有 repo | `5ebd731` |
| 05-31 19:19 | 吸收 agent-architecture-manifesto | `c8c7a73` |
| 05-31 19:59 | 领域锚定 dry-AMD→ROCK→ripasudil + refs 集中 | `0cdd247` |
| 05-31 20:38 | scope 扩为「发现→设计」全链路 | `ef69a9a` |
| 05-31 21:14 | 发现段调研：靶点发现逻辑链 + 集群数据调研 | `b5a01e6` |
| 05-31 22:23 | 加 `target-validation` 阶段（8 阶段） | `aa28055` |
| 05-31 22:47 | 验证 = scatter-gather + 节点/工具粒度原则 | `a80d982` |
| 05-31 23:07 | 同角度工具选择 + 消融判断 | `fa03836` |
| 06-01 01:42 | 整体架构图（ARCHITECTURE §0） | `9375bb7` |
| 06-01 02:12 | 持久化/恢复（§3.8：CC 边界 + Runner durable 责任） | `da4f280` |
| 06-01 04:08 | coder-loop 审计：采纳 SQLite + daemon-watchdog 参考实现 | `aa6f437` |

## 实现期 — Phase A（2026-06-01）

| 时间 | 里程碑 | 验证结果 | commit |
|---|---|---|---|
| 04:26 | **M0** 控制流骨架（dummy，零 API）：状态机 + 断点续 + scatter-gather + SQLite/artifact 分离 | ✅ gpu 验证：stage 1-4 全 done、resume 跳过、scatter 聚合 | `fd8c2d0` |
| 04:51 | 文档：§3.7(D) 工具调用决策归属（菜单 by harness / 调用 by model） | — | `086390c` |
| 04:59 | **M1** stage-1 单角度真实：OpenTargets MCP + Agent SDK worker + typed judge | ✅ dry-AMD 出补体 C3/CFH，judge 校准 | `f771630` `7d966e5` |
| 05:29 | **M2** stage-1 scatter：4 角度并行 fan-out → 确定性去重合并 | ✅ 11 候选、补体多角度命中，judge 0.9 | `967af92` `55207c0` |
| 05:43 | **M3a** stage 间数据流 + stage-2 文献证据（Europe PMC 真实 PMID） | ✅ 10 候选附真 PMID，judge 0.85（含修 `--only` bug） | `7f705a1` `d6311f3` |
| 06:12 | **M3b** stage-3 选定（OT `target_profile` 三联评估：可成药性/约束/安全） | ✅ C3=Top、CFH=biologic（modality 分支）、HTRA1=次选，judge 0.85 | `5362829` `1daa27f` `c3b1bb8` |
| 07:xx | **M4a** stage-4 验证（planner 动态选角度 + 动态 scatter + 加权/冲突 judge） | ✅ C3/CFH/HTRA1 各 genetic+safety，judge 0.45 显式标注 C3 safety 冲突 | `871e2c2` `791b4ef` |
| 07:xx | **M5 observer**（HAPI 并行）：Index 上 CQRS 只读 API + SSE + SDK 事件流 + web 前端 | 合并入主线（与 M4a 正交零冲突）→ **联调跑通**：api serve 真实 m3（含 stage-4）+ events 流（110 events）+ vite :5173 全栈通；浏览器 `http://10.202.2.224:5173` | `cfa49d0` `0838edf` |
| 06-02 | **stage-0** disease-overview（split-and-merge 疾病 brief 喂下游聚焦）+ **judge 终态**（C2 脚本 gate + claude -p `submit_verdict` typed + consensus + score 阈值；判语义、禁内置工具） | ✅ stage-0 judge 0.97；claude -p judge std 0.025（vs raw ~0.2） | （见 §3.4） |
| 06-02 | literature judge 三层修复：精简 input / `max_turns` 25 / `disallowed_tools` 禁越权 PubMed 核查 | ✅ 0.25→0.75；judge 不再误判真 EuropePMC PMID（2026 新文献 PubMed 未收录） | `92c5e4c` `b40ab03` `722982f` |
| 06-02 | **stage-4 synthesis 节点**（union 后加权裁决+冲突标注，补"缺综合判定"缺口）→ **完整 5-stage 链端到端 1 次跑通** | ✅ stage-4 exhausted 3/3 → 1 次过 0.80；**裁决**：C3/HTRA1 PASS、C9 WEAK、C5/CFD FAIL（genetic=0，标 CONFLICT；正确区分"药理 vs 遗传验证"） | `fc5fef0` |

**完整发现段 stage 0-4 端到端 1 次连跑通**（2026-06-02）：`dry AMD` → 疾病 brief(stage-0) → 提名(scatter 4 角度) → 文献(真 PMID) → 三联评估选定 → 多角度验证 + **synthesis 加权裁决**。最终推进：**C3、HTRA1（PASS）**；C9（WEAK）；C5、CFD（遗传信号空→FAIL，虽有药理先例 Izervay/danicopan）。

## 待办
- **M4b**：stage-4 接重型本地工具（FUSION TWAS / GRN_transfer in-silico KO / coloc / MR）+ 独立源（GWAS Catalog / GTEx / STRING）+ **stage-1 planner 回填**（§3.7 E）；菜单扩 perturbation/expression/network。性质转变：在线 API → gpu/cpu 本地重型计算，可能上 slurm + durable (a) 层。
- **M3 剩余**：stage-1 独立证据源（GTEx / STRING）给 expression/network 角度——延后，不阻塞（M2 实测暴露 OT datatype 在这两个角度对遗传驱动病空转）。
- **Phase B 设计段**：结构(AlphaFold3) → 分子设计/对接(Vina) → 模拟(GROMACS) → 报告；gated on qiaoy1 工具访问（凭据已具备）。

（**M5 observer 已联调跑通**，见上方时间线；Phase A 发现段 M0–M4a + observer M5 全部完成。）
