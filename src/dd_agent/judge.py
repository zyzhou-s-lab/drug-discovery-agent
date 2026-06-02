"""Judge node = stateless, typed verdict. ADVISES; Runner does the transition.

Layers (C2):
- _gate: deterministic business-rule check (no LLM, zero cost) runs FIRST.
- LLM judge via claude -p (Agent SDK session) + a `submit_verdict` in-process tool
  to get a typed Verdict — same mechanism as worker's submit_result, so we keep the
  schema without raw forced-tool. judge ADVISES score; harness DECIDES via the
  DD_JUDGE_PASS threshold (the LLM's converged bool is advisory only). Consensus over
  DD_JUDGE_VOTES (default 1 — claude -p is ~$0.15/call). Model = whatever claude CLI
  is configured with (DeepSeek here). judge only gets submit_verdict (no external
  tools — it judges, it doesn't act/verify; cf. §3.4).
"""
from __future__ import annotations

import os

from .schemas import NodeOutput, Verdict


async def dummy_judge(stage, output: NodeOutput) -> Verdict:
    """Zero-API stand-in: pass if the stage produced something plausible."""
    needs_candidates = stage.name == "target-hypothesis"
    ok = (not needs_candidates) or bool(output.candidates)
    return Verdict(
        converged=ok,
        score=1.0 if ok else 0.0,
        reasons=["[dummy] auto-pass"] if ok else ["[dummy] no candidates"],
        missing=[] if ok else ["candidates"],
    )


def _gate(stage, output: NodeOutput) -> str | None:
    """C2 deterministic business-rule gate — runs before any LLM, zero API cost.
    Format/completeness belongs in script, not the LLM judge. None=pass, str=fail reason."""
    if stage.name == "disease-overview":
        if not (output.summary or "").strip():
            return "empty brief summary"
        if output.candidates:
            return "disease-overview must not nominate targets (candidates non-empty)"
        return None
    # nomination / literature / selection / validation: need traceable candidates
    if not output.candidates:
        return "no candidates produced"
    unsourced = [c.symbol for c in output.candidates if not any(e.source for e in c.evidence)]
    if unsourced:
        return f"candidates without any sourced evidence: {unsourced[:5]}"
    return None


def _verdict_server(captured: dict):
    """In-process SDK MCP tool that captures the typed Verdict (cf. worker submit_result)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("submit_verdict",
          "Submit the structured verdict. Call exactly once when done. "
          "converged=bool (your view of pass), score=0-1, reasons=[str], missing=[str], retry_hint=str|null.",
          {"converged": bool, "score": float, "reasons": list, "missing": list, "retry_hint": str})
    async def _submit(args):
        captured["verdict"] = Verdict(
            converged=bool(args.get("converged")),
            score=float(args.get("score") or 0.0),
            reasons=args.get("reasons") or [],
            missing=args.get("missing") or [],
            retry_hint=args.get("retry_hint") or None,
        )
        return {"content": [{"type": "text", "text": "verdict recorded"}]}

    return create_sdk_mcp_server("verdict", "1.0.0", [_submit])


async def _judge_once_claude(rubric: str, user: str, max_turns: int) -> Verdict:
    """One claude -p (SDK) judge session → typed Verdict via submit_verdict."""
    from claude_agent_sdk import ClaudeAgentOptions, query

    captured: dict = {}
    system = (
        rubric
        + "\n\n## 评审说明\n格式/完整性已由前置脚本检查通过，你**只评语义质量**："
        "领域合理性 / 证据是否真支持结论 / 逻辑 / 多角度是否冲突。评完**必须**调用 "
        "`mcp__verdict__submit_verdict` 提交（converged 仅供参考，最终 pass 由 harness 按 score 阈值定）。"
    )
    opts = ClaudeAgentOptions(
        system_prompt=system,
        mcp_servers={"verdict": _verdict_server(captured)},
        allowed_tools=["mcp__verdict__submit_verdict"],   # judges, doesn't act/verify (§3.4)
        permission_mode="bypassPermissions",
        max_turns=max_turns,
    )
    try:
        async for _ in query(prompt=user, options=opts):
            pass
    except Exception as e:
        return Verdict(converged=False, score=0.0,
                       reasons=[f"judge session error: {e}"], missing=["verdict"])
    return captured.get("verdict") or Verdict(
        converged=False, score=0.0,
        reasons=["judge did not call submit_verdict"], missing=["verdict"])


async def api_judge(stage, output: NodeOutput) -> Verdict:
    """gate → claude -p judge (typed via submit_verdict) → consensus → score-threshold pass."""
    gate_fail = _gate(stage, output)                # C2: deterministic gate first (no LLM cost)
    if gate_fail:
        return Verdict(converged=False, score=0.0,
                       reasons=[f"gate (deterministic): {gate_fail}"],
                       missing=["format/completeness"])

    rubric = getattr(stage, "rubric_prompt", "") or ""
    if not rubric:                                  # not wired for this stage yet → dummy
        return await dummy_judge(stage, output)

    user = (
        f"=== STAGE ===\n{stage.name}\n\n"
        f"=== OUTPUT (JSON) ===\n{output.model_dump_json(indent=2)}\n\n"
        "评估其语义质量，然后调用 submit_verdict 提交 verdict。"
    )
    votes = max(1, int(os.environ.get("DD_JUDGE_VOTES", "1")))   # claude -p ~$0.15/call → default 1
    max_turns = int(os.environ.get("DD_JUDGE_MAX_TURNS", "8"))

    verdicts = [await _judge_once_claude(rubric, user, max_turns) for _ in range(votes)]

    # judge ADVISES (score), harness DECIDES (threshold); consensus damps score noise.
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
                 f"(claude -p judge; LLM converged {yes}/{len(verdicts)} — advisory)", *detail],
        missing=missing, retry_hint=retry_hint,
    )
