"""Mini orchestration engine for the SDK port of deep-research.

The Workflow engine (agent/parallel/pipeline/phase/log + the `agent({schema})` forced
StructuredOutput) is NOT exposed to claude-agent-sdk / headless sessions, so we reimplement
the few primitives the deep-research script actually uses. This module holds the shared
pieces; phase orchestration lives in scope.py / deep_research.py.

See docs/deep-research-port-plan.md §0, §4.
"""
from __future__ import annotations


async def run_agent(phase, prompt, submit_name, schema, extra_mcp, budget, sem,
                    on_message=None, max_turns: int = 12, should_stop=None):
    """One isolated forced-tool agent = deep-research's `agent({schema})` primitive.

    The Workflow engine's forced StructuredOutput isn't available in the SDK, so the
    "force" is prompt-driven: the prompt's only completion action is to call `submit_name`.
    Returns the submitted args dict, or None if the agent never called it (prose-ended /
    errored / budget-exhausted) — callers treat None as "drop this unit / salvage".

    Tool strategy = "default + additive" (plan §2.1): only mcp_servers is set, allowed_tools
    is NOT narrowed, so the agent keeps the default toolset (WebSearch/WebFetch) plus these
    MCP tools. setting_sources=[] so the host CLAUDE.md (gpu's MemOS block) doesn't leak in.
    """
    import asyncio  # noqa: F401  (kept local; engine is import-light for testability)

    from claude_agent_sdk import (
        ClaudeAgentOptions, create_sdk_mcp_server, query, tool,
    )

    # cooperative cancel: a stopped run starts no new agents (in-flight ones drain naturally),
    # which bounds further token spend. Checked before acquiring the semaphore so queued
    # agents return immediately.
    if (should_stop is not None and should_stop()) or budget.exhausted():
        return None

    cap: dict = {}

    @tool(submit_name, "Submit the structured result. Call exactly once when done.", schema)
    async def _submit(args):
        cap["v"] = args
        return {"content": [{"type": "text", "text": "recorded"}]}

    servers = {"submit": create_sdk_mcp_server("submit", "1.0.0", [_submit])}
    servers.update(extra_mcp or {})
    opts = ClaudeAgentOptions(
        mcp_servers=servers,
        permission_mode="bypassPermissions",
        max_turns=max_turns,
        setting_sources=[],
    )
    async with sem:
        try:
            async for msg in query(prompt=prompt, options=opts):
                if on_message is not None:
                    try:
                        on_message(msg)
                    except Exception:  # noqa: BLE001 — streaming is best-effort
                        pass
                if type(msg).__name__ == "ResultMessage":
                    budget.add(phase, getattr(msg, "usage", None), getattr(msg, "total_cost_usd", 0) or 0)
        except Exception:  # noqa: BLE001
            # An agent that errors (e.g. "max turns", a web agent that kept searching and
            # never called submit_*) must NOT crash the whole gather. Drop it to None — the
            # blueprint's resilience: fetch→drop source, verify→abstain (handled by survives()).
            return cap.get("v")
    return cap.get("v")


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
