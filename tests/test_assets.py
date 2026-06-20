"""Unit tests for the per-campaign asset layer (research/assets.py) — pure file I/O, no network."""
from dd_agent.research import assets
from dd_agent.schemas import Evidence, TargetCandidate


def test_write_overview_assets_projects_report(tmp_path):
    report = {
        "question": "What is X?",
        "summary": "…", "findings": [],                       # presentation fields ignored
        "sources": [{"url": "https://a/x", "quality": "primary", "angle": "g", "claimCount": 3}],
        "references": [{"n": 1, "kind": "web", "title": "A", "url": "https://a/x"}],
        "databaseFacts": [{"claim": "EFO_0000249 = Alzheimer", "status": "confirmed"},
                          {"claim": "MONDO:0004975 …", "status": "unverified"}],
    }
    paths = assets.write_overview_assets(report, str(tmp_path), "camp1")
    assert [p.split("/")[-1] for p in paths] == ["sources.json", "database_facts.json"]
    assert all("/camp1/assets/" in p for p in paths)          # under the per-campaign assets/ dir

    src = assets.load_asset(str(tmp_path), "camp1", "sources.json")
    assert src["stage"] == "disease-overview" and src["question"] == "What is X?"
    assert src["count"] == 1 and src["sources"][0]["url"] == "https://a/x"
    assert src["references"][0]["n"] == 1

    db = assets.load_asset(str(tmp_path), "camp1", "database_facts.json")
    assert db["count"] == 2 and db["facts"][1]["status"] == "unverified"


def test_write_overview_assets_tolerates_missing_fields(tmp_path):
    paths = assets.write_overview_assets({"question": "Q"}, str(tmp_path), "camp2")
    src = assets.load_asset(str(tmp_path), "camp2", "database_facts.json")
    assert src["count"] == 0 and src["facts"] == []           # empty, not a crash
    assert len(paths) == 2


def test_write_candidates_from_models_and_dicts(tmp_path):
    cands = [
        TargetCandidate(symbol="CFH", name="complement factor H", modality="small_molecule",
                        evidence=[Evidence(kind="genetic", source="OpenTargets", detail="d", ref="r")],
                        scores={"association": 0.8}, rationale="OT #1"),
        {"symbol": "C3", "scores": {"association": 0.5}},     # plain dict also accepted
    ]
    path = assets.write_candidates(cands, str(tmp_path), "camp1", efo_id="EFO_0000249",
                                   sort_by="genetic_association")
    assert path.endswith("/camp1/assets/candidates.json")

    out = assets.load_asset(str(tmp_path), "camp1", "candidates.json")
    assert out["stage"] == "nomination" and out["efo_id"] == "EFO_0000249"
    assert out["count"] == 2
    assert [c["symbol"] for c in out["candidates"]] == ["CFH", "C3"]
    assert out["candidates"][0]["evidence"][0]["source"] == "OpenTargets"


def test_load_asset_missing_returns_none(tmp_path):
    assert assets.load_asset(str(tmp_path), "nope", "candidates.json") is None
