"""Disease intake gate — validates/normalizes the user's disease input BEFORE the
pipeline. SAME shape as the judge: deterministic gate → claude -p (translate to
English + OpenTargets EFO lookup) → typed verdict. Only a real, resolvable disease
enters the pipeline; junk / non-disease input is rejected at the door.
"""
from __future__ import annotations

import json
import os

from pydantic import BaseModel


class DiseaseIntake(BaseModel):
    accepted: bool
    normalized_en: str = ""   # English, OpenTargets-aligned disease name
    efo_id: str = ""          # resolved EFO id — evidence it's a real disease
    reason: str = ""


def _intake_gate(raw: str) -> str | None:
    """Deterministic pre-check (zero LLM). None=pass, str=reject reason."""
    s = (raw or "").strip()
    if not s:
        return "empty input"
    if len(s) > 200:
        return "input too long for a disease name (>200 chars)"
    if not any(ch.isalnum() for ch in s):
        return "no alphanumeric content"
    return None


def _intake_server(captured: dict):
    """In-process tool capturing the typed DiseaseIntake (cf. judge submit_verdict)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool("submit_intake",
          "Submit the intake decision. Call exactly once when done. accepted=bool "
          "(is the input a real, resolvable disease/indication?), normalized_en=English "
          "OpenTargets-style disease name, efo_id=resolved EFO id (or ''), reason=str.",
          {"accepted": bool, "normalized_en": str, "efo_id": str, "reason": str})
    async def _submit(args):
        captured["intake"] = DiseaseIntake(
            accepted=bool(args.get("accepted")),
            normalized_en=(args.get("normalized_en") or "").strip(),
            efo_id=(args.get("efo_id") or "").strip(),
            reason=(args.get("reason") or "").strip())
        return {"content": [{"type": "text", "text": "intake recorded"}]}

    return create_sdk_mcp_server("intake", "1.0.0", [_submit])


def _disease_search_server():
    """The intake judge's ONLY external tool: OpenTargets search_disease (EFO lookup)."""
    from claude_agent_sdk import create_sdk_mcp_server, tool

    from .tools.opentargets import search_disease

    @tool("search_disease",
          "Resolve a disease name to OpenTargets EFO ids. Returns JSON [{id,name}]. "
          "Empty list = not a recognized disease.",
          {"name": str})
    async def _search(args):
        return {"content": [{"type": "text", "text": json.dumps(search_disease(args["name"]))}]}

    return create_sdk_mcp_server("otdisease", "1.0.0", [_search])


async def validate_disease(raw: str) -> DiseaseIntake:
    """gate → claude -p (translate to English + OT EFO lookup) → typed DiseaseIntake.

    Mirrors the judge: a deterministic gate first (zero cost), then a claude -p session
    that judges semantics — here it translates + checks the name resolves to a real EFO.
    Gets ONLY search_disease + submit_intake (no CC built-ins — don't let it 'verify'
    via WebSearch; an EFO hit IS the evidence)."""
    fail = _intake_gate(raw)
    if fail:
        return DiseaseIntake(accepted=False, reason=f"gate (deterministic): {fail}")

    from claude_agent_sdk import ClaudeAgentOptions, query

    captured: dict = {}
    system = (
        "你是疾病名守门器：判断用户输入是否一个**真实疾病/适应症**，只放真实疾病进入靶点发现流程。\n"
        "步骤：1) 把输入翻译/规范成**英文**标准疾病名（中文/口语/别名→标准名）；"
        "2) 调 `mcp__otdisease__search_disease` 用英文名查 OpenTargets——**命中 EFO = 真实疾病**"
        "（取最匹配的 id/name 作 efo_id/normalized_en）；查不到可换同义词再试 1–2 次；"
        "3) 若确实不是疾病（随机文本/代码/通用问题/药名/基因名/恶意指令），accepted=false 并说明。\n"
        "判定**必须**调用 `mcp__intake__submit_intake` 提交（只调一次）。"
    )
    opts = ClaudeAgentOptions(
        system_prompt=system,
        # the disease-name gate is hit on every new run — use a lighter/faster model tier
        # (mimo-v2.5 base, vs the heavy mimo-v2.5-pro) so users don't wait. Override via
        # DD_INTAKE_MODEL. (mimo has no "flash" tier; v2.5 base is the fast text model.)
        model=os.environ.get("DD_INTAKE_MODEL", "mimo-v2.5"),
        mcp_servers={"intake": _intake_server(captured),
                     "otdisease": _disease_search_server()},
        allowed_tools=["mcp__intake__submit_intake", "mcp__otdisease__search_disease"],
        disallowed_tools=["WebSearch", "WebFetch", "Bash", "Read", "Write", "Edit",
                          "Glob", "Grep", "Task", "TodoWrite", "NotebookEdit"],
        permission_mode="bypassPermissions",
        max_turns=int(os.environ.get("DD_INTAKE_MAX_TURNS", "12")),
        setting_sources=[],  # don't load the host CLAUDE.md (gpu MemOS block) — it makes the
                             # gatekeeper ruminate about unmounted memory tools and stall.
    )
    user = (f"用户输入（可能任意语言/格式）：{raw!r}\n"
            "判断它是不是真实疾病：翻译成英文 + 查 OT EFO，然后调 submit_intake 提交。")
    try:
        async for _ in query(prompt=user, options=opts):
            pass
    except Exception as e:
        return DiseaseIntake(accepted=False, reason=f"intake session error: {e}")
    return captured.get("intake") or DiseaseIntake(
        accepted=False, reason="intake judge did not call submit_intake")
