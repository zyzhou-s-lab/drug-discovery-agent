"""Judge node = stateless, typed verdict. ADVISES; Runner does the transition.

Protocol: judge_fn(stage, NodeOutput) -> Verdict.
M0 = dummy. M1 swaps in raw Messages API (anthropic.messages.parse) with a
per-stage rubric_prompt; validation stage uses ValidationVerdict (M4).
"""
from __future__ import annotations

from .schemas import NodeOutput, Verdict


def dummy_judge(stage, output: NodeOutput) -> Verdict:
    """Zero-API stand-in: pass if the stage produced something plausible."""
    needs_candidates = stage.name == "target-hypothesis"
    ok = (not needs_candidates) or bool(output.candidates)
    return Verdict(
        converged=ok,
        score=1.0 if ok else 0.0,
        reasons=["[dummy] auto-pass"] if ok else ["[dummy] no candidates"],
        missing=[] if ok else ["candidates"],
    )
