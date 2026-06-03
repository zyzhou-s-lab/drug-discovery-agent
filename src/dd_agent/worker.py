"""Worker node = boxed agent session.

Protocol: async worker_fn(stage, NodeInput, angle: str | None) -> NodeOutput.
- dummy_worker: zero-API stand-in (M0), exercises control flow.
- sdk_worker:   M1/M2/M3 — Claude Agent SDK session(s) that CALL in-process MCP
                tools and return a typed NodeOutput. Dispatches per stage:
                  target-hypothesis   -> _hypothesis_worker (angle-aware, OpenTargets)
                  literature-evidence -> _literature_worker (OpenAlex + S2, real DOIs)
                  target-selection    -> _selection_worker  (OT target_profile triage)
                  (others)            -> dummy until M4.
                The node's LLM decides whether/how to call tools; the harness only
                mounts the menu + sets cwd/role (§3.7 D/E).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .events import emit
from .schemas import Evidence, NodeInput, NodeOutput, TargetCandidate
from .tools.opentargets import disease_associated_targets, search_disease, target_profile
from .tools.paperfetch import get_citations, get_references, search_literature_multi


def _emit_stream(stage_name: str, label: str, msg) -> None:
    """Map one Agent SDK message to step-card events (路子一: same stream HAPI consumes)."""
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
                    if b.text and b.text.strip():
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


# Stateless → build once, reuse across every session (cf. _result_server, which holds
# per-session state and must be rebuilt each call). Tool names listed once here so the
# stage allow-lists don't re-type the mcp__paperfetch__* strings.
PAPERFETCH_TOOLS = [
    "mcp__paperfetch__search_literature_multi",
    "mcp__paperfetch__get_references",
    "mcp__paperfetch__get_citations",
]


def _build_paperfetch_server():
    """In-process SDK MCP server: multi-source literature search + citation snowball."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("search_literature_multi",
          "Multi-source literature search (OpenAlex + Semantic Scholar, deduped, OA-tagged). "
          "Returns JSON [{doi,pmid,title,year,venue,authors,citation_count,is_oa,source}]. "
          "Use the returned doi as the evidence ref; never invent one.",
          {"query": str, "size": int})
    async def _search(args):
        res = search_literature_multi(args["query"], int(args.get("size") or 10))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    @tool("get_references",
          "Papers cited BY a given DOI (backward citation snowball). "
          "Returns JSON [{doi,pmid,title,year,venue,authors,citation_count,is_oa,source}].",
          {"doi": str, "size": int})
    async def _refs(args):
        res = get_references(args["doi"], int(args.get("size") or 20))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    @tool("get_citations",
          "Papers that CITE a given DOI (forward citation snowball). "
          "Returns JSON [{doi,pmid,title,year,venue,authors,citation_count,is_oa,source}].",
          {"doi": str, "size": int})
    async def _cites(args):
        res = get_citations(args["doi"], int(args.get("size") or 20))
        return {"content": [{"type": "text", "text": json.dumps(res)}]}

    return create_sdk_mcp_server("paperfetch", "1.0.0", [_search, _refs, _cites])


_PAPERFETCH_SERVER = None


def _paperfetch_server():
    """Lazy cached singleton — built on first use (keeps module import SDK-free, like the
    other _*_server factories), then reused across all sessions since it's stateless."""
    global _PAPERFETCH_SERVER
    if _PAPERFETCH_SERVER is None:
        _PAPERFETCH_SERVER = _build_paperfetch_server()
    return _PAPERFETCH_SERVER


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
                       captured: dict, label: str, node_input: NodeInput | None = None) -> NodeOutput:
    """Run one boxed Agent SDK session; return captured NodeOutput or a no-result stub."""
    from claude_agent_sdk import ClaudeAgentOptions, query

    if node_input is not None:
        system = system + _brief_block(node_input) + _retry_block(node_input)   # focus brief + retry feedback

    opts = ClaudeAgentOptions(
        cwd=str(STAGE_DIR / stage.name),
        system_prompt=system,
        mcp_servers=mcp_servers,
        allowed_tools=allowed_tools,
        permission_mode="bypassPermissions",
        max_turns=stage.max_turns,
    )
    emit(stage.name, label, "session_start", prompt=prompt)
    async for msg in query(prompt=prompt, options=opts):
        _emit_stream(stage.name, label, msg)
    if "output" in captured:
        return captured["output"]
    return NodeOutput(stage=stage.name, summary=f"[sdk/{label}] session ended without submit_result",
                      open_questions=["worker did not call submit_result"])


def _brief_block(node_input: NodeInput) -> str:
    """stage-0 disease brief, injected into downstream worker prompts for focus."""
    b = (getattr(node_input, "disease_brief", "") or "").strip()
    return f"\n\n## 疾病背景（来自 stage-0 disease-overview，供聚焦）\n{b}\n" if b else ""


