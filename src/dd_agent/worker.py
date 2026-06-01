"""Worker node = boxed agent session.

Protocol: async worker_fn(stage, NodeInput, angle: str | None) -> NodeOutput.
- dummy_worker: zero-API stand-in (M0), exercises control flow.
- sdk_worker:   M1 — Claude Agent SDK session that CALLS in-process MCP tools
                (OpenTargets + submit_result) and returns a typed NodeOutput.
                The node's LLM decides whether/how to call the tools; the harness
                only mounts the menu + sets the cwd/role (ARCHITECTURE §3.7 D).
"""
from __future__ import annotations

import json
from pathlib import Path

from .schemas import Evidence, NodeInput, NodeOutput, TargetCandidate
from .tools.opentargets import disease_associated_targets, search_disease

STAGE_DIR = Path(__file__).resolve().parents[2] / "stages"


# ----------------------------------------------------------------------------
# M0: dummy (zero API)
# ----------------------------------------------------------------------------
async def dummy_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    """Zero-API stand-in to exercise the control flow."""
    cands: list[TargetCandidate] = []
    if stage.name == "target-hypothesis":
        # anchor (DOMAIN §1): genetics-first dry-AMD top target = complement (CFH/C3);
        # ROCK = mechanism/repurposing candidate.
        cands = [
            TargetCandidate(symbol="CFH", modality="small_molecule",
                            evidence=[Evidence(kind=angle or "genetic", source="dummy")],
                            scores={"association": 0.9}, rationale="[dummy] complement (genetics)"),
            TargetCandidate(symbol="ROCK1", modality="small_molecule",
                            evidence=[Evidence(kind=angle or "literature", source="dummy")],
                            scores={"association": 0.4}, rationale="[dummy] ROCK (mechanism)"),
        ]
    suffix = f"/{angle}" if angle else ""
    return NodeOutput(
        stage=stage.name,
        summary=f"[dummy] {stage.name}{suffix} for {node_input.disease}",
        candidates=cands,
    )


# ----------------------------------------------------------------------------
# M1: Claude Agent SDK worker (real, for target-hypothesis / genetic angle)
# ----------------------------------------------------------------------------
def _load_role(stage_name: str) -> str:
    p = STAGE_DIR / stage_name / "CLAUDE.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def _ot_server():
    """In-process SDK MCP server exposing OpenTargets as callable tools."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("search_disease",
          "Resolve a disease name to OpenTargets EFO ids. Returns JSON [{id,name}].",
          {"name": str})
    async def _search(args):
        hits = search_disease(args["name"])
        return {"content": [{"type": "text", "text": json.dumps(hits)}]}

    @tool("disease_associated_targets",
          "Targets associated with an EFO disease id, sorted by genetic_association "
          "score (desc). Returns JSON {disease, efo_id, rows:[{symbol,name,overall,genetic,datatypes}]}.",
          {"efo_id": str, "size": int})
    async def _assoc(args):
        res = disease_associated_targets(args["efo_id"], int(args.get("size") or 25))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("opentargets", "1.0.0", [_search, _assoc])


def _result_server(captured: dict, stage_name: str):
    """In-process tool that captures the node's typed NodeOutput."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("submit_result",
          "Submit the final result. Call exactly once when done. candidates is a list of "
          "{symbol, name?, modality?, evidence:[{kind,source,detail?,ref?}], scores?, rationale?}.",
          {"summary": str, "candidates": list, "open_questions": list})
    async def _submit(args):
        cands = []
        for c in args.get("candidates", []) or []:
            cands.append(TargetCandidate(
                symbol=c["symbol"], name=c.get("name"), modality=c.get("modality"),
                evidence=[Evidence(**e) for e in c.get("evidence", []) or []],
                scores=c.get("scores") or {}, rationale=c.get("rationale", "")))
        captured["output"] = NodeOutput(
            stage=stage_name, summary=args.get("summary", ""),
            candidates=cands, open_questions=args.get("open_questions") or [])
        return {"content": [{"type": "text", "text": f"recorded {len(cands)} candidate(s)"}]}

    return create_sdk_mcp_server("result", "1.0.0", [_submit])


async def sdk_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    """M1: real session for target-hypothesis (genetic angle). Other stages → dummy."""
    if stage.name != "target-hypothesis":
        return await dummy_worker(stage, node_input, angle)   # other stages not wired until M3/M4

    from claude_agent_sdk import ClaudeAgentOptions, query

    captured: dict = {}
    role = _load_role(stage.name)
    system = (
        role
        + "\n\n## 本次运行（M1）\n"
        "只做【遗传(genetic)】角度：用 `mcp__opentargets__*` 查该疾病的遗传关联靶点"
        "（按 genetic_association 排序），挑出有遗传证据支撑的候选。每个候选的 evidence "
        "必须含 source='OpenTargets' 与可追溯 detail（如 genetic_association 分值）。完成后"
        "**必须**调用 `mcp__result__submit_result` 提交。不要 fan-out 子 agent。"
    )
    angle_txt = f"（角度：{angle}）" if angle else ""
    top_n = node_input.constraints.get("top_n", 10)
    prompt = (
        f"疾病：{node_input.disease}{angle_txt}\n"
        f"目标：{node_input.objective or '提出有遗传证据支撑的候选靶点'}。\n"
        f"建议流程：search_disease 找 EFO → disease_associated_targets 取遗传 top → "
        f"挑出可追溯候选 → submit_result。候选数 ≤ {top_n}。"
    )
    opts = ClaudeAgentOptions(
        cwd=str(STAGE_DIR / stage.name),
        system_prompt=system,
        mcp_servers={"opentargets": _ot_server(), "result": _result_server(captured, stage.name)},
        allowed_tools=[
            "mcp__opentargets__search_disease",
            "mcp__opentargets__disease_associated_targets",
            "mcp__result__submit_result",
        ],
        permission_mode="bypassPermissions",
        max_turns=stage.max_turns,
    )
    async for _ in query(prompt=prompt, options=opts):
        pass

    if "output" in captured:
        return captured["output"]
    return NodeOutput(stage=stage.name,
                      summary="[sdk] session ended without calling submit_result",
                      open_questions=["worker did not call submit_result"])
