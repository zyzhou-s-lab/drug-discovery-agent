"""Judge node = stateless, typed verdict. ADVISES; Runner does the transition.

Protocol: judge_fn(stage, NodeOutput) -> Verdict.
- dummy_judge: zero-API stand-in (M0).
- api_judge:   raw Messages API with forced-tool structured output → typed Verdict
               (NOT an agentic session — single shot, no tool loop, no transcript;
               cf. worker which IS a Claude Agent SDK session). Per-stage rubric.
               CONSENSUS: runs the judge N times (DD_JUDGE_VOTES, default 3) and
               takes majority-converged + mean-score, to damp the relay's
               non-determinism (§3.7C consensus applied to the judge).
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


def _judge_once(client, model, rubric: str, user: str, verdict_tool: dict) -> Verdict:
    """One forced-tool judge call → typed Verdict (tolerates empty/partial tool input)."""
    resp = client.messages.create(
        model=model, max_tokens=1024, system=rubric,
        messages=[{"role": "user", "content": user}],
        tools=[verdict_tool], tool_choice={"type": "tool", "name": "emit_verdict"},
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "emit_verdict":
            try:
                return Verdict.model_validate(block.input)
            except Exception as e:                          # relay may return empty/partial input
                return Verdict(converged=False, score=0.0,
                               reasons=[f"judge verdict malformed: {e}"],
                               missing=["verdict"], retry_hint="re-emit a complete emit_verdict")
    return Verdict(converged=False, score=0.0,
                   reasons=["judge returned no emit_verdict tool_use"], missing=["verdict"])


def api_judge(stage, output: NodeOutput) -> Verdict:
    """Real judge for stages with a rubric_prompt; else dummy. Consensus over N votes."""
    rubric = getattr(stage, "rubric_prompt", "") or ""
    if not rubric:                                  # not wired for this stage yet → dummy
        return dummy_judge(stage, output)

    from .llm import anthropic_client_and_model

    votes = max(1, int(os.environ.get("DD_JUDGE_VOTES", "3")))
    client, model = anthropic_client_and_model()
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

    verdicts = [_judge_once(client, model, rubric, user, verdict_tool) for _ in range(votes)]

    # judge ADVISES (score), harness DECIDES (threshold). The relay's `converged` bool is
    # noisy/over-strict — same brief judged 0/3 converged yet score 0.65-0.85 (and a live
    # run passed it 0.95). So pass on the MEAN SCORE vs a deterministic threshold, not the
    # LLM's bool. Consensus over N votes damps the score noise (§3.7C on the judge).
    score = round(sum(v.score for v in verdicts) / len(verdicts), 3)
    pass_thr = float(os.environ.get("DD_JUDGE_PASS", "0.6"))
    converged = score >= pass_thr
    yes = sum(1 for v in verdicts if v.converged)
    detail = [f"[vote {i + 1}:{'✓' if v.converged else '✗'} {v.score}] "
              f"{(v.reasons[0] if v.reasons else '')[:90]}" for i, v in enumerate(verdicts)]
    missing = sorted({m for v in verdicts for m in v.missing})
    retry_hint = next((v.retry_hint for v in verdicts if not v.converged and v.retry_hint), None)
    return Verdict(
        converged=converged, score=score,
        reasons=[f"score {score} {'>=' if converged else '<'} pass {pass_thr} "
                 f"(LLM converged {yes}/{len(verdicts)} votes — advisory only)", *detail],
        missing=missing, retry_hint=retry_hint,
    )