def _retry_block(node_input: NodeInput) -> str:
    """judge feedback from the last failed attempt — injected so the retry improves targetedly."""
    fb = (getattr(node_input, "retry_feedback", "") or "").strip()
    return (f"\n\n## ⚠️ 这是重试（上次未通过 judge）\n{fb}\n"
            "请针对性改进上述问题，不要原样重复上次的产出。\n") if fb else ""


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
        captured, angle_name, node_input)


# ----------------------------------------------------------------------------
# M3a: stage-2 literature-evidence (OpenAlex + Semantic Scholar, real DOIs)
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
        "对上游提名的候选靶点做文献综述：用 `mcp__paperfetch__search_literature_multi` 查**真实**文献"
        "（OpenAlex + Semantic Scholar 多源，已去重、标 OA）；需要顺藤摸瓜时用 "
        "`mcp__paperfetch__get_references`（该文引了谁）/ `mcp__paperfetch__get_citations`（谁引了该文）。"
        "每个候选至少 1 条 literature evidence——evidence 的 ref 必须填工具返回的**真实 DOI**、"
        "kind='literature'、source 形如 'doi:<doi>'、detail 写论文标题/结论要点。"
        "**禁止编造 DOI 或引用**；查不到就如实标注证据不足。保留上游候选集，给它们补文献证据。"
        "完成后**必须**调用 `mcp__result__submit_result`。"
    )
    prompt = (
        f"疾病：{node_input.disease}\n"
        f"候选靶点（来自上游 target-hypothesis）：{prior_txt}\n"
        f"建议流程：对每个候选 `search_literature_multi(query='<symbol> AND {node_input.disease}')` "
        f"→ 挑相关真实文献记 DOI（必要时用 get_references/get_citations 扩展）"
        f"→ 汇总进各候选的 evidence → submit_result。"
    )
    return await _run_session(
        stage, system, prompt,
        {"paperfetch": _paperfetch_server(), "result": _result_server(captured, stage.name)},
        [*PAPERFETCH_TOOLS, "mcp__result__submit_result"],
        captured, "literature", node_input)


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
        captured, "selection", node_input)


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
                              f"validate/{target}/{angle}", node_input)


def _synth_material(raw: list[dict]) -> str:
    """Compact per-target view of the merged per-angle validation results for the synthesis node."""
    lines = []
    for c in raw:
        scores = c.get("scores") or {}
        evk = sorted({e.get("kind") for e in c.get("evidence", []) if e.get("kind")})
        srcs = sorted({e.get("source") for e in c.get("evidence", []) if e.get("source")})[:4]
        lines.append(f"- {c.get('symbol')}: scores={scores} angles={evk} sources={srcs}\n"
                     f"    rationale: {(c.get('rationale') or '')[:300]}")
    return "\n".join(lines)


async def _validation_synthesis(stage, node_input: NodeInput) -> NodeOutput:
    """Gather-side adjudication node — fills the structural gap behind stage-4 exhaustion.

    The per-(target×angle) workers are blind across angles (genetic session can't see
    safety) and the deterministic union (_merge_by_symbol) doesn't decide — so the
    rubric's *weighted verdict (genetic-causal primary) + explicit genetic-vs-safety
    conflict flags* had no producer, and the summary mechanically said "N validated".
    This node adjudicates over the merged results, and is the correct sink for the
    judge's retry_feedback (it sees all angles). cf. stage-0 split-and-merge; §3.7."""
    captured: dict = {}
    role = _load_role(stage.name)
    raw = node_input.constraints.get("to_synthesize") or []
    if not raw:
        return NodeOutput(stage=stage.name, summary="[validate:synthesis] no merged results to adjudicate")
    system = (
        role
        + "\n\n## 本次运行（综合判定 / gather-side adjudication）\n"
        "你收到每个选定靶点**已完成**的多角度验证结果（genetic + safety，材料已齐，**不要再去查工具**）。"
        "按验证 rubric 做**加权裁决**（非投票）：\n"
        "1) 靶点 **PASS 当且仅当因果向（genetic）稳健支持**（genetic≥0.6 量级）；genetic 弱/为 0 的"
        "标 **WEAK** 或 **NOT-VALIDATED**，**不得**因 safety 好就笼统算通过；\n"
        "2) **显式标注 genetic-safety 冲突**：如 genetic≈0 但 safety 高，写 "
        "'CONFLICT: genetic-null vs safety-ok'；\n"
        "3) 权重反映证据强度，不是简单多数。\n"
        "完成后**必须** submit_result：candidates 含**全部**靶点（保留各自 evidence），每个 rationale 以 "
        "'VERDICT=PASS|WEAK|FAIL；' 开头写加权理由+冲突标注；scores 至少含 genetic、safety、verdict"
        "（PASS=1.0 / WEAK=0.5 / FAIL=0.0）；summary 给分级结论（哪些 PASS、哪些 WEAK/CONFLICT 及原因）。"
    )
    prompt = (
        f"疾病：{node_input.disease}\n"
        f"选定靶点的多角度验证结果（待综合裁决）：\n{_synth_material(raw)}\n\n"
        "对每个靶点做加权裁决（genetic 主导）、标注冲突，然后 submit_result。"
    )
    out = await _run_session(
        stage, system, prompt,
        {"result": _result_server(captured, stage.name)},
        ["mcp__result__submit_result"],
        captured, "synthesis", node_input)
    if not out.candidates:                  # synthesis didn't submit → fall back to union (no worse)
        cands = [TargetCandidate.model_validate(c) for c in raw]
        return NodeOutput(
            stage=stage.name, candidates=cands,
            summary=f"[validate:synthesis-fallback] {len(cands)} targets (union, unadjudicated)",
            open_questions=["synthesis node did not submit_result"])
    return out


