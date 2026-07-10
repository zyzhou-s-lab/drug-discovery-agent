"""Shared Anthropic client construction.

Reuses the box's claude code config (ANTHROPIC_AUTH_TOKEN/BASE_URL/MODEL, e.g. an
Anthropic-compatible relay like DeepSeek); DD_JUDGE_* overrides. Used by both the
judge and the planner so the typed-output call site is identical.
"""
from __future__ import annotations

import os


def anthropic_client_and_model():
    """Return (anthropic.Anthropic, model_name) from env. Supports x-api-key or Bearer."""
    import anthropic

    key = os.environ.get("DD_JUDGE_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    token = os.environ.get("ANTHROPIC_AUTH_TOKEN")
    base_url = os.environ.get("DD_JUDGE_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL")
    kw: dict = {}
    if base_url:
        kw["base_url"] = base_url
    if key:
        kw["api_key"] = key
    elif token:
        kw["auth_token"] = token
    model = os.environ.get("DD_JUDGE_MODEL") or os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-4-5"
    return anthropic.Anthropic(**kw), model
