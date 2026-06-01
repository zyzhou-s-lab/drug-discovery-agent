"""Runner = deterministic state machine (imperative shell). NOT a node.

Orchestrates, never reasons: for each stage -> (skip if done = durable resume)
-> retry loop [build_input -> worker (scatter-gather if stage.scatter) ->
converge into index -> judge -> deterministic route]. judge ADVISES; Runner
transitions. Aggregation (gather) is deterministic code, not a node.
(ARCHITECTURE §2/§3.6/§3.7)
"""
from __future__ import annotations

import asyncio

from .index import Index
from .schemas import NodeInput, NodeOutput


class Runner:
    def __init__(self, index: Index, worker_fn, judge_fn, pipeline, max_parallel: int = 8):
        self.index = index
        self.worker_fn = worker_fn
        self.judge_fn = judge_fn
        self.pipeline = pipeline
        self.sem = asyncio.Semaphore(max_parallel)   # bounded concurrency, not raw gather

    def _build_input(self, campaign: str, disease: str, stage) -> NodeInput:
        return NodeInput(campaign_id=campaign, stage=stage.name, disease=disease,
                         objective=f"run {stage.name}")

    async def _run_angle(self, stage, node_input, angle):
        async with self.sem:
            return await self.worker_fn(stage, node_input, angle)

    async def _scatter_gather(self, stage, node_input) -> NodeOutput:
        # parallel angle worker nodes -> barrier -> deterministic gather (NOT a node)
        results = await asyncio.gather(
            *[self._run_angle(stage, node_input, a) for a in stage.angles]
        )
        return NodeOutput(
            stage=stage.name,
            summary=f"[scatter] {len(results)} angles: {', '.join(stage.angles)}",
            candidates=[c for r in results for c in r.candidates],
        )

    async def run(self, campaign: str, disease: str) -> dict:
        for stage in self.pipeline:
            if self.index.is_done(campaign, stage.name):     # durable resume: skip completed
                continue
            converged = False
            for _ in range(stage.max_attempts):
                self.index.record_attempt(campaign, stage.name)
                node_input = self._build_input(campaign, disease, stage)
                if stage.scatter:
                    out = await self._scatter_gather(stage, node_input)
                else:
                    out = await self.worker_fn(stage, node_input, None)
                # converge side effects into index (artifact, atomic) then judge
                self.index.write_artifact(campaign, stage.name, out.model_dump_json())
                verdict = self.judge_fn(stage, out)
                if verdict.converged:                         # Runner = dumb transition on verdict
                    self.index.mark_done(campaign, stage.name, out.model_dump(), verdict.model_dump())
                    converged = True
                    break
            if not converged:
                self.index.mark_exhausted(campaign, stage.name)
                break
        return {"campaign": campaign, "states": self.index.all_states(campaign)}
