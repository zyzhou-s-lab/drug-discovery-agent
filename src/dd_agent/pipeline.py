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


# 发现段 stage 1-4（DOMAIN §5.1 节点清单）
DISCOVERY_PIPELINE: list[Stage] = [
    Stage("target-hypothesis", scatter=True,
          angles=["genetic", "expression", "network", "literature"]),
    Stage("literature-evidence"),
    Stage("target-selection"),
    Stage("target-validation", scatter=True,
          angles=["genetic", "perturbation", "expression", "network", "safety"]),
]
