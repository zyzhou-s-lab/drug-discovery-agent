"""Stage-1 nomination — DETERMINISTIC OpenTargets target ranking.

Plan §1/§10: the *ranking* is OpenTargets' (association / genetic score) — reproducible, no
adversarial voting. deep-research's increment (literature/web evidence mining + adversarial
verify ON the candidates) layers on top and is NOT here. The caveat from the plan: do NOT
replace OT's score with vote-confidence; OT already gives ranked targets, so this module is the
structured, deterministic backbone — disease (EFO) -> ranked TargetCandidate[].

Each candidate is enriched (top ones) with target_profile: small-molecule tractability ->
modality, gnomAD LoF constraint, and safety liabilities. Pure stdlib + OpenTargets GraphQL
(via tools.opentargets); independently runnable:  python -m dd_agent.research.nominate
"""
from __future__ import annotations

import logging

from ..schemas import Evidence, TargetCandidate
from ..tools import opentargets as ot

_log = logging.getLogger(__name__)


def _tractability_score(profile: dict) -> tuple[str | None, float, str]:
    """Map OT small-molecule tractability labels -> (modality, score 0-1, note)."""
    labels = [str(label_str).lower() for label_str in (profile.get("sm_tractability") or [])]
    if not labels:
        return None, 0.0, ""
    if any("approved" in label_str for label_str in labels):
        return "small_molecule", 1.0, "approved SM"
    if any("clinical" in label_str for label_str in labels):
        return "small_molecule", 0.7, "clinical SM"
    return "small_molecule", 0.4, "SM-tractable"


def nominate(efo_id: str, top_n: int = 20, sort_by: str = "genetic_association",
             enrich: bool = True) -> list[TargetCandidate]:
    """Disease (EFO id) -> ranked TargetCandidate[], by OT `sort_by` datatype score.

    sort_by selects the evidence axis (genetic_association | rna_expression | affected_pathway |
    known_drug | ...). `enrich` adds target_profile (tractability/constraint/safety) per candidate
    — one extra OT call each, so it is the slow part; pass enrich=False for a fast ranking only.
    """
    assoc = ot.disease_associated_targets(efo_id, size=max(50, top_n * 2), sort_by=sort_by)
    rows = assoc.get("rows", [])[:top_n]
    candidates: list[TargetCandidate] = []

    for rank, r in enumerate(rows, start=1):
        scores: dict[str, float] = {
            "association": round(r.get("overall", 0.0), 4),
            "genetic": round(r.get("genetic", 0.0), 4),
            sort_by: round(r.get("sort_score", 0.0), 4),
        }
        evidence = [Evidence(
            kind="genetic", source="OpenTargets",
            detail=f"{sort_by}={r.get('sort_score', 0.0):.3f}, overall={r.get('overall', 0.0):.3f}",
            ref=r.get("target_id", ""))]
        rationale = [f"OT {sort_by} rank #{rank}"]
        modality: str | None = None

        if enrich and r.get("symbol"):
            try:
                p = ot.target_profile(r["symbol"])
            except Exception as exc:  # noqa: BLE001 — enrichment is best-effort, never drop a candidate
                _log.debug("target_profile(%s) failed: %s", r.get("symbol"), exc)
                p = {}
            if p:
                modality, tract, note = _tractability_score(p)
                if modality:
                    scores["tractability"] = tract
                    rationale.append(note)
                lof = (p.get("genetic_constraint") or {}).get("lof") or {}
                if lof.get("upperBin") is not None:
                    # gnomAD LOEUF bin (raw decile, NOT a 0-1 score): low = LoF-intolerant =
                    # dosage-sensitive (caution). Distinct key so downstream won't read it as 0-1.
                    scores["lof_upper_bin"] = float(lof["upperBin"])
                liabilities = p.get("safety_liabilities") or []
                if liabilities:
                    scores["safety_count"] = float(len(liabilities))
                    evidence.append(Evidence(
                        kind="safety", source="OpenTargets",
                        detail="liabilities: " + ", ".join(str(x) for x in liabilities[:3]),
                        ref=r.get("target_id", "")))

        candidates.append(TargetCandidate(
            symbol=r.get("symbol", ""), name=r.get("name"), modality=modality,
            evidence=evidence, scores=scores, rationale="; ".join(rationale)))
    return candidates


def _selfcheck() -> int:
    """Genetics-first dry-AMD nomination should surface complement genes near the top."""
    import json

    hits = ot.search_disease("age-related macular degeneration")
    if not hits:
        print("FAIL: no disease hits")
        return 1
    efo = hits[0]["id"]
    cands = nominate(efo, top_n=15, sort_by="genetic_association", enrich=True)
    found = [c.symbol for c in cands if c.symbol in ot.COMPLEMENT]
    for rank, c in enumerate(cands, 1):
        mark = "  <-- complement" if c.symbol in ot.COMPLEMENT else ""
        print(f"  #{rank:2} {c.symbol:10} assoc={c.scores.get('association', 0):.3f} "
              f"genetic={c.scores.get('genetic', 0):.3f} "
              f"tract={c.scores.get('tractability', 0):.2f} "
              f"modality={c.modality or '-'}{mark}")
    print(f"\ncomplement in top-15 = {found}")
    print("\n--- example candidate JSON ---")
    print(json.dumps(cands[0].model_dump(), ensure_ascii=False, indent=2))
    ok = bool(found)
    print(f"\n{'PASS' if ok else 'FAIL'}: complement surfaced in nomination")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys

    sys.exit(_selfcheck())
