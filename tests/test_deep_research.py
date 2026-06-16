"""Unit tests for deep-research M2 pure logic (no SDK / no network).

Covers the verbatim-ported helpers: norm_url, dedup_results (seen/fetchSlots/relRank),
rank_claims (importance→quality), survives (quorum + abstention handling). The orchestration
(research()) needs live agents and is exercised on gpu, not here.
"""
from dd_agent.research.deep_research import (
    MAX_VERIFY_CLAIMS, dedup_results, norm_url, rank_claims, survives,
)


def test_norm_url_strips_www_scheme_trailing_slash():
    a = norm_url("https://www.Example.com/Foo/")
    b = norm_url("http://example.com/Foo")
    assert a == b == "example.com/foo"


def test_norm_url_bad_input_falls_back_lowercase():
    assert norm_url("not a url") == "not a url"


def test_dedup_drops_duplicate_urls():
    seen, dupes, dropped, slots = {}, [], [], [15]
    res = [{"url": "https://a.com/x", "title": "A", "relevance": "high"},
           {"url": "https://www.a.com/x/", "title": "A dup", "relevance": "medium"}]
    novel = dedup_results(res, "g", seen, slots, dupes, dropped)
    assert len(novel) == 1 and len(dupes) == 1 and slots[0] == 14


def test_dedup_respects_fetch_budget_for_non_high():
    seen, dupes, dropped, slots = {}, [], [], [0]  # no slots left
    res = [{"url": "https://a.com/1", "title": "hi", "relevance": "high"},
           {"url": "https://b.com/2", "title": "med", "relevance": "medium"}]
    novel = dedup_results(res, "g", seen, slots, dupes, dropped)
    # high relevance bypasses the budget gate; medium is dropped when slots<=0
    assert [n["url"] for n in novel] == ["https://a.com/1"]
    assert len(dropped) == 1 and slots[0] == -1


def test_dedup_papers_by_doi():
    seen, dupes, dropped, slots = {}, [], [], [15]
    res = [{"doi": "10.1/AbC", "title": "P", "relevance": "high", "source_type": "paper"},
           {"doi": "10.1/abc", "title": "P dup", "relevance": "medium", "source_type": "paper"},
           {"url": "https://x.com/p", "title": "web", "relevance": "high", "source_type": "web"}]
    novel = dedup_results(res, "g", seen, slots, dupes, dropped)
    # the two papers (same DOI, case-insensitive) collapse to one; web is separate
    assert len(novel) == 2 and len(dupes) == 1


def test_dedup_orders_by_relevance():
    seen, dupes, dropped, slots = {}, [], [], [15]
    res = [{"url": "https://a.com/low", "title": "l", "relevance": "low"},
           {"url": "https://a.com/high", "title": "h", "relevance": "high"}]
    novel = dedup_results(res, "g", seen, slots, dupes, dropped)
    assert novel[0]["relevance"] == "high"  # high processed first


def test_rank_claims_importance_then_quality():
    claims = [
        {"claim": "c1", "importance": "tangential", "sourceQuality": "primary"},
        {"claim": "c2", "importance": "central", "sourceQuality": "blog"},
        {"claim": "c3", "importance": "central", "sourceQuality": "primary"},
    ]
    ranked = rank_claims(claims)
    assert [c["claim"] for c in ranked] == ["c3", "c2", "c1"]


def test_rank_claims_caps_at_ceiling():
    # whole central+primary tier is verified, but capped at the 80 safety ceiling
    claims = [{"claim": f"c{i}", "importance": "central", "sourceQuality": "primary"}
              for i in range(90)]
    assert len(rank_claims(claims)) == 80


def test_survives_needs_quorum_and_few_refutes():
    assert survives([{"refuted": False}, {"refuted": False}, {"refuted": True}]) is True
    assert survives([{"refuted": True}, {"refuted": True}, {"refuted": False}]) is False


def test_survives_too_many_abstentions_fails():
    # only one valid vote (two abstained as None) → not adjudicated → must not survive
    assert survives([{"refuted": False}, None, None]) is False


def test_survives_all_abstain_fails():
    assert survives([None, None, None]) is False


