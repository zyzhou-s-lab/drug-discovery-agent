"""Capture the Claude Agent SDK message stream as a per-stage JSONL event log.

This is "路子一" (the headless SDK path HAPI uses in cli/src/claude/sdk/query.ts):
iterate the SDK message stream and persist each content block (thinking / text /
tool_use / tool_result / result) so the frontend can render live HAPI-style step
cards. The worker previously did `async for _ in query(): pass` and discarded it.

Storage: one JSONL per stage at  {artifacts}/{campaign}/events/{stage}.jsonl.
Each line: {seq, ts, stage, label, type, ...fields}. `label` is the scatter angle
(e.g. "genetic") or "main" for single-session stages, so a stage's parallel angle
sessions interleave into one ordered log distinguished by `label`.

The run thread sets `events_dir_var` (a ContextVar, inherited by the asyncio tasks
the Runner spawns); the worker calls emit(); the API reads via read_stage_events().
"""
from __future__ import annotations

import contextvars
import json
import os
import threading
import time

events_dir_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("dd_events_dir", default=None)

_seq_lock = threading.Lock()
_seq = 0

_MAX_FIELD = 6000  # cap large tool inputs / results so the log stays renderable


def _next_seq() -> int:
    global _seq
    with _seq_lock:
        _seq += 1
        return _seq


def _cap(value):
    """JSON-serializable, size-capped copy of a field (truncate huge strings/dicts)."""
    try:
        s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    except Exception:
        s = str(value)
    if len(s) > _MAX_FIELD:
        return s[:_MAX_FIELD] + f"… (+{len(s) - _MAX_FIELD} chars)"
    return value if not isinstance(value, str) else value if len(value) <= _MAX_FIELD else s


def emit(stage: str, label: str, type: str, **fields) -> None:
    d = events_dir_var.get()
    if not d:
        return
    os.makedirs(d, exist_ok=True)
    rec = {"seq": _next_seq(), "ts": time.time(), "stage": stage, "label": label, "type": type}
    rec.update({k: _cap(v) for k, v in fields.items()})
    path = os.path.join(d, f"{stage}.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def read_stage_events(artifacts_root: str, campaign: str, stage: str) -> list[dict]:
    path = os.path.join(artifacts_root, campaign, "events", f"{stage}.jsonl")
    if not os.path.exists(path):
        return []
    out: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    out.sort(key=lambda r: r.get("seq", 0))
    return out
