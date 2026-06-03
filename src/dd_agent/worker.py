"""Worker node = boxed agent session (deep-research flow).

async worker_fn(stage, NodeInput, angle) -> NodeOutput.
- dummy_worker: zero-API stand-in (control flow / offline tests).
- sdk_worker:   disease-overview -> _deep_overview_worker (deep-research Scope, M1).

The legacy 5-stage discovery workers (target-hypothesis / literature-evidence /
target-selection / target-validation + their OpenTargets/paperfetch in-process servers)
live on branch `legacy-discovery-pipeline`. See docs/deep-research-port-plan.md.
"""
from __future__ import annotations

from .events import emit
from .schemas import NodeInput, NodeOutput


def _emit_stream(stage_name: str, label: str, msg, skip_text: bool = False) -> None:
    """Map one Agent SDK message to step-card events (路子一: same stream HAPI consumes).
    skip_text: drop assistant TextBlock prose (e.g. scope's chatty post-submit summary)."""
    from claude_agent_sdk import (
        AssistantMessage, ResultMessage, TextBlock, ThinkingBlock,
        ToolResultBlock, ToolUseBlock, UserMessage,
    )
    try:
        if isinstance(msg, AssistantMessage):
            for b in msg.content:
                if isinstance(b, ThinkingBlock):
                    emit(stage_name, label, "thinking", text=b.thinking)
                elif isinstance(b, TextBlock):
                    if not skip_text and b.text and b.text.strip():
                        emit(stage_name, label, "text", text=b.text)
                elif isinstance(b, ToolUseBlock):
                    emit(stage_name, label, "tool_use", tool_id=b.id, name=b.name, input=b.input)
        elif isinstance(msg, UserMessage):
            content = msg.content
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, ToolResultBlock):
                        emit(stage_name, label, "tool_result", tool_id=b.tool_use_id,
                             content=b.content, is_error=bool(getattr(b, "is_error", False)))
        elif isinstance(msg, ResultMessage):
            emit(stage_name, label, "result", session_id=getattr(msg, "session_id", None),
                 is_error=bool(getattr(msg, "is_error", False)),
                 cost=getattr(msg, "total_cost_usd", None), num_turns=getattr(msg, "num_turns", None))
    except Exception:
        pass  # telemetry must never break the run


async def dummy_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    """Zero-API stand-in: a plausible stub so control flow / offline tests run."""
    return NodeOutput(stage=stage.name, summary=f"[dummy] {stage.name} for {node_input.disease}")


# ----------------------------------------------------------------------------
# stage-0: disease-overview = deep-research Scope (M1, scope-only). Streams step cards;
# full searched brief (scope→search→verify→synth) = M2. docs/deep-research-port-plan.md.
# ----------------------------------------------------------------------------
async def _deep_overview_worker(stage, node_input: NodeInput) -> NodeOutput:
    from .research.scope import scope

    # stream live step cards (forward scope's SDK messages, like the legacy _run_session)
    emit(stage.name, "scope", "session_start", prompt=f"deep-research scope: {node_input.disease}")
    res = await scope(node_input.disease,
                      on_message=lambda m: _emit_stream(stage.name, "scope", m, skip_text=True))
    angles = (res or {}).get("angles") or []
    if not angles:
        return NodeOutput(stage=stage.name, summary="[deep-research scope] 未能拆解出研究角度",
                          open_questions=["scope returned no angles"])
    # structured payload for the frontend (rendered as angle cards); summary = short strategy
    return NodeOutput(
        stage=stage.name,
        summary=res.get("summary") or f"Deep-research scope: {len(angles)} 个研究角度",
        candidates=[],
        open_questions=["scope-only 研究计划；完整检索简报（search→verify→synth）待 M2"],
        data={
            "kind": "scope",
            "question": res.get("question", node_input.disease),
            "angles": angles,
            "budget": res.get("budget"),
        },
    )


# ----------------------------------------------------------------------------
# dispatch
# ----------------------------------------------------------------------------
async def sdk_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    if stage.name == "disease-overview":
        return await _deep_overview_worker(stage, node_input)
    return await dummy_worker(stage, node_input, angle)
