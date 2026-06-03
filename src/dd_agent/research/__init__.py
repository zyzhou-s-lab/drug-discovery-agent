"""deep-research → SDK port (stage-0 disease-overview, reusable engine).

Plan & rationale: docs/deep-research-port-plan.md
M1 (this slice): Scope — decompose a disease into characterization angles, with
token accounting (Budget). Search/Fetch/Verify/Synthesize land in M2.
"""
from .orchestrate import Budget
from .scope import SCOPE_PROMPT, SCOPE_SCHEMA, scope

__all__ = ["Budget", "scope", "SCOPE_PROMPT", "SCOPE_SCHEMA"]
