"""OpenTargets Platform GraphQL — genetic-evidence + target-profile source.

Pure stdlib (urllib) so it is independently testable on any box with network,
WITHOUT claude-agent-sdk / anthropic / API keys. The Agent SDK @tool wrappers
live in worker.py; the node's LLM decides whether/how to call them (§3.7 D).

Why OpenTargets: it aggregates GWAS Catalog + L2G (genetic_association), and per
target it also aggregates tractability, genetic constraint (gnomAD), safety
liabilities and known drugs — so stage-3 triage needs one source, not four.

Self-check:  python -m dd_agent.tools.opentargets
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

API = "https://api.platform.opentargets.org/api/v4/graphql"

# complement genes — the genetics-first anchor for dry AMD (DOMAIN §1):
# approved geographic-atrophy drugs (pegcetacoplan, avacincaptad) are complement inhibitors.
COMPLEMENT = {"CFH", "CFI", "CFB", "CFD", "C2", "C3", "C9", "C3AR1",
              "CFHR1", "CFHR3", "CFHR4", "CFHR5", "VTN", "SERPING1"}

_SEARCH_Q = """
query Search($q: String!, $size: Int!) {
  search(queryString: $q, entityNames: ["disease"], page: {index: 0, size: $size}) {
    hits { id name entity }
  }
}
"""

_ASSOC_Q = """
query Assoc($efoId: String!, $size: Int!) {
  disease(efoId: $efoId) {
    id
    name
    associatedTargets(page: {index: 0, size: $size}) {
      count
      rows {
        target { id approvedSymbol approvedName }
        score
        datatypeScores { id score }
      }
    }
  }
}
"""

_TARGET_SEARCH_Q = """
query TS($q: String!) {
  search(queryString: $q, entityNames: ["target"], page: {index: 0, size: 1}) {
    hits { id approvedSymbol }
  }
}
"""

_TARGET_Q = """
query T($id: String!) {
  target(ensemblId: $id) {
    id
    approvedSymbol
    approvedName
    tractability { modality value label }
    geneticConstraint { constraintType score oe upperBin }
    safetyLiabilities { event datasource }
    knownDrugs { count }
  }
}
"""


def _gql(query: str, variables: dict, timeout: float = 30.0) -> dict:
    """POST a GraphQL query; raise RuntimeError on transport/GraphQL errors."""
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.URLError as e:                       # network/timeout
        raise RuntimeError(f"OpenTargets request failed: {e}") from e
    if payload.get("errors"):
        raise RuntimeError(f"OpenTargets GraphQL errors: {payload['errors']}")
    return payload.get("data") or {}


def search_disease(name: str, size: int = 5) -> list[dict]:
    """Resolve a disease name → candidate EFO ids. [{id, name}], best first."""
    data = _gql(_SEARCH_Q, {"q": name, "size": size})
    return [{"id": h["id"], "name": h["name"]} for h in data.get("search", {}).get("hits", [])]


def disease_associated_targets(efo_id: str, size: int = 50,
                               sort_by: str = "genetic_association") -> dict:
    """Targets associated with a disease, each with overall + per-datatype scores.

    Returns {disease, efo_id, sort_by, rows: [{symbol, name, target_id, overall,
    genetic, sort_score, datatypes}]} sorted by the `sort_by` datatype score (desc).
    sort_by selects the evidence angle: genetic_association | rna_expression |
    affected_pathway | literature | animal_model | somatic_mutation | known_drug.
    NOTE: the API returns the top-`size` by OVERALL score, then we re-rank by
    sort_by locally — use a generous size so a datatype's leaders aren't truncated.
    """
    data = _gql(_ASSOC_Q, {"efoId": efo_id, "size": size})
    disease = data.get("disease") or {}
    rows = []
    for r in disease.get("associatedTargets", {}).get("rows", []):
        dts = {d["id"]: d["score"] for d in r.get("datatypeScores", [])}
        tgt = r.get("target", {})
        rows.append({
            "symbol": tgt.get("approvedSymbol"),
            "name": tgt.get("approvedName"),
            "target_id": tgt.get("id"),
            "overall": round(r.get("score", 0.0), 4),
            "genetic": round(dts.get("genetic_association", 0.0), 4),
            "sort_score": round(dts.get(sort_by, 0.0), 4),
            "datatypes": {k: round(v, 4) for k, v in dts.items()},
        })
    rows.sort(key=lambda x: x["sort_score"], reverse=True)
    return {"disease": disease.get("name"), "efo_id": disease.get("id"),
            "sort_by": sort_by, "rows": rows}


def target_profile(symbol: str) -> dict:
    """Druggability/safety triage profile for a target symbol (stage-3).

    Returns {symbol, target_id, sm_tractability:[labels], genetic_constraint:{type:
    {score,oe,upperBin}}, safety_liabilities:[events], known_drugs_count}. {} if unknown.
    genetic_constraint 'lof' upperBin/oe ≈ gnomAD LOEUF (low = intolerant = caution).
    """
    s = _gql(_TARGET_SEARCH_Q, {"q": symbol})
    hits = s.get("search", {}).get("hits", [])
    if not hits:
        return {}
    data = _gql(_TARGET_Q, {"id": hits[0]["id"]})
    t = data.get("target") or {}
    sm_tract = [b.get("label") for b in (t.get("tractability") or [])
                if b.get("modality") == "SM" and b.get("value")]
    constraint = {c.get("constraintType"): {"score": c.get("score"), "oe": c.get("oe"),
                                            "upperBin": c.get("upperBin")}
                  for c in (t.get("geneticConstraint") or [])}
    return {
        "symbol": t.get("approvedSymbol"),
        "target_id": t.get("id"),
        "sm_tractability": sm_tract,
        "genetic_constraint": constraint,
        "safety_liabilities": [s2.get("event") for s2 in (t.get("safetyLiabilities") or [])],
        "known_drugs_count": (t.get("knownDrugs") or {}).get("count", 0),
    }


def _selfcheck() -> int:
    """Genetics-first dry-AMD should surface complement genes near the top; and a
    target_profile(CFH) should return tractability/constraint fields."""
    hits = search_disease("age-related macular degeneration")
    if not hits:
        print("FAIL: no disease hits")
        return 1
    efo = hits[0]["id"]
    res = disease_associated_targets(efo, size=30)
    print(f"associated targets for {res['disease']} ({res['efo_id']}), top by genetic_association:")
    found = []
    for r in res["rows"][:15]:
        mark = "  <-- complement" if r["symbol"] in COMPLEMENT else ""
        if r["symbol"] in COMPLEMENT:
            found.append(r["symbol"])
        print(f"  {r['symbol']:10} genetic={r['genetic']:.3f}  overall={r['overall']:.3f}{mark}")
    print(f"complement in top-15 by genetics = {found}")

    print("\n--- target_profile(CFH) ---")
    tp = target_profile("CFH")
    print(json.dumps(tp, ensure_ascii=False, indent=2))

    ok = bool(found) and bool(tp.get("target_id"))
    print(f"\n{'PASS' if ok else 'FAIL'}: complement surfaced + target_profile populated")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    sys.exit(_selfcheck())
