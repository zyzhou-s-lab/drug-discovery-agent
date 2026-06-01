"""dd-agent CLI: run / resume / status.

resume == run (idempotent: Runner skips stages already 'done' in the SQLite
state-DB → durable (c)-level resume). M0 wires the dummy worker/judge.
"""
from __future__ import annotations

import argparse
import asyncio

from .index import Index
from .judge import api_judge, dummy_judge
from .pipeline import DISCOVERY_PIPELINE
from .runner import Runner
from .worker import dummy_worker, sdk_worker


def _print_states(idx: Index, campaign: str) -> None:
    for stage, status, attempts in idx.all_states(campaign):
        print(f"  {stage:24} {status:12} attempts={attempts}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="dd-agent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "resume"):           # resume = run; skips done stages
        p = sub.add_parser(name)
        p.add_argument("--disease", required=True)
        p.add_argument("--campaign", default="dummy")
        p.add_argument("--db", default="/tmp/dd/state.sqlite")
        p.add_argument("--artifacts", default="/tmp/dd/artifacts")
        p.add_argument("--real", action="store_true",
                       help="use sdk_worker + api_judge (real LLM/tools) instead of dummy")
        p.add_argument("--only", default=None,
                       help="run a single stage by name (M1 vertical slice)")
    st = sub.add_parser("status")
    st.add_argument("--campaign", default="dummy")
    st.add_argument("--db", default="/tmp/dd/state.sqlite")
    st.add_argument("--artifacts", default="/tmp/dd/artifacts")

    args = ap.parse_args(argv)
    idx = Index(args.db, args.artifacts)

    if args.cmd == "status":
        print(f"[{args.campaign}] state:")
        _print_states(idx, args.campaign)
        return

    real = getattr(args, "real", False)
    worker_fn = sdk_worker if real else dummy_worker
    judge_fn = api_judge if real else dummy_judge

    only = getattr(args, "only", None)
    if only and only not in {s.name for s in DISCOVERY_PIPELINE}:
        ap.error(f"--only: unknown stage '{only}' "
                 f"(have: {', '.join(s.name for s in DISCOVERY_PIPELINE)})")
    # Runner always gets the FULL pipeline so _build_input can see upstream stages;
    # --only just restricts which stage actually executes this run.
    # M2+: --real fans out the stage's scatter angles (M1's single-angle downgrade removed).

    from .planner import plan_validation
    runner = Runner(idx, worker_fn, judge_fn, DISCOVERY_PIPELINE,
                    planner_fn=(plan_validation if real else None))
    res = asyncio.run(runner.run(args.campaign, args.disease, only=only))
    print(f"[{res['campaign']}] {args.cmd} done{' [real]' if real else ''}. state:")
    _print_states(idx, args.campaign)


if __name__ == "__main__":
    main()
