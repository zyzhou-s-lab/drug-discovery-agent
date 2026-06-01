"""dd-agent CLI: run / resume / status.

resume == run (idempotent: Runner skips stages already 'done' in the SQLite
state-DB → durable (c)-level resume). M0 wires the dummy worker/judge.
"""
from __future__ import annotations

import argparse
import asyncio

from .index import Index
from .judge import dummy_judge
from .pipeline import DISCOVERY_PIPELINE
from .runner import Runner
from .worker import dummy_worker


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

    runner = Runner(idx, dummy_worker, dummy_judge, DISCOVERY_PIPELINE)
    res = asyncio.run(runner.run(args.campaign, args.disease))
    print(f"[{res['campaign']}] {args.cmd} done. state:")
    _print_states(idx, args.campaign)


if __name__ == "__main__":
    main()
