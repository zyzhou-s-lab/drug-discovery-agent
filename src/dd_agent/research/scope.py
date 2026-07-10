"""deep-research stage-0: Scope — decompose a disease into characterization angles.

BACKGROUND characterization for downstream drug-target discovery — NOT target nomination
(that is stage-1). The angles drive the later parallel Search; surfaced to the user for
review (scope-checkpoint) before the expensive search/fetch/verify phases.

Tool strategy = "default + additive": only mcp_servers is added (the submit_angles tool);
allowed_tools is NOT narrowed, so the agent keeps the default toolset (incl. WebSearch).
The prompt simply does not ask it to search, so it doesn't (verified M1: web_search_requests=0).

See docs/deep-research-port-plan.md §5.
"""
from __future__ import annotations

from .orchestrate import Budget

SCOPE_PROMPT = """Decompose this disease into complementary research angles for a DISEASE-OVERVIEW brief
that will focus downstream drug-target discovery. This is BACKGROUND CHARACTERIZATION of
the disease — NOT target nomination or scoring.

## Disease
{QUESTION}

## Task
Generate distinct, high-signal search queries that together characterize the disease from
these complementary angles. Cover every angle that applies; merge or drop one only if it is
clearly irrelevant for this disease:
1. Disease definition, subtypes & clinical classification
2. Affected tissues, cell types & key anatomy
3. Core pathological mechanisms (molecular & cellular)
4. Genetic architecture & heritability (risk loci to be identified by search) — the strongest target prior
5. Dysregulated pathways & gene families
6. Therapeutic landscape & clinical-trial status

For each angle: a `label`, a `query`, and a 1-2 sentence `rationale` for why it matters to
target discovery. Avoid redundancy.

Write each `query` as a SEARCH GOAL — describe WHAT to find for that angle, specific about the
DIMENSION and METHODS (e.g. GWAS / rare & LoF variants / single-cell / pathway enrichment /
approved drugs & trials). Do NOT pre-name specific genes, proteins, or drugs from prior
knowledge — discovering those is the downstream search's job; pre-baking unverified names
anchors the search and is not traceable.

Return the disease (verbatim or lightly normalized) and the angles. Call `submit_angles`
exactly once with {question, angles}; that is your only output (no prose answer, no
Sources list, no extra summary)."""

# @tool input schema (dd-agent convention: name -> python type). Nested angle shape
# (label/query/rationale) is steered by the prompt, like worker.submit_result's `candidates`.
# No `summary` field: it only made the model paraphrase the task (read like a leaked prompt).
SCOPE_SCHEMA = {"question": str, "angles": list}


async def scope(disease: str, budget: Budget | None = None, on_message=None) -> dict | None:
    """Run the Scope phase. Returns {question, summary, angles[], budget} or None if the
    agent never submitted. Caller (API/worker) drives env + asyncio.

    on_message(msg): optional callback per SDK message — the worker passes _emit_stream so
    the run UI shows live step cards (parity with _run_session). Kept as a callback so this
    module stays decoupled from events.py.
    """
    from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server, query, tool

    budget = budget or Budget()
    cap: dict = {}

    @tool("submit_angles", "Submit the decomposition. Call exactly once when done.", SCOPE_SCHEMA)
    async def _submit(args):
        cap["v"] = args
        return {"content": [{"type": "text", "text": "recorded"}]}

    opts = ClaudeAgentOptions(
        mcp_servers={"scope": create_sdk_mcp_server("scope", "1.0.0", [_submit])},
        permission_mode="bypassPermissions",
        max_turns=6,
        # Don't inherit the host's CLAUDE.md / settings. On gpu the user-level CLAUDE.md
        # carries a "MemOS auto-memory" block (search_memory/add_message every turn); that
        # MCP isn't mounted here, so the scope agent just ruminates about it in `thinking`.
        # DeepSeek routing comes from the uvicorn process env, not settings.json, so [] is safe.
        setting_sources=[],
    )
    async for msg in query(prompt=SCOPE_PROMPT.replace("{QUESTION}", disease), options=opts):
        if on_message is not None:
            try:
                on_message(msg)
            except Exception:  # noqa: BLE001 — streaming is best-effort, never break scope
                pass
        if type(msg).__name__ == "ResultMessage":
            budget.add("scope", getattr(msg, "usage", None), getattr(msg, "total_cost_usd", 0) or 0)

    out = cap.get("v")
    if out is not None:
        out["budget"] = budget.report()
    return out