# ─── Orchestration (run_agent monkeypatched — no network) ───
import asyncio
import pytest  # noqa: E402

from dd_agent.research import deep_research as dr  # noqa: E402

_ANGLE = [{"label": "g", "query": "q", "rationale": "r"}]


def _patch_agent(fake):
    """Swap deep_research.run_agent for a fake; return a restore() callable.
    run_agent now returns (result, tools); wrap single-value fakes so each call still
    yields just the result with an empty tool list — keeps the fakes terse."""
    orig = dr.run_agent

    async def adapted(*a, **kw):
        out = await fake(*a, **kw)
        return out if isinstance(out, tuple) else (out, [])

    dr.run_agent = adapted
    return lambda: setattr(dr, "run_agent", orig)


def test_research_happy_path_returns_report():
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12, **kw):
        return {
            "submit_results": {"results": [{"url": "https://x.com/a", "title": "A", "relevance": "high"}]},
            "submit_claims": {"sourceQuality": "primary",
                              "claims": [{"claim": "C1", "quote": "q", "importance": "central"}]},
            "submit_verdict": {"refuted": False, "evidence": "e", "confidence": "high"},
            "submit_report": {"summary": "S", "caveats": "none",
                              "findings": [{"claim": "C1", "confidence": "high",
                                            "sources": ["https://x.com/a"], "evidence": "e"}]},
        }[submit]
    restore = _patch_agent(fake)
    try:
        r = asyncio.run(dr.research("Q", _ANGLE))
    finally:
        restore()
    assert r["stats"]["confirmed"] == 1 and r["stats"]["afterSynthesis"] == 1
    assert r["findings"][0]["claim"] == "C1"


def test_research_no_claims_salvage():
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12, **kw):
        if submit == "submit_results":
            return {"results": [{"url": "https://x.com/a", "title": "A", "relevance": "high"}]}
        if submit == "submit_claims":
            return {"sourceQuality": "unreliable", "claims": []}  # nothing extracted
        return None
    restore = _patch_agent(fake)
    try:
        r = asyncio.run(dr.research("Q", _ANGLE))
    finally:
        restore()
    assert r["findings"] == [] and r["stats"]["claims"] == 0
    assert "No claims" in r["summary"]


def test_schema_errors_validates_required_enum_type():
    from dd_agent.research.orchestrate import _schema_errors
    schema = {"type": "object", "required": ["results"], "properties": {
        "results": {"type": "array"}, "refuted": {"type": "boolean"},
        "confidence": {"enum": ["high", "medium", "low"]}}}
    assert _schema_errors({"results": []}, schema) == []  # valid
    assert any("results" in e for e in _schema_errors({}, schema))  # missing required
    assert any("array" in e for e in _schema_errors({"results": "x"}, schema))  # wrong type
    assert any("confidence" in e for e in
               _schema_errors({"results": [], "confidence": "bad"}, schema))  # bad enum
    # simple {name: type} form (scope-style)
    assert _schema_errors({"question": "q", "angles": []}, {"question": str, "angles": list}) == []
    assert any("question" in e for e in _schema_errors({"angles": []}, {"question": str, "angles": list}))


def test_bibliography_groups_cited_sources():
    from dd_agent.research.deep_research import _bibliography
    confirmed = [
        {"claim": "c1", "source_type": "web", "sourceUrl": "https://a.com/x"},
        {"claim": "c2", "source_type": "database", "sourceUrl": "https://ebi.ac.uk/ols4/efo"},
    ]
    all_sources = [
        {"source_type": "web", "url": "https://a.com/x", "title": "A"},
        {"source_type": "database", "url": "https://ebi.ac.uk/ols4/efo", "title": "EFO"},
        {"source_type": "web", "url": "https://uncited.com/z", "title": "Z"},  # not in confirmed
    ]
    refs = _bibliography(confirmed, all_sources)
    # ONE unified, sequentially-numbered list; uncited source excluded; no paper sources
    assert [r["n"] for r in refs] == [1, 2]
    assert [r["url"] for r in refs if r["kind"] == "web"] == ["https://a.com/x"]
    assert [r["title"] for r in refs if r["kind"] == "database"] == ["EFO"]
    assert all(r["kind"] != "paper" for r in refs)
    assert "https://uncited.com/z" not in [r.get("url") for r in refs]


