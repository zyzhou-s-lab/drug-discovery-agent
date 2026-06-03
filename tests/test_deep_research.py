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
