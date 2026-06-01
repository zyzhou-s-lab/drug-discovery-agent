"""Planner node = stateless, typed ValidationPlan.

Dynamically selects validation angles per selected target from a FIXED menu
(mode a; ARCHITECTURE §3.7 A/E). This is the first node that decides "which
angles to run" at runtime — stage-1's angles are hardcoded; stage-4's are planned.

M4a menu = genetic/safety (both OpenTargets-backed). M4b extends with
perturbation/expression/network (heavy local tools: FUSION/GRN_transfer/...).
"""
from __future__ import annotations

from .llm import anthropic_client_and_model
from .schemas import NodeInput, ValidationAnglePlan, ValidationPlan

VALIDATION_MENU = ["genetic", "safety"]


def plan_validation(stage, node_input: NodeInput) -> ValidationPlan:
    """Pick validation angles per selected target. Falls back to ['genetic'] if no plan."""
    targets = [c.get("symbol") for c in (node_input.prior_candidates or []) if c.get("symbol")]
    if not targets:
        return ValidationPlan(disease=node_input.disease, plans=[])

    client, model = anthropic_client_and_model()
    plan_tool = {
        "name": "emit_plan",
        "description": "Emit the validation plan: which angles to run per target.",
        "input_schema": ValidationPlan.model_json_schema(),
    }
    user = (
        f"为下列【选定靶点】规划计算验证角度。疾病：{node_input.disease}。\n"
        f"可选角度菜单（只能从中选）：{VALIDATION_MENU}\n"
        "  - genetic：用独立遗传证据（OpenTargets 遗传关联分解）交叉确认因果性\n"
        "  - safety：用基因约束(gnomAD LoF)+安全负债评估 on-target 风险\n"
        f"选定靶点：{targets}\n"
        "为每个靶点选**最能交叉验证其现有证据**的角度子集（每个靶点 ≥1 个角度），并给 rationale。"
        "用 emit_plan 输出 ValidationPlan（disease + plans:[{target, angles, rationale}]）。"
    )
    resp = client.messages.create(
        model=model, max_tokens=1500,
        messages=[{"role": "user", "content": user}],
        tools=[plan_tool], tool_choice={"type": "tool", "name": "emit_plan"},
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "emit_plan":
            plan = ValidationPlan.model_validate(block.input)
            # defensive: planner must not invent angles outside the menu
            for p in plan.plans:
                p.angles = [a for a in p.angles if a in VALIDATION_MENU] or ["genetic"]
            if not plan.disease:
                plan.disease = node_input.disease
            return plan
    # fallback: validate every target on genetics
    return ValidationPlan(
        disease=node_input.disease,
        plans=[ValidationAnglePlan(target=t, angles=["genetic"]) for t in targets])
