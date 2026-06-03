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


# deep-research flow (master = new flow only; legacy 5-stage discovery pipeline + its
# rubrics live on branch `legacy-discovery-pipeline`).
#
# M1 = scope-only: a single disease-overview stage with NO rubric. Stages with no
# rubric are NOT judged (runner skips the judge and records no verdict) and run once,
# so the run ends at scope output. search→verify→synth stages (M2) get appended here.
PIPELINE: list[Stage] = [
    Stage("disease-overview", max_attempts=1),
]
