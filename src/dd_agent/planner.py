"""Planner node = stateless, typed ValidationPlan.

Dynamically selects validation angles per selected target from a FIXED menu
(mode a; ARCHITECTURE §3.7 A/E). stage-1 angles are hardcoded; stage-4's are planned.

Form = claude -p (Agent SDK session + `submit_plan` in-process tool = typed) +
deterministic gate — SAME shape as the judge (gate + claude -p + typed output),
unified 2026-06-02 (was raw Messages API forced-tool: unstable std~0.2, no gate,
no menu-clamp at submit time).

M4a menu = genetic/safety (both OpenTargets-backed). M4b extends with
perturbation/expression/network (heavy local tools: FUSION/GRN_transfer/...).
"""
from __future__ import annotations

import os

from .schemas import NodeInput, ValidationAnglePlan, ValidationPlan

VALIDATION_MENU = ["genetic", "safety"]


def _plan_server(captured: dict, disease: str):
    """In-process SDK MCP tool that captures the typed ValidationPlan (cf. submit_verdict)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("submit_plan",
          "Submit the validation plan. Call exactly once when done. plans = list of "
          "{target:str, angles:[str] (only from the menu), rationale:str}.",
          {"plans": list})
    async def _submit(args):
        plans = []
        for p in args.get("plans", []) or []:
            plans.append(ValidationAnglePlan(
                target=p.get("target", ""),
                angles=p.get("angles") or [],
                rationale=p.get("rationale", "")))
        captured["plan"] = ValidationPlan(disease=disease, plans=plans)
        return {"content": [{"type": "text", "text": f"plan recorded ({len(plans)} targets)"}]}

    return create_sdk_mcp_server("plan", "1.0.0", [_submit])


async def plan_validation(stage, node_input: NodeInput) -> ValidationPlan:
    """gate → claude -p (typed via submit_plan) → menu-clamp. Falls back to ['genetic']/target."""
    targets = [c.get("symbol") for c in (node_input.prior_candidates or []) if c.get("symbol")]
    if not targets:                                  # gate: nothing selected upstream
        return ValidationPlan(disease=node_input.disease, plans=[])

    from claude_agent_sdk import ClaudeAgentOptions, query

    captured: dict = {}
    system = (
        "你是 stage-4 验证规划器。为每个【选定靶点】从固定菜单选计算验证角度。\n"
        f"可选角度菜单（**只能**从中选）：{VALIDATION_MENU}\n"
        "  - genetic：用独立遗传证据（OpenTargets 遗传关联分解）交叉确认因果性\n"
        "  - safety：用基因约束(gnomAD LoF)+安全负债评估 on-target 风险\n"
        "为每个靶点选**最能交叉验证其现有证据**的角度子集（每个靶点 ≥1 个），并给 rationale。"
        "完成后**必须**调用 `mcp__plan__submit_plan` 提交（只调一次，不要只用文字回答）。"
    )
    opts = ClaudeAgentOptions(
        system_prompt=system,
        mcp_servers={"plan": _plan_server(captured, node_input.disease)},
        allowed_tools=["mcp__plan__submit_plan"],     # plans, doesn't act (cf. judge §3.4)
        disallowed_tools=["WebSearch", "WebFetch", "Bash", "Read", "Write", "Edit",
                          "Glob", "Grep", "Task", "TodoWrite", "NotebookEdit"],
        permission_mode="bypassPermissions",
        max_turns=int(os.environ.get("DD_PLANNER_MAX_TURNS", "12")),
    )
    user = (f"疾病：{node_input.disease}\n选定靶点：{targets}\n"
            "为每个靶点选验证角度（genetic/safety），然后调 submit_plan 提交。")
    try:
        async for _ in query(prompt=user, options=opts):
            pass
    except Exception:
        pass  # fall through to the fallback below

    plan = captured.get("plan")
    if plan is None or not plan.plans:               # no plan → validate every target on genetics
        return ValidationPlan(
            disease=node_input.disease,
            plans=[ValidationAnglePlan(target=t, angles=["genetic"]) for t in targets])
    # deterministic gate: planner must not invent angles outside the menu
    for p in plan.plans:
        p.angles = [a for a in p.angles if a in VALIDATION_MENU] or ["genetic"]
    if not plan.disease:
        plan.disease = node_input.disease
    return plan
