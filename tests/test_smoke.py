"""M0 smoke: dummy worker/judge, zero API. Verifies control flow + durable + scatter."""
import asyncio

from dd_agent.index import Index
from dd_agent.judge import dummy_judge
from dd_agent.pipeline import DISCOVERY_PIPELINE
from dd_agent.runner import Runner
from dd_agent.worker import dummy_worker


def _fresh(tmp_path):
    return Index(str(tmp_path / "state.sqlite"), str(tmp_path / "artifacts"))


def _run(idx, campaign="c1"):
    r = Runner(idx, dummy_worker, dummy_judge, DISCOVERY_PIPELINE)
    return asyncio.run(r.run(campaign, "dry AMD"))


def test_pipeline_runs_all_stages(tmp_path):
    idx = _fresh(tmp_path)
    _run(idx)
    for stage in DISCOVERY_PIPELINE:
        assert idx.is_done("c1", stage.name), f"{stage.name} not done"


def test_durable_resume_skips_done(tmp_path):
    idx = _fresh(tmp_path)
    _run(idx)
    attempts_before = {s: a for s, _, a in idx.all_states("c1")}
    # simulate restart: a brand-new Index/Runner on the SAME db must NOT re-run done stages
    idx2 = Index(str(tmp_path / "state.sqlite"), str(tmp_path / "artifacts"))
    _run(idx2)
    attempts_after = {s: a for s, _, a in idx2.all_states("c1")}
    assert attempts_before == attempts_after, "resume re-ran already-done stages"


def test_scatter_gather_merges_angles(tmp_path):
    idx = _fresh(tmp_path)
    _run(idx)
    out = idx.output("c1", "target-hypothesis")
    assert out is not None and "[scatter]" in out["summary"]
    symbols = {c["symbol"] for c in out["candidates"]}
    assert "CFH" in symbols  # anchor: complement surfaces (genetics-first dry-AMD)
