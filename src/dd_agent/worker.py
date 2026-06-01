"""Worker node = boxed agent session.

Protocol: async worker_fn(stage, NodeInput, angle: str | None) -> NodeOutput.
- dummy_worker: zero-API stand-in (M0), exercises control flow.
- sdk_worker:   M1/M2/M3 — Claude Agent SDK session(s) that CALL in-process MCP
                tools and return a typed NodeOutput. Dispatches per stage:
                  target-hypothesis   -> _hypothesis_worker (angle-aware, OpenTargets)
                  literature-evidence -> _literature_worker (Europe PMC, real PMIDs)
                  target-selection    -> _selection_worker  (OT target_profile triage)
                  (others)            -> dummy until M4.
                The node's LLM decides whether/how to call tools; the harness only
                mounts the menu + sets cwd/role (§3.7 D/E).
"""
from __future__ import annotations

import json
from pathlib import Path

from .schemas import Evidence, NodeInput, NodeOutput, TargetCandidate
from .tools.europepmc import search_literature
from .tools.opentargets import disease_associated_targets, search_disease, target_profile

STAGE_DIR = Path(__file__).resolve().parents[2] / "stages"

# scatter angle → OpenTargets datatype (M2; ARCHITECTURE §3.7 E + phase-a-plan M2).
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
    """In-process SDK MCP server: OpenTargets disease→targets (stage-1)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("search_disease",
          "Resolve a disease name to OpenTargets EFO ids. Returns JSON [{id,name}].",
          {"name": str})
    async def _search(args):
        return {"content": [{"type": "text", "text": json.dumps(search_disease(args["name"]))}]}

    @tool("disease_associated_targets",
          "Targets associated with an EFO disease id, ranked by a chosen evidence "
          "datatype (sort_by: genetic_association|rna_expression|affected_pathway|"
          "literature). Returns JSON {disease,efo_id,sort_by,rows:[{symbol,name,overall,"
          "genetic,sort_score,datatypes}]}.",
          {"efo_id": str, "size": int, "sort_by": str})
    async def _assoc(args):
        res = disease_associated_targets(
            args["efo_id"], int(args.get("size") or 50),
            args.get("sort_by") or "genetic_association")
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("opentargets", "1.0.0", [_search, _assoc])


def _europepmc_server():
    """In-process SDK MCP server: Europe PMC search (stage-2)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("search_literature",
          "Search Europe PMC for REAL papers. Returns JSON [{pmid,doi,title,year,journal}]. "
          "Use the returned pmid as the evidence ref; never invent one.",
          {"query": str, "size": int})
    async def _search(args):
        res = search_literature(args["query"], int(args.get("size") or 5))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("europepmc", "1.0.0", [_search])


