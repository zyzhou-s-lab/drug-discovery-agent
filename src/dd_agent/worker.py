"""Worker node = boxed agent session.

Protocol: async worker_fn(stage, NodeInput, angle: str | None) -> NodeOutput.
- dummy_worker: zero-API stand-in (M0), exercises control flow.
- sdk_worker:   M1/M2/M3 — Claude Agent SDK session(s) that CALL in-process MCP
                tools and return a typed NodeOutput. Dispatches per stage:
                  target-hypothesis  -> _hypothesis_worker (angle-aware, OpenTargets)
                  literature-evidence-> _literature_worker (Europe PMC, real PMIDs)
                  (others)           -> dummy until M3b/M4.
                The node's LLM decides whether/how to call tools; the harness only
                mounts the menu + sets cwd/role (§3.7 D/E).
"""
from __future__ import annotations

import json
from pathlib import Path

from .schemas import Evidence, NodeInput, NodeOutput, TargetCandidate
from .tools.europepmc import search_literature
from .tools.opentargets import disease_associated_targets, search_disease

STAGE_DIR = Path(__file__).resolve().parents[2] / "stages"

# scatter angle → OpenTargets datatype (M2; ARCHITECTURE §3.7 E + phase-a-plan M2).
# Independent sources (GTEx/STRING/EuropePMC) deferred to M3.
ANGLE_DATATYPE = {
    "genetic": "genetic_association",
    "expression": "rna_expression",
    "network": "affected_pathway",
    "literature": "literature",
}


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
# shared SDK helpers
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
          "Targets associated with an EFO disease id, ranked by a chosen evidence "
          "datatype (sort_by: genetic_association|rna_expression|affected_pathway|"
          "literature). Returns JSON {disease, efo_id, sort_by, rows:[{symbol,name,"
          "overall,genetic,sort_score,datatypes}]}.",
          {"efo_id": str, "size": int, "sort_by": str})
    async def _assoc(args):
        res = disease_associated_targets(
            args["efo_id"], int(args.get("size") or 50),
            args.get("sort_by") or "genetic_association")
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("opentargets", "1.0.0", [_search, _assoc])


def _europepmc_server():
    """In-process SDK MCP server exposing Europe PMC search."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("search_literature",
          "Search Europe PMC for REAL papers. Returns JSON [{pmid,doi,title,year,journal}]. "
          "Use the returned pmid as the evidence ref; never invent one.",
          {"query": str, "size": int})
    async def _search(args):
        res = search_literature(args["query"], int(args.get("size") or 5))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("europepmc", "1.0.0", [_search])


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


async def _run_session(stage, system: str, prompt: str, mcp_servers: dict, allowed_tools: list,
                       captured: dict, label: str) -> NodeOutput:
    """Run one boxed Agent SDK session; return captured NodeOutput or a no-result stub."""
    from claude_agent_sdk import ClaudeAgentOptions, query

    opts = ClaudeAgentOptions(
        cwd=str(STAGE_DIR / stage.name),
        system_prompt=system,
        mcp_servers=mcp_servers,
        allowed_tools=allowed_tools,
        permission_mode="bypassPermissions",
        max_turns=stage.max_turns,
    )
    async for _ in query(prompt=prompt, options=opts):
        pass
    if "output" in captured:
        return captured["output"]
    return NodeOutput(stage=stage.name, summary=f"[sdk/{label}] session ended without submit_result",
                      open_questions=["worker did not call submit_result"])


# ----------------------------------------------------------------------------
# M1/M2: stage-1 target-hypothesis (angle-aware, OpenTargets)
# ----------------------------------------------------------------------------
async def _hypothesis_worker(stage, node_input: NodeInput, angle: str | None) -> NodeOutput:
    captured: dict = {}
    role = _load_role(stage.name)
    angle_name = angle or "genetic"
    datatype = ANGLE_DATATYPE.get(angle_name, "genetic_association")
    system = (
        role
        + "\n\n## 本次运行（scatter 单角度）\n"
        f"只做【{angle_name}】角度：调 `mcp__opentargets__disease_associated_targets`，"
        f"参数 `sort_by='{datatype}'`，取该疾病在【{datatype}】证据维度分值最高的靶点；"
        f"只挑该维度有非零分值的候选。每个候选的 evidence 必须含 source='OpenTargets'、"
        f"kind='{angle_name}'、detail 写明 {datatype} 分值。完成后**必须**调用 "
        "`mcp__result__submit_result`。不要 fan-out 子 agent。"
    )
    top_n = node_input.constraints.get("top_n", 10)
    prompt = (
        f"疾病：{node_input.disease}（角度：{angle_name}）\n"
        f"目标：{node_input.objective or '从该证据维度提出候选靶点'}。\n"
        f"建议流程：search_disease 找 EFO → disease_associated_targets(sort_by='{datatype}') "
        f"→ 挑该维度可追溯候选 → submit_result。候选数 ≤ {top_n}。"
    )
    return await _run_session(
        stage, system, prompt,
        {"opentargets": _ot_server(), "result": _result_server(captured, stage.name)},
        ["mcp__opentargets__search_disease", "mcp__opentargets__disease_associated_targets",
         "mcp__result__submit_result"],
        captured, angle_name)


# ----------------------------------------------------------------------------
# M3a: stage-2 literature-evidence (Europe PMC, real PMIDs)
# ----------------------------------------------------------------------------
async def _literature_worker(stage, node_input: NodeInput) -> NodeOutput:
    captured: dict = {}
    role = _load_role(stage.name)
    prior = node_input.prior_candidates or []
    symbols = [c.get("symbol") for c in prior if c.get("symbol")]
    prior_txt = ", ".join(symbols) if symbols else "(上游未提供候选)"
    system = (
        role
        + "\n\n## 本次运行\n"
        "对上游提名的候选靶点做文献综述：用 `mcp__europepmc__search_literature` 查**真实**文献，"
        "每个候选至少 1 条 literature evidence——evidence 的 ref 必须填工具返回的**真实 PMID**、"
        "kind='literature'、source 形如 'EuropePMC' 或 'PubMed:<pmid>'、detail 写论文标题/结论要点。"
        "**禁止编造 PMID 或引用**；查不到就如实标注证据不足。保留上游候选集，给它们补文献证据。"
        "完成后**必须**调用 `mcp__result__submit_result`。"
    )
    prompt = (
        f"疾病：{node_input.disease}\n"
        f"候选靶点（来自上游 target-hypothesis）：{prior_txt}\n"
        f"建议流程：对每个候选 `search_literature(query='<symbol> AND {node_input.disease}')` "
        f"→ 挑相关真实文献记 PMID → 汇总进各候选的 evidence → submit_result。"
    )
    return await _run_session(
        stage, system, prompt,
        {"europepmc": _europepmc_server(), "result": _result_server(captured, stage.name)},
        ["mcp__europepmc__search_literature", "mcp__result__submit_result"],
        captured, "literature")


# ----------------------------------------------------------------------------
# dispatch
# ----------------------------------------------------------------------------
async def sdk_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    if stage.name == "target-hypothesis":
        return await _hypothesis_worker(stage, node_input, angle)
    if stage.name == "literature-evidence":
        return await _literature_worker(stage, node_input)
    return await dummy_worker(stage, node_input, angle)   # stage 3/4 not wired until M3b/M4
