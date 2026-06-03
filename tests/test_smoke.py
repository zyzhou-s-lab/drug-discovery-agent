"""Smoke: deep-research flow (scope-only PIPELINE) with dummy worker/judge, zero API.
Verifies control flow + durable resume. (Legacy 5-stage discovery smoke tests are on
branch legacy-discovery-pipeline.)"""
import asyncio

from dd_agent.index import Index
from dd_agent.pipeline import PIPELINE
from dd_agent.runner import Runner
from dd_agent.worker import dummy_worker


def _fresh(tmp_path):
    return Index(str(tmp_path / "state.sqlite"), str(tmp_path / "artifacts"))


def _run(idx, campaign="c1"):
    r = Runner(idx, dummy_worker, None, PIPELINE)  # judge_fn=None: unjudged deep-research flow
    return asyncio.run(r.run(campaign, "dry AMD"))


def test_pipeline_runs_all_stages(tmp_path):
    idx = _fresh(tmp_path)
    _run(idx)
    for stage in PIPELINE:
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
