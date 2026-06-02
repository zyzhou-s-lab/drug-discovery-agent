"""Pipeline = declarative list of Stages (the domain workflow).

Phase A activates discovery stages 1-4 only; design stages 5-7 (structure-prep /
molecule-design-docking / simulation-validation) + report = Phase B.
See DOMAIN §5 / §5.1.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Stage:
    name: str
    role_prompt: str = ""
    rubric_prompt: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    max_turns: int = 40
    max_attempts: int = 3
    scatter: bool = False                       # scatter-gather: parallel angle worker nodes
    angles: list[str] = field(default_factory=list)
    planner: bool = False                       # M4: planner-driven dynamic scatter (stage-4)


# stage-0 验收 rubric：disease brief 是否覆盖关键背景（子型/组织/机制/通路），可追溯。
_OVERVIEW_RUBRIC = (
    "你是疾病调研阶段的审稿人。收敛标准：\n"
    "1) brief 覆盖疾病的关键背景——子型 / 相关组织或细胞 / 已知核心机制 / 关键通路或基因家族；\n"
    "2) 基于真实来源（OpenTargets 疾病信息 / Europe PMC 文献），不空泛编造；\n"
    "3) 本阶段**不提名靶点**（candidates 应为空）。\n"
    "score 反映 brief 的覆盖度与可用性；missing 标明缺哪类背景。"
)

# stage-1 验收 rubric（M1）。judge 据此出 typed Verdict（ARCHITECTURE §3.7 D：
# rubric 是 harness 用来"逼"模型去调遗传证据工具的验收标准，而非命令）。
_TH_RUBRIC = (
    "你是靶点假设阶段的审稿人。收敛标准：\n"
    "1) 至少 1 个候选靶点；\n"
    "2) 每个候选有可追溯遗传证据（evidence 含 source 含 'OpenTargets' 且有 genetic 分值/detail），不得凭空编造；\n"
    "3) 对遗传驱动疾病，top 候选应覆盖该疾病的强遗传信号。dry AMD 的补体（CFH/C3 等）是已知 "
    "ground truth，可作校准锚——若完全无补体相关候选，视为遗漏关键遗传证据"
    "（converged=false，并在 missing 标明）。\n"
    "score(0-1) 反映证据可追溯性与覆盖度；missing 写明缺哪类证据以驱动下一次重试。"
)

# stage-2 验收 rubric（M3a）：文献证据必须真实可追溯（PMID），严禁编造引用。
_LIT_RUBRIC = (
    "你是文献证据阶段的审稿人。收敛标准：\n"
    "1) 对上游候选靶点给出文献证据；\n"
    "2) 每条 literature evidence 的 ref 必须是**真实 PMID**（可追溯），source 指向 "
    "Europe PMC/PubMed——**严禁编造引用**：若 evidence 无 PMID 或明显杜撰则 converged=false；\n"
    "3) 主要候选（尤其补体 CFH/C3）应有文献支撑。\n"
    "score(0-1) 反映引用可追溯性与覆盖度；missing 标明哪些候选缺真实文献。"
)

# stage-3 验收 rubric（M3b）：从上游候选选定靶点，多维一致 + 显式取舍。
_SEL_RUBRIC = (
    "你是靶点选定阶段的审稿人。收敛标准：\n"
    "1) 从上游候选中给出**选定**靶点（非空）；\n"
    "2) 每个选定有**多维依据**（关联强度 + 可成药性 tractability + 安全/遗传约束 + 文献），"
    "淘汰项有理由；\n"
    "3) 选定与证据一致——dry AMD 的补体（CFH/C3 等，强遗传+文献）应进入选定；小分子可成药性弱时"
    "应标注 modality（antibody/peptide），而非仅因此排除；\n"
    "4) 显式呈现冲突/取舍（如遗传强但小分子不可成药）。\n"
    "score(0-1) 反映选定依据的充分性与一致性；missing 标明缺哪类评估。"
)

# stage-4 验证 rubric（M4a）：多角度加权验证，显式冲突，正交一致。
_VAL_RUBRIC = (
    "你是靶点验证阶段的审稿人。收敛标准：\n"
    "1) 对选定靶点给出多角度验证结论（非空）；\n"
    "2) **加权而非投票**：靶点通过 iff 因果向角度（genetic）稳健支持，且综合其他角度"
    "（safety 等）权重一致；权重反映证据强度，不是简单多数；\n"
    "3) **显式呈现冲突**（如遗传强但 LoF intolerant 的安全顾虑）——冲突不必一票否决，但必须标注；\n"
    "4) 验证结论与上游证据一致（补体 C3/CFH 的遗传应被独立确认）。\n"
    "score(0-1) 反映验证的正交一致性与稳健性；missing 标明缺哪些角度/证据。"
)


# 发现段 stage 1-4（DOMAIN §5.1 节点清单）
DISCOVERY_PIPELINE: list[Stage] = [
    Stage("disease-overview", rubric_prompt=_OVERVIEW_RUBRIC),   # stage-0: split-and-merge brief
    Stage("target-hypothesis", rubric_prompt=_TH_RUBRIC, scatter=True,
          angles=["genetic", "expression", "network", "literature"]),
    Stage("literature-evidence", rubric_prompt=_LIT_RUBRIC),
    Stage("target-selection", rubric_prompt=_SEL_RUBRIC),
    Stage("target-validation", rubric_prompt=_VAL_RUBRIC, planner=True),
]
