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

Return: the disease (verbatim or lightly normalized), a 1-2 sentence decomposition strategy,
and the angles. Call `submit_angles` exactly once with {question, summary, angles};
that is your only output (no prose answer, no Sources list)."""

# @tool input schema (dd-agent convention: name -> python type). Nested angle shape
# (label/query/rationale) is steered by the prompt, like worker.submit_result's `candidates`.
SCOPE_SCHEMA = {"question": str, "summary": str, "angles": list}


async def scope(disease: str, budget: Budget | None = None) -> dict | None:
    """Run the Scope phase. Returns {question, summary, angles[], budget} or None if the
    agent never submitted. Caller (API/worker) drives env + asyncio."""
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
    )
    async for msg in query(prompt=SCOPE_PROMPT.replace("{QUESTION}", disease), options=opts):
        if type(msg).__name__ == "ResultMessage":
            budget.add("scope", getattr(msg, "usage", None), getattr(msg, "total_cost_usd", 0) or 0)

    out = cap.get("v")
    if out is not None:
        out["budget"] = budget.report()
    return out
