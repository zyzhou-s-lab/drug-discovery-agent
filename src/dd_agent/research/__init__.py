"""deep-research → SDK port (stage-0 disease-overview, reusable engine).

Plan & rationale: docs/deep-research-port-plan.md
M1: Scope — decompose a disease into characterization angles, with token accounting (Budget).
M2 (this slice): research() — the full Search→Fetch→Verify→Synthesize engine.
"""
from .deep_research import (
    EXTRACT_SCHEMA, REPORT_SCHEMA, SEARCH_SCHEMA, VERDICT_SCHEMA,
    dedup_results, norm_url, rank_claims, research, survives,
)
from .orchestrate import Budget, run_agent
from .scope import SCOPE_PROMPT, SCOPE_SCHEMA, scope

__all__ = [
    "Budget", "run_agent", "scope", "SCOPE_PROMPT", "SCOPE_SCHEMA",
    "research", "norm_url", "dedup_results", "rank_claims", "survives",
    "SEARCH_SCHEMA", "EXTRACT_SCHEMA", "VERDICT_SCHEMA", "REPORT_SCHEMA",
]
