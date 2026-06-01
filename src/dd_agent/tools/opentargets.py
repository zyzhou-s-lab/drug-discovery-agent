"""OpenTargets Platform GraphQL — genetic-evidence source for stage-1 (M1).

Pure stdlib (urllib) so it is independently testable on any box with network,
WITHOUT claude-agent-sdk / anthropic / API keys. The Agent SDK @tool wrappers
live in worker.py (which imports these functions); the node's LLM decides
whether/how to call them (ARCHITECTURE §3.7 D).

Why OpenTargets for the genetic angle: it aggregates GWAS Catalog + L2G
(locus-to-gene) scoring into a per-target `genetic_association` datatype score,
which is the authoritative genetics signal for target–disease links.

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


def disease_associated_targets(efo_id: str, size: int = 25) -> dict:
    """Targets associated with a disease, each with overall + per-datatype scores.

    Returns {disease, efo_id, rows: [{symbol, name, target_id, overall, genetic, ...}]}
    sorted by the `genetic_association` datatype score (desc) — the genetic angle.
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
            "datatypes": {k: round(v, 4) for k, v in dts.items()},
        })
    rows.sort(key=lambda x: x["genetic"], reverse=True)
    return {"disease": disease.get("name"), "efo_id": disease.get("id"), "rows": rows}


def _selfcheck() -> int:
    """Genetics-first dry-AMD should surface complement genes near the top."""
    hits = search_disease("age-related macular degeneration")
    print("search hits:")
    for h in hits:
        print(f"  {h['id']:16} {h['name']}")
    if not hits:
        print("FAIL: no disease hits")
        return 1
    efo = hits[0]["id"]
    res = disease_associated_targets(efo, size=30)
    print(f"\nassociated targets for {res['disease']} ({res['efo_id']}), top by genetic_association:")
    found = []
    for r in res["rows"][:15]:
        mark = "  <-- complement" if r["symbol"] in COMPLEMENT else ""
        if r["symbol"] in COMPLEMENT:
            found.append(r["symbol"])
        print(f"  {r['symbol']:10} genetic={r['genetic']:.3f}  overall={r['overall']:.3f}{mark}")
    ok = bool(found)
    print(f"\n{'PASS' if ok else 'FAIL'}: complement in top-15 by genetics = {found}")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    sys.exit(_selfcheck())
