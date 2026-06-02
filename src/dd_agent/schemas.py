"""Typed I/O contracts (DETAILED-DESIGN §2). pydantic v2.

The shapes are fixed; content flowing through is dynamic (CONCEPTS §5).
Validation-stage schemas (ValidationPlan/ToolChoice/...) arrive in M4.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class NodeInput(BaseModel):
    campaign_id: str
    stage: str
    disease: str
    objective: str = ""
    context_refs: list[str] = Field(default_factory=list)  # pointers into index, not full text
    constraints: dict[str, Any] = Field(default_factory=dict)
    prior_candidates: list[dict[str, Any]] = Field(default_factory=list)  # upstream stage candidates (chain)
    disease_brief: str = ""                                  # stage-0 overview brief (focus context)
    retry_feedback: str = ""                                 # judge's missing/retry_hint, fed into a retry


class Evidence(BaseModel):
    kind: str            # genetic | expression | pathway | literature | animal_model
    source: str          # OpenTargets | OpenAlex | Semantic Scholar | GTEx | ...
    detail: str = ""
    ref: str = ""        # traceable id: literature -> DOI (10.xxxx/...); else index id/link


class TargetCandidate(BaseModel):
    symbol: str
    name: str | None = None
    modality: str | None = None   # small_molecule | peptide | antibody | ...
    evidence: list[Evidence] = Field(default_factory=list)
    scores: dict[str, float] = Field(default_factory=dict)  # association/tractability/novelty/safety_flag
    rationale: str = ""


class NodeOutput(BaseModel):
    stage: str
    summary: str = ""
    artifacts: list[str] = Field(default_factory=list)       # paths written into the artifact store
    candidates: list[TargetCandidate] = Field(default_factory=list)
    self_assessment: str = ""                                # advisory only; not authoritative
    open_questions: list[str] = Field(default_factory=list)


class Verdict(BaseModel):
    converged: bool
    score: float = 0.0
    reasons: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)         # drives the next retry's input
    retry_hint: str | None = None


# ---- stage-4 validation planning (M4) ----
class ValidationAnglePlan(BaseModel):
    target: str
    angles: list[str] = Field(default_factory=list)          # subset of the fixed menu
    rationale: str = ""


class ValidationPlan(BaseModel):
    disease: str = ""
    plans: list[ValidationAnglePlan] = Field(default_factory=list)
