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


def test_rank_claims_caps_at_max():
    claims = [{"claim": f"c{i}", "importance": "central", "sourceQuality": "primary"}
              for i in range(MAX_VERIFY_CLAIMS + 10)]
    assert len(rank_claims(claims)) == MAX_VERIFY_CLAIMS


def test_survives_needs_quorum_and_few_refutes():
    assert survives([{"refuted": False}, {"refuted": False}, {"refuted": True}]) is True
    assert survives([{"refuted": True}, {"refuted": True}, {"refuted": False}]) is False


def test_survives_too_many_abstentions_fails():
    # only one valid vote (two abstained as None) → not adjudicated → must not survive
    assert survives([{"refuted": False}, None, None]) is False


def test_survives_all_abstain_fails():
    assert survives([None, None, None]) is False


# ─── Orchestration (run_agent monkeypatched — no network) ───
import asyncio  # noqa: E402

from dd_agent.research import deep_research as dr  # noqa: E402

_ANGLE = [{"label": "g", "query": "q", "rationale": "r"}]


def _patch_agent(fake):
    """Swap deep_research.run_agent for a fake; return a restore() callable."""
    orig = dr.run_agent
    dr.run_agent = fake
    return lambda: setattr(dr, "run_agent", orig)


def test_research_happy_path_returns_report():
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12):
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
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12):
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
    refs, web, db = _bibliography(confirmed, all_sources)
    assert refs == []  # no paper sources → no network/APA7
    assert [w["url"] for w in web] == ["https://a.com/x"]  # uncited excluded
    assert [d["title"] for d in db] == ["EFO"]


def test_research_all_refuted_salvage():
    async def fake(phase, prompt, submit, schema, extra, budget, sem, on_message=None, max_turns=12):
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