def test_research_all_refuted_salvage():
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12, **kw):
        if submit == "submit_results":
            return {"results": [{"url": "https://x.com/a", "title": "A", "relevance": "high"}]}
        if submit == "submit_claims":
            return {"sourceQuality": "blog",
                    "claims": [{"claim": "weak", "quote": "q", "importance": "central"}]}
        if submit == "submit_verdict":
            return {"refuted": True, "evidence": "debunked", "confidence": "high"}
        return None  # synth never reached
    restore = _patch_agent(fake)
    try:
        r = asyncio.run(dr.research("Q", _ANGLE))
    finally:
        restore()
    assert r["findings"] == [] and r["stats"]["confirmed"] == 0
    assert len(r["refuted"]) == 1 and "refuted" in r["summary"]


# ─── _synth_block: raw DB records appended to SYNTH_PROMPT (MAX_DB_RAW total cap) ───
def test_synth_block_includes_db_records_under_cap():
    from dd_agent.research.deep_research import _synth_block
    db = [{"sourceUrl": "db://efo", "sourceQuality": "primary", "raw": "EFO:0001 label=AMD"}]
    out = _synth_block([], db)
    assert "db://efo" in out and "EFO:0001 label=AMD" in out
    assert "truncated" not in out


def test_synth_block_caps_total_db_raw():
    from dd_agent.research.deep_research import MAX_DB_RAW, _synth_block
    big = "x" * 12000  # each record is capped per-record at 12000 chars
    db = [{"sourceUrl": f"db://{i}", "sourceQuality": "primary", "raw": big} for i in range(10)]
    out = _synth_block([], db)
    assert "truncated to stay within token limits" in out
    included = out.count("```") // 2          # each kept record wraps its raw in a ``` fence pair
    assert included == MAX_DB_RAW // 12000     # 80000 // 12000 = 6 records kept, rest truncated
    assert included < len(db)


# ─── _present_report: positional angle fallback must warn (not silently mislabel) ───
def test_present_report_warns_on_angle_findings_mismatch(monkeypatch, caplog):
    import logging
    pytest.importorskip("anthropic")
    import anthropic
    from dd_agent import api
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "test-token")  # pass the creds gate
    # Construction raises → _present_report returns "" fast (no network / no retry sleeps), but
    # only AFTER the angle/findings digest is built — which is where the mismatch warning fires.
    class _Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("no backend in test")
    monkeypatch.setattr(anthropic, "Anthropic", _Boom)
    report = {"summary": "s", "findings": [
        {"claim": "c1", "confidence": "high", "sources": [], "evidence": "e1"},
        {"claim": "c2", "confidence": "low", "sources": [], "evidence": "e2"}]}
    angles = [{"label": "A"}, {"label": "B"}, {"label": "C"}]  # 3 angles vs 2 findings, no angle field
    with caplog.at_level(logging.WARNING):
        out = api._present_report(report, "disease", angles)
    assert out == ""
    assert any("positional fallback" in r.getMessage() for r in caplog.records)


def test_budget_from_env_parses_cap_and_rejects_bad(monkeypatch):
    """DD_DR_BUDGET wires the cost fuse: a valid positive int → capped Budget that trips
    exhausted(); unset / non-positive / non-integer → None (no cap, no raise)."""
    pytest.importorskip("fastapi")
    from dd_agent.api import _budget_from_env

    monkeypatch.delenv("DD_DR_BUDGET", raising=False)
    assert _budget_from_env() is None  # unset → no cap

    monkeypatch.setenv("DD_DR_BUDGET", "1500000")
    b = _budget_from_env()
    assert b is not None and b.total_tokens == 1_500_000
    assert not b.exhausted()
    b.add("search", {"input_tokens": 1_000_000, "output_tokens": 600_000}, 0)
    assert b.exhausted()  # cap actually trips once spent reaches it

    monkeypatch.setenv("DD_DR_BUDGET", "not-an-int")
    assert _budget_from_env() is None  # invalid → no cap (must not raise)

    monkeypatch.setenv("DD_DR_BUDGET", "0")
    assert _budget_from_env() is None  # non-positive → no cap
