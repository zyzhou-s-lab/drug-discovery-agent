"""Runner = deterministic state machine (imperative shell). NOT a node.

Orchestrates, never reasons: for each stage -> (skip if done = durable resume)
-> retry loop [build_input -> (planner|scatter|worker) -> converge into index ->
judge -> deterministic route]. judge ADVISES; Runner transitions. Aggregation
(gather) is deterministic code, not a node. (ARCHITECTURE §2/§3.6/§3.7)
"""
from __future__ import annotations

import asyncio

from .index import Index
from .schemas import NodeInput, NodeOutput, TargetCandidate, ValidationAnglePlan, ValidationPlan


def _merge_by_symbol(results) -> list[TargetCandidate]:
    """Deterministic gather: merge candidates across results by symbol — union
    evidence, merge per-angle scores, rank by #distinct supporting angles."""
    merged: dict[str, TargetCandidate] = {}
    for r in results:
        for c in r.candidates:
            if c.symbol not in merged:
                merged[c.symbol] = c.model_copy(deep=True)
                continue
            m = merged[c.symbol]
            m.evidence.extend(c.evidence)
            m.scores.update(c.scores)
            if c.rationale and c.rationale not in m.rationale:
                m.rationale = f"{m.rationale} | {c.rationale}".strip(" |")
            if not m.modality and c.modality:
                m.modality = c.modality
    return sorted(merged.values(), key=lambda c: len({e.kind for e in c.evidence}), reverse=True)


class Runner:
    def __init__(self, index: Index, worker_fn, judge_fn, pipeline,
                 planner_fn=None, max_parallel: int = 8):
        self.index = index
        self.worker_fn = worker_fn
        self.judge_fn = judge_fn
        self.planner_fn = planner_fn                 # stage-4 validation planning (M4)
        self.pipeline = pipeline
        self.sem = asyncio.Semaphore(max_parallel)   # bounded concurrency, not raw gather

    def _build_input(self, campaign: str, disease: str, stage) -> NodeInput:
        # stage chain: thread the latest upstream candidates downstream (read from index,
        # deterministic — Runner threads context, nodes stay boxed). CONCEPTS §5.
        prior: list = []
        done_refs: list[str] = []
        for s in self.pipeline:
            if s.name == stage.name:
                break
            out = self.index.output(campaign, s.name)
            if out:
                done_refs.append(s.name)
                if out.get("candidates"):
                    prior = out["candidates"]
        return NodeInput(campaign_id=campaign, stage=stage.name, disease=disease,
                         objective=f"run {stage.name}",
                         context_refs=done_refs, prior_candidates=prior)

    async def _run_angle(self, stage, node_input, angle):
        async with self.sem:
            out = await self.worker_fn(stage, node_input, angle)
            # deterministic: stamp the angle onto each evidence so gather's cross-angle
            # corroboration count is reliable — don't trust the LLM to fill evidence.kind.
            if angle:
                for c in out.candidates:
                    for e in c.evidence:
                        e.kind = angle
            return out

    async def _scatter_gather(self, stage, node_input) -> NodeOutput:
        # parallel angle worker nodes -> barrier -> deterministic gather (NOT a node).
        results = await asyncio.gather(
            *[self._run_angle(stage, node_input, a) for a in stage.angles]
        )
        cands = _merge_by_symbol(results)
        return NodeOutput(
            stage=stage.name,
            summary=(f"[scatter] {len(results)} angles ({', '.join(stage.angles)}) "
                     f"-> {len(cands)} merged candidates"),
            candidates=cands,
        )

    async def _run_validation(self, stage, node_input, target, angle):
        async with self.sem:
            sub = node_input.model_copy(deep=True)
            sub.constraints = {**sub.constraints, "target": target}   # thread target to worker
            out = await self.worker_fn(stage, sub, angle)
            for c in out.candidates:
                for e in c.evidence:
                    e.kind = angle                                     # deterministic angle stamp
            return out

    def _default_plan(self, node_input) -> ValidationPlan:
        # fallback when no planner_fn (dummy / zero-API runs): validate each on genetics.
        targets = [c.get("symbol") for c in (node_input.prior_candidates or []) if c.get("symbol")]
        return ValidationPlan(disease=node_input.disease,
                              plans=[ValidationAnglePlan(target=t, angles=["genetic"]) for t in targets])

    async def _planner_validate(self, stage, node_input) -> NodeOutput:
        # planner picks angles per target (dynamic, mode a) -> fan out one worker per
        # (target, angle) -> deterministic gather per target. ARCHITECTURE §3.7 A/E.
        plan = self.planner_fn(stage, node_input) if self.planner_fn else self._default_plan(node_input)
        pairs = [(p.target, a) for p in plan.plans for a in p.angles]
        if not pairs:
            return NodeOutput(stage=stage.name,
                              summary="[validate] empty plan (no selected targets upstream)")
        results = await asyncio.gather(
            *[self._run_validation(stage, node_input, t, a) for (t, a) in pairs]
        )
        cands = _merge_by_symbol(results)
        plan_txt = "; ".join(f"{p.target}:[{'+'.join(p.angles)}]" for p in plan.plans)
        return NodeOutput(
            stage=stage.name,
            summary=f"[validate] plan {{{plan_txt}}} -> {len(cands)} validated targets",
            candidates=cands,
        )

    async def run(self, campaign: str, disease: str, only: str | None = None) -> dict:
        for stage in self.pipeline:
            if only and stage.name != only:                  # --only: execute just this stage
                continue                                     # (full pipeline still visible to _build_input)
            if self.index.is_done(campaign, stage.name):     # durable resume: skip completed
                continue
            converged = False
            for _ in range(stage.max_attempts):
                self.index.record_attempt(campaign, stage.name)
                node_input = self._build_input(campaign, disease, stage)
                if getattr(stage, "planner", False):
                    out = await self._planner_validate(stage, node_input)
                elif stage.scatter:
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
