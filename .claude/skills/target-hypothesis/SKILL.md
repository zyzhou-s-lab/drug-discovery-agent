---
name: target-hypothesis
description: 给定疾病，产出有机制依据、可证伪的候选靶点假设 + 可追溯证据 + 评分。仅在 target-hypothesis 阶段使用。
---

# Skill：靶点假设生成

> **可选能力扩展**（软）。必做脚手架在 `stages/target-hypothesis/CLAUDE.md`（硬，always-in-context）——本文件只补充"怎么做得更好"的细节，不承载不可遗漏的步骤（见 DETAILED-DESIGN §12）。

## 推荐流程
1. **遗传学**：`mcp__opentargets__target_disease` 取关联 + genetics datatype，挑高关联且有遗传支持的靶点。
2. **表达**：`mcp__expression__query` 看候选在疾病相关组织/细胞（如 dry AMD：视网膜色素上皮 RPE、脉络膜、感光细胞）的表达是否吻合机制。
3. **通路**：归纳候选所属通路，标注与疾病机制的契合点。
4. **文献**：`mcp__pubmed__search` 找**真实** PMID 支撑机制；无证据则不写。
5. **汇总**：去重、跨维度合并证据、写机制级 rationale、按规则填 scores。
6. 调 `submit_result` 提交 `NodeOutput`。

## 评分口径（DOMAIN-FILL，待专家定）
- `association`：OpenTargets 关联分（直接取/折算）。
- `tractability`：OpenTargets druggability 评估。
- `novelty` / `safety_flag`：<!-- DOMAIN-FILL：定规则 -->。

## 输出 schema
见 `docs/DOMAIN.md §3`（`TargetCandidate` / `Evidence`）。候选数 ≤ `constraints.top_n`。

## 质量自查（仅自查，验收以外层 judge 为准）
- 每个候选有机制 rationale？证据可追溯（无编造引用）？多维度？给了可证伪下一步？

<!-- DOMAIN-FILL: 科学判据/阈值优先从 robin/prompts.py 对应段落迁移。 -->
