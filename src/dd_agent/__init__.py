"""drug target-discovery agent harness (Phase A).

Layers (see docs/ARCHITECTURE.md):
- Runner   = deterministic state machine (imperative shell) -- runner.py
- node     = boxed agent session (worker / planner / judge)
- index    = SQLite state-DB + content-addressed artifact store -- index.py
"""
__version__ = "0.1.0"
