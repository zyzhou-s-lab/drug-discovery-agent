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


# 发现段 stage 1-4（DOMAIN §5.1 节点清单）
DISCOVERY_PIPELINE: list[Stage] = [
    Stage("target-hypothesis", rubric_prompt=_TH_RUBRIC, scatter=True,
          angles=["genetic", "expression", "network", "literature"]),
    Stage("literature-evidence"),
    Stage("target-selection"),
    Stage("target-validation", scatter=True,
          angles=["genetic", "perturbation", "expression", "network", "safety"]),
]
