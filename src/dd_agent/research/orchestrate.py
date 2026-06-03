"""Mini orchestration engine for the SDK port of deep-research.

The Workflow engine (agent/parallel/pipeline/phase/log + the `agent({schema})` forced
StructuredOutput) is NOT exposed to claude-agent-sdk / headless sessions, so we reimplement
the few primitives the deep-research script actually uses. This module holds the shared
pieces; phase orchestration lives in scope.py / deep_research.py.

See docs/deep-research-port-plan.md §0, §4.
"""
from __future__ import annotations


def usage_dict(u) -> dict:
    """Normalize a ResultMessage.usage (dict or object) to a plain dict."""
    if u is None:
        return {}
    if isinstance(u, dict):
        return u
    return {k: getattr(u, k, 0) for k in
            ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}


class Budget:
    """Token accounting across phases.

    total_tokens=None → no cap (matches the original deep-research, which bounds work via
    structural caps MAX_FETCH/MAX_VERIFY_CLAIMS/VOTES, not a token budget). Set a cap to
    let callers trip salvage paths via exhausted().

    NB: per-call `usd` comes from ResultMessage.total_cost_usd, which the SDK prices as if
    Claude — unreliable on 3rd-party backends (DeepSeek). Use spent() token counts as the
    budget metric; treat usd as advisory only.
    """

    def __init__(self, total_tokens: int | None = None):
        self.total_tokens = total_tokens
        self.by_phase: dict[str, dict] = {}

    def add(self, phase: str, usage, usd: float = 0.0) -> None:
        b = self.by_phase.setdefault(phase, {"in": 0, "out": 0, "cache": 0, "usd": 0.0, "calls": 0})
        u = usage_dict(usage)
        b["in"] += u.get("input_tokens", 0) or 0
        b["out"] += u.get("output_tokens", 0) or 0
        b["cache"] += u.get("cache_read_input_tokens", 0) or 0
        b["usd"] += usd or 0.0
        b["calls"] += 1

    def spent(self) -> int:
        return sum(p["in"] + p["out"] for p in self.by_phase.values())

    def exhausted(self) -> bool:
        return bool(self.total_tokens) and self.spent() >= self.total_tokens

    def report(self) -> dict:
        return {"spent_tokens": self.spent(), "by_phase": self.by_phase}
