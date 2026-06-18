"""Unit tests for stage-1 nomination (deterministic OT ranking). Offline: OpenTargets calls are
monkeypatched, so this covers the ranking order + the target_profile -> scores/modality mapping
without network."""
from dd_agent.research import nominate as nom
from dd_agent.tools import opentargets as ot

_ROWS = {
    "rows": [
        {"symbol": "CFH", "name": "complement factor H", "target_id": "ENSG_CFH",
         "overall": 0.80, "genetic": 0.90, "sort_score": 0.90},
        {"symbol": "FOO", "name": "foo gene", "target_id": "ENSG_FOO",
         "overall": 0.50, "genetic": 0.40, "sort_score": 0.40},
    ]
}


def _fake_profile(symbol):
    if symbol == "CFH":
        return {"sm_tractability": ["Approved Drug", "Advanced Clinical"],
                "genetic_constraint": {"lof": {"upperBin": 2}},
                "safety_liabilities": ["hepatotoxicity", "nephrotoxicity"]}
    return {}  # FOO: nothing


def test_nominate_ranks_and_enriches(monkeypatch):
    monkeypatch.setattr(ot, "disease_associated_targets", lambda efo, size, sort_by: _ROWS)
    monkeypatch.setattr(ot, "target_profile", _fake_profile)

    cands = nom.nominate("EFO_X", top_n=2, sort_by="genetic_association", enrich=True)

    assert [c.symbol for c in cands] == ["CFH", "FOO"]          # order = OT ranking, not re-scored
    cfh = cands[0]
    assert cfh.scores["association"] == 0.80 and cfh.scores["genetic"] == 0.90
    assert cfh.scores["genetic_association"] == 0.90
    assert cfh.modality == "small_molecule" and cfh.scores["tractability"] == 1.0  # approved -> 1.0
    assert cfh.scores["constraint"] == 2.0                       # LOEUF bin
    assert any(e.kind == "safety" for e in cfh.evidence)         # liabilities -> safety evidence
    assert any(e.kind == "genetic" and e.source == "OpenTargets" for e in cfh.evidence)
    assert cands[1].modality is None and "tractability" not in cands[1].scores  # FOO unenriched


def test_nominate_enrich_false_skips_profile(monkeypatch):
    called = {"profile": 0}

    def _boom(_symbol):
        called["profile"] += 1
        return {}

    monkeypatch.setattr(ot, "disease_associated_targets", lambda efo, size, sort_by: _ROWS)
    monkeypatch.setattr(ot, "target_profile", _boom)

    cands = nom.nominate("EFO_X", top_n=2, enrich=False)
    assert called["profile"] == 0                                # no profile calls
    assert all(c.modality is None for c in cands)
    assert cands[0].scores["association"] == 0.80                # ranking scores still present


def test_nominate_profile_failure_keeps_candidate(monkeypatch):
    monkeypatch.setattr(ot, "disease_associated_targets", lambda efo, size, sort_by: _ROWS)
    monkeypatch.setattr(ot, "target_profile",
                        lambda s: (_ for _ in ()).throw(RuntimeError("OT down")))

    cands = nom.nominate("EFO_X", top_n=2, enrich=True)          # must not raise
    assert [c.symbol for c in cands] == ["CFH", "FOO"]           # candidates survive enrich failure