# ----------------------------------------------------------------------------
# stage-0: disease-overview (single session split-and-merge; LLM synthesizes a brief)
# ----------------------------------------------------------------------------
async def _overview_worker(stage, node_input: NodeInput) -> NodeOutput:
    captured: dict = {}
    role = _load_role(stage.name)
    # 最精简（ARCHITECTURE §3.7 D）：不列工具、不规定流程。工具的"是什么/怎么调/何时收尾"
    # 全在各自 tool description 里（随 schema 给 LLM）；这里只给目标 + 约束，编排交给模型、
    # 达标与否交给 judge rubric。
    system = (
        role
        + "\n\n## 本次运行\n"
        "产出一份覆盖【子型 / 相关组织·细胞 / 已知核心机制 / 关键通路·基因家族】的 disease brief，"
        "作为下游靶点提名/验证的聚焦背景。每条信息都要可追溯（基于查到的真实数据，别凭记忆），"
        "本阶段不提名靶点。"
    )
    prompt = f"疾病：{node_input.disease}。产出 disease brief。"
    return await _run_session(
        stage, system, prompt,
        {"opentargets": _ot_server(), "paperfetch": _paperfetch_server(),
         "result": _result_server(captured, stage.name)},
        ["mcp__opentargets__search_disease", *PAPERFETCH_TOOLS,
         "mcp__result__submit_result"],
        captured, "overview", node_input)


# ----------------------------------------------------------------------------
# stage-0 (deep-research variant, M1 scope-only): DD_STAGE0=deep selects this.
# Runs the deep-research Scope phase → emits the angle plan as the brief. The full
# searched brief (scope→search→verify→synth) lands in M2. See docs/deep-research-port-plan.md.
# ----------------------------------------------------------------------------
async def _deep_overview_worker(stage, node_input: NodeInput) -> NodeOutput:
    from .research.scope import scope

    # stream live step cards (parity with _run_session): forward scope's SDK messages
    emit(stage.name, "scope", "session_start", prompt=f"deep-research scope: {node_input.disease}")
    res = await scope(node_input.disease, on_message=lambda m: _emit_stream(stage.name, "scope", m))
    angles = (res or {}).get("angles") or []
    if not angles:
        return NodeOutput(stage=stage.name, summary="[deep-research scope] 未能拆解出研究角度",
                          open_questions=["scope returned no angles"])
    lines = [f"# Deep-research 研究计划 (scope-only, M1) — {res.get('question', node_input.disease)}", ""]
    if res.get("summary"):
        lines += [res["summary"], ""]
    lines.append("## 研究角度（后续 Search 据此展开；完整检索简报待 M2）")
    for i, a in enumerate(angles, 1):
        lines.append(f"{i}. **{a.get('label', '')}**")
        lines.append(f"   - query: {a.get('query', '')}")
        if a.get("rationale"):
            lines.append(f"   - 理由: {a['rationale']}")
    spent = (res.get("budget") or {}).get("spent_tokens")
    if spent:
        lines.append(f"\n_(scope tokens: {spent})_")
    return NodeOutput(
        stage=stage.name, summary="\n".join(lines), candidates=[],
        open_questions=["这是 scope-only 研究计划；完整检索简报（search→verify→synth）待 M2"])


# ----------------------------------------------------------------------------
# dispatch
# ----------------------------------------------------------------------------
async def sdk_worker(stage, node_input: NodeInput, angle: str | None = None) -> NodeOutput:
    if stage.name == "disease-overview":
        if os.environ.get("DD_STAGE0", "simple").lower() == "deep":
            return await _deep_overview_worker(stage, node_input)
        return await _overview_worker(stage, node_input)
    if stage.name == "target-hypothesis":
        return await _hypothesis_worker(stage, node_input, angle)
    if stage.name == "literature-evidence":
        return await _literature_worker(stage, node_input)
    if stage.name == "target-selection":
        return await _selection_worker(stage, node_input)
    if stage.name == "target-validation":
        if angle == "synthesis":                       # gather-side adjudication node
            return await _validation_synthesis(stage, node_input)
        return await _validation_worker(stage, node_input, angle)
    return await dummy_worker(stage, node_input, angle)
