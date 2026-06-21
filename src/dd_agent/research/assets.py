"""Per-campaign structured ASSET layer — clean, typed projections of a stage's output, written
next to the report so the downstream COMPUTE / ANALYSIS steps (nomination → validation /
perturbation) consume a stable contract instead of re-parsing the large report.json.

This is NOT a cross-session search/index — it is the inter-stage data hand-off, one assets/ dir
per campaign, one file per asset kind:

    {artifacts}/{campaign}/assets/
      ├── sources.json          # overview: the source/literature list + numbered bibliography
      ├── database_facts.json   # overview: structured database/ontology records (EFO/MONDO/GWAS…)
      └── candidates.json       # nomination: ranked TargetCandidate[] (the genes validation perturbs)

Each file is a self-describing envelope ({campaign, stage, count, <payload>}) so a consumer can
load exactly what it needs without the report's presentation/bookkeeping fields. Writes are atomic
and idempotent (a re-run overwrites its own assets).
"""
from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..schemas import TargetCandidate

ASSETS_SUBDIR = "assets"


def assets_dir(artifacts_root: str, campaign: str) -> str:
    return os.path.join(artifacts_root, campaign, ASSETS_SUBDIR)


def _write(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:  # on any failure, don't leave an orphan .tmp behind
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def write_overview_assets(report: dict, artifacts_root: str, campaign: str) -> list[str]:
    """Project a deep-research overview report into the compute-facing assets: sources.json
    (the literature/source list + numbered bibliography) and database_facts.json (the structured
    database/ontology records). Returns the paths written. Idempotent."""
    d = assets_dir(artifacts_root, campaign)
    question = report.get("question")
    sources = report.get("sources") or []
    references = report.get("references") or []
    facts = report.get("databaseFacts") or []

    src_path = os.path.join(d, "sources.json")
    db_path = os.path.join(d, "database_facts.json")
    _write(src_path, {"campaign": campaign, "stage": "disease-overview", "question": question,
                      "count": len(sources), "sources": sources, "references": references})
    _write(db_path, {"campaign": campaign, "stage": "disease-overview", "question": question,
                     "count": len(facts), "facts": facts})
    return [src_path, db_path]


def write_candidates(candidates: list[TargetCandidate | dict], artifacts_root: str, campaign: str, *,
                     efo_id: str = "", sort_by: str = "") -> str:
    """Write nomination's ranked TargetCandidate[] as candidates.json — the gene list (+ scores,
    modality, evidence) the validation / perturbation step consumes. `candidates` may be
    TargetCandidate models or plain dicts. Returns the path written."""
    rows = [c.model_dump() if hasattr(c, "model_dump") else dict(c) for c in candidates]
    path = os.path.join(assets_dir(artifacts_root, campaign), "candidates.json")
    _write(path, {"campaign": campaign, "stage": "nomination", "efo_id": efo_id,
                  "sort_by": sort_by, "count": len(rows), "candidates": rows})
    return path


def load_asset(artifacts_root: str, campaign: str, name: str) -> dict | None:
    """Read one asset by file name (e.g. 'database_facts.json', 'candidates.json'); None if absent.
    The entry point for a downstream compute step to pick up an upstream stage's hand-off."""
    try:
        with open(os.path.join(assets_dir(artifacts_root, campaign), name), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
