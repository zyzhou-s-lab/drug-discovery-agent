"""Judge node = stateless, typed verdict. ADVISES; Runner does the transition.

Protocol: judge_fn(stage, NodeOutput) -> Verdict.
- dummy_judge: zero-API stand-in (M0).
- api_judge:   M1 — raw Messages API with forced-tool structured output → typed
               Verdict (the design's `messages.parse`; anthropic has no .parse, so
               we force a single `emit_verdict` tool, which is the canonical typed
               structured-output pattern). Uses a per-stage rubric_prompt.
"""
from __future__ import annotations

import os

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


def api_judge(stage, output: NodeOutput) -> Verdict:
    """M1 real judge for stages that carry a rubric_prompt; else fall back to dummy."""
    rubric = getattr(stage, "rubric_prompt", "") or ""
    if not rubric:                                  # not wired for this stage yet → dummy
        return dummy_judge(stage, output)

    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["DD_JUDGE_API_KEY"])
    model = os.environ.get("DD_JUDGE_MODEL", "claude-sonnet-4-5")

    verdict_tool = {
        "name": "emit_verdict",
        "description": "Emit the structured verdict for this stage output.",
        "input_schema": Verdict.model_json_schema(),
    }
    user = (
        "按 rubric 评审下面这一阶段的产出，判定是否收敛（converged）。\n\n"
        f"=== STAGE ===\n{stage.name}\n\n"
        f"=== OUTPUT (JSON) ===\n{output.model_dump_json(indent=2)}\n\n"
        "用 emit_verdict 工具输出：converged(是否过)、score(0-1)、reasons、"
        "missing(缺什么，驱动下一次重试)、retry_hint。"
    )
    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        system=rubric,
        messages=[{"role": "user", "content": user}],
        tools=[verdict_tool],
        tool_choice={"type": "tool", "name": "emit_verdict"},
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "emit_verdict":
            return Verdict.model_validate(block.input)
    return Verdict(converged=False, score=0.0,
                   reasons=["judge returned no emit_verdict tool_use"], missing=["verdict"])