def _profile_server():
    """In-process SDK MCP server: OpenTargets target triage profile (stage-3)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("target_profile",
          "Druggability/safety triage for a target symbol: small-molecule tractability "
          "buckets, genetic constraint (gnomAD; lof oe/upperBin low = LoF-intolerant = "
          "caution), safety liabilities, has_known_drug. Returns JSON.",
          {"symbol": str})
    async def _tp(args):
        return {"content": [{"type": "text", "text": json.dumps(target_profile(args["symbol"]))}]}

    return create_sdk_mcp_server("otprofile", "1.0.0", [_tp])


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


def _prior_brief(prior: list[dict]) -> str:
    """Compact JSON of upstream candidates (symbol + scores + evidence kinds) for prompts."""
    return json.dumps(
        [{"symbol": c.get("symbol"), "scores": c.get("scores"),
          "evidence_kinds": sorted({e.get("kind") for e in c.get("evidence", []) if e.get("kind")})}
         for c in prior],
        ensure_ascii=False)


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
# M3b: stage-3 target-selection (OT target_profile triage)
# ----------------------------------------------------------------------------
async def _selection_worker(stage, node_input: NodeInput) -> NodeOutput:
    captured: dict = {}
    role = _load_role(stage.name)
    prior = node_input.prior_candidates or []
    symbols = [c.get("symbol") for c in prior if c.get("symbol")]
    prior_txt = ", ".join(symbols) if symbols else "(上游未提供候选)"
    system = (
        role
        + "\n\n## 本次运行\n"
        "对上游候选做三联评估并**选定**靶点：用 `mcp__otprofile__target_profile` 查每个候选的"
        "可成药性(tractability)、遗传约束(gnomAD: lof oe/upperBin 越低越不耐受→需谨慎)、"
        "安全负债(safety_liabilities)。综合【关联强度(上游 scores)+可成药性+安全+文献(上游)】"
        "为每个候选打分，**选出**最值得推进的靶点；对淘汰项给理由。补体类靶点(如 CFH/C3)若小分子"
        "可成药性弱但遗传/文献强，应保留并标注 modality（如 antibody/peptide），不要仅因小分子弱而淘汰。"
        "完成后**必须**调用 `mcp__result__submit_result`：candidates 只保留**选定**靶点，scores 含 "
        "tractability/constraint/safety 维度，rationale 写选定/淘汰理由。"
    )
    prompt = (
        f"疾病：{node_input.disease}\n"
        f"上游候选（含遗传+文献证据）：{prior_txt}\n"
        f"候选简要（symbol/scores/evidence_kinds）：{_prior_brief(prior)}\n"
        f"建议流程：逐个 `target_profile(symbol)` → 综合评估 → 选定 top 靶点 → submit_result。"
    )
    return await _run_session(
        stage, system, prompt,
        {"otprofile": _profile_server(), "result": _result_server(captured, stage.name)},
        ["mcp__otprofile__target_profile", "mcp__result__submit_result"],
        captured, "selection")


# ----------------------------------------------------------------------------
# M4a: stage-4 target-validation (planner-driven; one session per target×angle)
# ----------------------------------------------------------------------------
async def _validation_worker(stage, node_input: NodeInput, angle: str | None) -> NodeOutput:
    target = node_input.constraints.get("target")
    if not target:
        return NodeOutput(stage=stage.name, summary="[validate] no target in input")
    captured: dict = {}
    role = _load_role(stage.name)
    disease = node_input.disease
    if angle == "safety":
        system = (
            role + "\n\n## 本次运行（验证角度：safety）\n"
            f"验证靶点 **{target}** 的安全性：调 `mcp__otprofile__target_profile` 看 genetic_constraint"
            "（lof 的 oe/upperBin 越低=越不耐受 LoF=on-target 毒性风险）+ safety_liabilities，"
            "判断作为药靶的安全风险（支持/警示）。evidence kind='safety'、source='OpenTargets'。"
            f"完成后**必须** submit_result：candidates 只含 {target}，scores 含 safety 维度，rationale 写风险评估。"
        )
        servers = {"otprofile": _profile_server(), "result": _result_server(captured, stage.name)}
        allowed = ["mcp__otprofile__target_profile", "mcp__result__submit_result"]
        prompt = (f"验证靶点：{target}（角度：safety），疾病：{disease}。"
                  f"流程：target_profile('{target}') → 评估安全 → submit_result。")
    else:  # genetic (default)
        system = (
            role + "\n\n## 本次运行（验证角度：genetic）\n"
            f"独立验证靶点 **{target}** 与 {disease} 的遗传因果：search_disease 找 EFO → "
            "disease_associated_targets(sort_by='genetic_association') 定位该靶点，看其 genetic_association "
            "分与 datatype 分解是否**稳健支持因果**（而非仅弱关联）。evidence kind='genetic'、"
            "source='OpenTargets'、detail 写分值与判断。"
            f"完成后**必须** submit_result：candidates 只含 {target}，scores 含 genetic 验证分，"
            "rationale 写支持/冲突结论。"
        )
        servers = {"opentargets": _ot_server(), "result": _result_server(captured, stage.name)}
        allowed = ["mcp__opentargets__search_disease", "mcp__opentargets__disease_associated_targets",
                   "mcp__result__submit_result"]
        prompt = (f"验证靶点：{target}（角度：genetic），疾病：{disease}。"
                  f"流程：search_disease → disease_associated_targets(sort_by='genetic_association') "
                  f"定位 {target} → 评估遗传因果稳健性 → submit_result。")
    return await _run_session(stage, system, prompt, servers, allowed, captured,
                              f"validate/{target}/{angle}")


# ----------------------------------------------------------------------------
# dispatch
# ----------------------------------------------------------------------------
async def sdk_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    if stage.name == "target-hypothesis":
        return await _hypothesis_worker(stage, node_input, angle)
    if stage.name == "literature-evidence":
        return await _literature_worker(stage, node_input)
    if stage.name == "target-selection":
        return await _selection_worker(stage, node_input)
    if stage.name == "target-validation":
        return await _validation_worker(stage, node_input, angle)
    return await dummy_worker(stage, node_input, angle)
