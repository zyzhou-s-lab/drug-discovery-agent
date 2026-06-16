# Changelog

本项目所有重要变更都记录于此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.2](https://github.com/zyzhou-saffron/drug-discovery-agent/compare/v0.0.1...v0.0.2) (2026-06-16)


### Bug Fixes

* **ci:** bots must not end with open-ended "需要我帮你生成…吗" offers ([#15](https://github.com/zyzhou-saffron/drug-discovery-agent/issues/15)) ([b3cb7ff](https://github.com/zyzhou-saffron/drug-discovery-agent/commit/b3cb7ff53cb4f9c2469899b0b912d8d5eedfdca3))


### Documentation

* add CHANGELOG.md documenting Phase A (v0.0.1) ([#13](https://github.com/zyzhou-saffron/drug-discovery-agent/issues/13)) ([048f2b5](https://github.com/zyzhou-saffron/drug-discovery-agent/commit/048f2b533cfdaf41e9373f3cd16e230c863a654a))

## [Unreleased]

目前尚未发布带标签的正式版本。下方 `0.0.1` 汇总了 Phase A 开发期（2026-05-31 起）的全部工作。

## [0.0.1] - 2026-06-10

药物靶点发现 Agent harness（Phase A）。完整流水线：靶点发现 → 设计，配合深度研究引擎与可观测的 Web 前端。

### Added — 核心流水线

- 初始架构：药物靶点发现 agent harness、五阶段发现逻辑链（发现 → 文献证据 → 靶点筛选 → 验证 → 综合）。
- M0 骨架：零 API 的控制流（dummy worker）。
- M1：Agent SDK worker + 类型化 API judge + CLI（`--real` / `--only`）。
- OpenTargets GraphQL 客户端（仅依赖标准库），覆盖遗传学等检索角度。
- M2：stage-1 真实 scatter-gather（4 个角度，经 OT datatypes）。
- M3a：stage-2 文献证据 + 阶段间数据流。
- M3b：stage-3 靶点筛选（OpenTargets `target_profile`：tractability / constraint / safety / drugs）。
- M4a：stage-4 验证 —— planner + 动态 scatter + 加权 judge。
- stage-4 综合节点：加权裁决 + 冲突标记。
- stage-0：疾病概览 + 三层 fan-out。
- 疾病 intake gate（提交时校验疾病名），统一收敛到 `Runner.run` 单一入口。

### Added — 深度研究引擎（M1–M3）

- 深度研究 SDK 移植：Scope 阶段、独立页面、scope-only 流水线。
- M2 深度研究引擎：Search / Fetch / Verify / Synthesize 四阶段。
- M3：`source_type` 路由的 fetch，文献 / Web / 轻量数据库作为 agent 工具。
- 多来源检索 + DOI 引用 + APA7 参考文献（bibliography 来自已确认来源）。
- 中文叙述报告展现层 + 数据库原始记录 + 统一引用。
- StructuredOutput 校验 + 有界 nudge（对齐 Claude Code 的 `submit_*` schema 校验）。

### Added — Web 前端与可观测性

- M5 observer：读取 API（SSE）+ SDK 事件流 + Web UI（Vite 全栈）。
- 深度研究实时阶段进度面板；phase 行可折叠并作为 master-detail 选择器。
- 每个 agent 一张 session 卡片，展示 Prompt + Outcome + tokens（与 CC 对齐）。
- 运行重命名 / 删除、可调整大小的面板、右侧大纲、文件页。
- `/btw` 聊天面板（流式 + 持久化 + Markdown），聊天基于检索报告。
- 「重新检索」按钮：终态运行可携带 scope 角度重启。
- 协作式取消 / 停止：删除或停止运行会中断在途 agent。
- 通过 rehype-raw 支持 Markdown 中的原始 HTML 渲染。

### Added — CI 与机器人

- 在 PR 与 master 上运行 pytest 工作流。
- agentic PR review 工作流（Claude Code / MiMo + gh 工具）。
- mention 响应机器人（`@zyzhou` 召唤），可读取 PR 评论线程作为上下文。
- issue 自动响应机器人。

### Changed

- master 仅保留深度研究流程，移除旧的 discovery 流程与 disease-overview judge。
- judge 经由 `claude -p`（SDK 会话 + `submit_verdict` 工具）实现类型化输出；LLM judge 前增加确定性 gate（格式 / 完整性校验，零 API 成本）。
- CI 工作流与提示词文件名去除模型品牌标识。

### Fixed

- intake gate 在 `Runner.run` 内执行，修复 web/api 运行绕过仅 CLI gate 的问题。
- 文献工具网络超时不再抛错，避免 agent 死循环。
- 停止运行时硬取消在途搜索 agent；自愈孤立的搜索状态。
- 论文摘要经 Semantic Scholar 回退获取；限制工具调用次数以加速搜索 agent。
- 修正 OpenTargets 字段使用（移除 `knownDrugs`，从 tractability 推导 `has_known_drug`）。
- 多处前端状态修复（终止运行显示「已中断」、空 phase 卡片、null 安全等）。

[Unreleased]: https://github.com/zyzhou-saffron/drug-discovery-agent/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/zyzhou-saffron/drug-discovery-agent/releases/tag/v0.0.1
