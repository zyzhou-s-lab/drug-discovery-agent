"""Europe PMC REST — literature-evidence source for stage-2 (M3).

Pure stdlib (urllib) so it self-checks without claude-agent-sdk / keys. The Agent
SDK @tool wrapper lives in worker.py; the node's LLM decides what to search and
which papers to cite (ARCHITECTURE §3.7 D). Returns REAL PMIDs — the stage-2
contract forbids fabricated citations.

Self-check:  python -m dd_agent.tools.europepmc
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def search_literature(query: str, size: int = 5) -> list[dict]:
    """Search Europe PMC. Returns [{pmid, doi, title, year, journal, source}], relevance order."""
    params = urllib.parse.urlencode({
        "query": query,
        "format": "json",
        "pageSize": max(1, min(size, 25)),
        "resultType": "lite",
    })
    url = f"{API}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        raise RuntimeError(f"Europe PMC request failed: {e}") from e
    out = []
    for r in data.get("resultList", {}).get("result", []):
        out.append({
            "pmid": r.get("pmid"),
            "doi": r.get("doi"),
            "title": r.get("title"),
            "year": r.get("pubYear"),
            "journal": r.get("journalTitle"),
            "source": r.get("source"),
        })
    return out


def _selfcheck() -> int:
    res = search_literature("CFH AND age-related macular degeneration", size=5)
    for r in res:
        print(f"  PMID:{r.get('pmid')} ({r.get('year')}) {(r.get('title') or '')[:70]}")
    ok = any(r.get("pmid") for r in res)
    print(f"\n{'PASS' if ok else 'FAIL'}: {len(res)} hits, {sum(1 for r in res if r.get('pmid'))} with PMIDs")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    sys.exit(_selfcheck())
