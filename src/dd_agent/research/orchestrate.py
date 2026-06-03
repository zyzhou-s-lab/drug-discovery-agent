"""Mini orchestration engine for the SDK port of deep-research.

The Workflow engine (agent/parallel/pipeline/phase/log + the `agent({schema})` forced
StructuredOutput) is NOT exposed to claude-agent-sdk / headless sessions, so we reimplement
the few primitives the deep-research script actually uses. This module holds the shared
pieces; phase orchestration lives in scope.py / deep_research.py.

See docs/deep-research-port-plan.md §0, §4.
"""
from __future__ import annotations


def _schema_errors(args, schema) -> list[str]:
    """Shallow JSON-Schema check (top-level required / type / enum). Mirrors CC's
    StructuredOutput validation: a submit_* call with a bad shape is rejected so the model
    re-submits (instead of us silently accepting garbage). Nested array items are prompt-
    steered, so we don't deep-validate them (avoid over-rejecting)."""
    errs: list[str] = []
    if not isinstance(args, dict):
        return ["input must be a JSON object"]
    if not isinstance(schema, dict):
        return errs
    is_json_schema = schema.get("type") == "object" or "properties" in schema
    if is_json_schema:
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in args or args.get(req) in (None, ""):
                errs.append(f"missing required field '{req}'")
        for k, spec in props.items():
            if k not in args or not isinstance(spec, dict):
                continue
            v = args[k]
            if "enum" in spec and v not in spec["enum"]:
                errs.append(f"'{k}'={v!r} must be one of {spec['enum']}")
            t = spec.get("type")
            if t == "string" and not isinstance(v, str):
                errs.append(f"'{k}' must be a string")
            elif t == "array" and not isinstance(v, list):
                errs.append(f"'{k}' must be an array")
            elif t == "boolean" and not isinstance(v, bool):
                errs.append(f"'{k}' must be a boolean")
            elif t == "object" and not isinstance(v, dict):
                errs.append(f"'{k}' must be an object")
    else:  # simple {name: type} form (scope-style)
        for k in schema:
            if k not in args or args.get(k) in (None, ""):
                errs.append(f"missing field '{k}'")
    return errs


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
        ClaudeAgentOptions, ClaudeSDKClient, create_sdk_mcp_server, tool,
    )

    # cooperative cancel: a stopped run starts no new agents (in-flight ones drain naturally),
    # which bounds further token spend. Checked before acquiring the semaphore so queued
    # agents return immediately.
    if (should_stop is not None and should_stop()) or budget.exhausted():
        return None

    cap: dict = {}

    @tool(submit_name, "Submit the structured result. Call exactly once when done.", schema)
    async def _submit(args):
        # Validate like CC's StructuredOutput: reject a bad shape so the model re-submits
        # (the error tool result tells it what to fix) instead of us accepting garbage.
        errs = _schema_errors(args, schema)
        if errs:
            return {"content": [{"type": "text", "text":
                    "Your input failed validation: " + "; ".join(errs[:5])
                    + f". Call {submit_name} again with corrected fields — the tool input IS your answer."}],
                    "is_error": True}
        cap["v"] = args
        return {"content": [{"type": "text", "text": "recorded"}]}

    servers = {"submit": create_sdk_mcp_server("submit", "1.0.0", [_submit])}
    servers.update(extra_mcp or {})

    # Optional model override for deep-research agents (DD_DR_MODEL). Default unset → inherit the
    # process env (DeepSeek). Set DD_DR_MODEL (+ DD_DR_BASE_URL / DD_DR_AUTH_TOKEN) to route these
    # agents to a faster / forced-output-honoring backend (e.g. mimo-v2.5-pro) without changing
    # the rest of dd-agent. ClaudeAgentOptions.env merges over os.environ (SDK), so only overrides
    # are needed.
    import os
    extra_opts: dict = {}
    dr_model = os.environ.get("DD_DR_MODEL")
    if dr_model:
        env_over = {"ANTHROPIC_MODEL": dr_model}
        if os.environ.get("DD_DR_BASE_URL"):
            env_over["ANTHROPIC_BASE_URL"] = os.environ["DD_DR_BASE_URL"]
        if os.environ.get("DD_DR_AUTH_TOKEN"):
            env_over["ANTHROPIC_AUTH_TOKEN"] = os.environ["DD_DR_AUTH_TOKEN"]
        extra_opts["model"] = dr_model
        extra_opts["env"] = env_over

    opts = ClaudeAgentOptions(
        mcp_servers=servers,
        permission_mode="bypassPermissions",
        max_turns=max_turns,
        setting_sources=[],
        **extra_opts,
    )

    # Bounded in-session nudge (DD_DR_NUDGE, default 2 = CC's SubagentStop bound): if the agent
    # ends a turn without a VALID submit_name (prose-ended, gave up, or its submit failed the
    # schema check above), re-prompt it in the SAME session — preserving its work. Verbatim
    # from CC's bundled Workflow ("You did not call X. You MUST call X …"). Bounded so it can't
    # become the old "retry storm".
    max_nudges = int(os.environ.get("DD_DR_NUDGE", "2"))
    nudge = (f"You did not call `{submit_name}`. You MUST call `{submit_name}` to return your "
             f"answer — the tool input IS your answer, in the required schema. Call it now.")

    async def _drain(client):
        async for msg in client.receive_response():
            if on_message is not None:
                try:
                    on_message(msg)
                except Exception:  # noqa: BLE001 — streaming is best-effort
                    pass
            if type(msg).__name__ == "ResultMessage":
                budget.add(phase, getattr(msg, "usage", None), getattr(msg, "total_cost_usd", 0) or 0)

    async with sem:
        try:
            async with ClaudeSDKClient(options=opts) as client:
                await client.query(prompt)
                await _drain(client)
                attempt = 0
                while cap.get("v") is None and attempt < max_nudges:
                    if (should_stop is not None and should_stop()) or budget.exhausted():
                        break
                    attempt += 1
                    await client.query(nudge)
                    await _drain(client)
        except Exception:  # noqa: BLE001
            # An agent that errors (max turns / failing tool loop) must NOT crash the gather —
            # drop to None (fetch→drop source, verify→abstain via survives()).
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
