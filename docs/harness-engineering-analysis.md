# Harness Engineering 分析 & dda 现状对照

_基于 Lilian Weng《Harness Engineering for Self-Improvement》(2026-07-04, https://lilianweng.github.io/posts/2026-07-04-harness/),对照 drug-discovery-agent 的 harness 现状,标出缺口。生成于 2026-07-08。_

---

## 一、博客要点摘要

### 1. harness 的定义
不是经典的 "agent = LLM + memory + tools + planning + action",而是**围绕基座模型、决定它怎么思考/调工具/管上下文/存产物/评结果的整个系统**。比经典 agent 多出:**工作流设计(loop engineering)、评估、权限控制、持久化状态管理**——从 "prompt 模板" 上升到 "运行时 + 软件系统工程"。

### 2. 三种核心设计模式
- **工作流/循环**:目标导向 plan→execute→observe/test→improve→再执行,直到达标;关键是**模型分析自己的轨迹与失败案例再迭代**,而非静态 prompt。
- **文件系统当持久记忆**:别把整个流程和日志塞进上下文;**长产物(实验日志、code diff、论文摘要、错误 trace、历史轨迹)写文件**,因为它们会远超上下文窗口。
- **子智能体 / 后台任务**:让并行**显式、可检查**;子 agent 输出别只留在临时对话里,要**存成文件/日志/状态记录**,以便中断后恢复、对自身执行历史推理。

### 3. 自我提升(RSI)技术谱(逐级 "优化优化器")
ACE(上下文当可进化 playbook:Generator/Reflector/Curator)→ MCE(技能进化的双层优化)→ **Meta-Harness**(优化 "决定存/取/呈现什么信息的那段代码" 本身)→ AI Scientist(想法→代码→实验→写稿→审稿全流程)→ 进化式搜索(**AlphaEvolve、STOP、Self-Harness**)→ **Darwin Gödel Machine (DGM)**(让 coding agent 进化可编辑 harness 代码库,SWE-bench Verified 20%→50%)。

### 4. 七个瓶颈
① 评估器弱/模糊(研究品味、新颖性无法快速精确验证)② 上下文/记忆生命周期 ③ 负结果(模型不擅长承认失败/放弃假设)④ 多样性坍缩(RL/进化只薅高奖励模式)⑤ 奖励作弊 ⑥ 只优化短期目标(忽视可维护性/迁移成本/未来调试)⑦ 人的角色(**人应往上挪,不是被移出闭环**)。

### 5. 评测基准
PaperBench、CORE-Bench、ScienceAgentBench、RE-Bench、MLE-bench、KernelBench(整体分都在 ~20% 量级,远未解决)。

### 6. 未来路径
模型权重与外层 harness **协同优化**(如 SIA:Meta-Agent 提 harness、Task-Agent 执行、Feedback-Agent 决定更新 harness 还是权重),但有 Goodhart/稳定性风险。近期 RSI **不会是模型直接改权重**,而是 harness 往 "元方法论" 进化;许多 harness 改进最终会**内化进模型**,但 "指定目标/约束/上下文/评估" 这层接口不会消失。

---

## 二、对照 dda 现状

| 她说的 harness 维度 | dda 现状 | 判定 |
|---|---|---|
| 工作流/循环 | scope→search→fetch→verify→synthesize;runPipeline;verdict(converged/score/missing) | ✅ 有,且是 "分析失败再迭代" 型 |
| 文件当持久记忆 | artifacts 的 events.jsonl / report.json / search_status.json + SQLite Index | ✅ 有 |
| 子智能体 + 状态记录 | worker sessions、events 日志、status、concurrency 并发 | ✅ 有(并行显式、可恢复) |
| 评估 | voting/refutation 核验 + verification-loop / 回归护栏 | 🟡 任务级有,元评估/模糊评估器没有 |
| 权限控制 | 跑 `bypassPermissions`(全开) | 🟡 ~无粒度权限 |
| 人的触点 | Web UI(campaign/chat/files)可看可干预 | 🟡 有基础,缺 "人往上挪" 的分层 oversight |
| 自我提升 / RSI | 无 | ❌ 完全没有 |
| 记忆生命周期(检索/蒸馏/跨 campaign 学习) | 只写产物,无 curator/retrieval/compaction | ❌ |
| 模型+harness 协同优化 | 固定模型 + 固定 harness | ❌ |

---

## 三、"她提到、dda 还没做"

### A. 该补的(实用,和护城河/可靠性同向)
1. **记忆生命周期层**:现在只 "写文件",缺**跨 campaign 的蒸馏/检索/curation**(ACE 的 Reflector/Curator);让 agent 把 "某疾病/靶点上学到的经验" 沉淀成可复用 playbook——也是私有数据飞轮的载体。
2. **负结果处理**:系统化 "何时放弃一个靶点假设 / 报告阴性"——药靶场景阴性极有价值,而模型天然不擅长。
3. **奖励作弊/评估器防护**:verify 是自评闭环,要防它钻自己 verifier 的空子(独立评审、对抗核验)。
4. **人的分层触点**:落实 "人往上挪"——哪些结论必须人签字(容错低的药靶),做成显式 checkpoint = 信任壁垒。
5. **基准化评估**:现在没有客观 benchmark;借 PaperBench/ScienceAgentBench 思路建 dda 专属靶点发现评测集,量化 "改了有没有更好"。
6. **权限控制**:别一直 `bypassPermissions`;工具/写操作分级授权 = 生产可信度。

### B. 前沿 RSI(看方向,现阶段不做)
Meta-Harness / DGM / AlphaEvolve / STOP(agent 进化自己的 harness 代码、自改权重)——研究级 RSI,对要落地、要可靠的垂类药靶 agent 属过度工程,现在做只会引入不稳定与奖励作弊风险。

---

## 结论
dda 的 harness **三大基础模式(loop / 文件记忆 / 子 agent 状态)都已具备**,结构不落后;真正缺口在**上层的 "学习与评估"**——记忆蒸馏、负结果、评估器防护、人签字触点、基准化。这几个恰好与护城河(可靠性 + 私有数据飞轮)同向,值得补;她后半篇的自进化 RSI(Meta-Harness/DGM)则是研究前沿,现阶段只看不做。

**候选下一步**:① 给 dda 加一层跨 campaign 记忆蒸馏(Reflector/Curator);② 搭 dda 专属靶点发现评测集。
