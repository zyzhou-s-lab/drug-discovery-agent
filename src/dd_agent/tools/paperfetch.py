"""Multi-source literature search — OpenAlex + Semantic Scholar (stage-2 / lit-evidence).

Pure stdlib (urllib) so it self-checks without claude-agent-sdk / keys, mirroring
tools/europepmc.py. The Agent SDK @tool wrappers live in worker.py.

DOI is the canonical evidence ref across the literature/evidence layer — the judge
verifies DOI (not PMID); `pmid` is kept nullable for cross-reference only. Returns
REAL papers; fabricated citations are forbidden by the stage-2 contract.

Three capabilities (decided contract):
  search_literature_multi(query) — OpenAlex + S2 fused, deduped by DOI, OA-tagged
  get_references(doi)            — papers this DOI cites     (S2, backward snowball)
  get_citations(doi)            — papers that cite this DOI (S2, forward snowball)

Unified result dict:
  {doi, pmid, title, year, venue, authors[full], citation_count, is_oa, source}

Optional env: UNPAYWALL_EMAIL (OpenAlex polite-pool mailto),
              SEMANTIC_SCHOLAR_API_KEY (higher S2 rate limit). Both optional.

Self-check:  python -m dd_agent.tools.paperfetch
"""
from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

_HTML_TAG = re.compile(r"<[^>]+>")

OPENALEX_API = "https://api.openalex.org/works"
S2_API = "https://api.semanticscholar.org/graph/v1"
_MAILTO = os.environ.get("UNPAYWALL_EMAIL", "dd-agent@example.com")

# venue/externalIds/openAccessPdf give us venue, doi+pmid, and is_oa in one call
_S2_FIELDS = "paperId,title,year,citationCount,authors,journal,venue,externalIds,openAccessPdf"


# ----------------------------------------------------------------------------
# HTTP + normalization helpers
# ----------------------------------------------------------------------------
def _http_json(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        raise RuntimeError(f"request failed ({url.split('?')[0]}): {e}") from e


def _clean(s: str | None) -> str:
    """Strip HTML tags (OpenAlex titles embed <i>/<sub>) and unescape entities."""
    return html.unescape(_HTML_TAG.sub("", s or "")).strip()


def _norm_doi(doi: str | None) -> str:
    """Strip URL/scheme prefixes and lowercase, so the same DOI dedups across sources."""
    if not doi:
        return ""
    doi = doi.strip()
    for p in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.lower().startswith(p):
            doi = doi[len(p):]
    return doi.lower()


def _norm_openalex(w: dict) -> dict:
    authors = [(a.get("author") or {}).get("display_name", "")
               for a in w.get("authorships", [])]
    pmid = (w.get("ids") or {}).get("pmid") or ""
    if pmid:
        pmid = pmid.rstrip("/").split("/")[-1]          # pubmed URL -> bare id
    source = (w.get("primary_location") or {}).get("source") or {}
    return {
        "doi": _norm_doi(w.get("doi")),
        "pmid": pmid or None,
        "title": _clean(w.get("title")),
        "year": w.get("publication_year"),
        "venue": _clean(source.get("display_name")),
        "authors": [a for a in authors if a],
        "citation_count": w.get("cited_by_count", 0),
        "is_oa": bool((w.get("open_access") or {}).get("is_oa")),
        "source": "openalex",
    }


def _norm_s2(p: dict) -> dict:
    ext = p.get("externalIds") or {}
    venue = (p.get("journal") or {}).get("name") or p.get("venue") or ""
    return {
        "doi": _norm_doi(ext.get("DOI")),
        "pmid": str(ext["PubMed"]) if ext.get("PubMed") else None,
        "title": _clean(p.get("title")),
        "year": p.get("year"),
        "venue": _clean(venue),
        "authors": [a.get("name", "") for a in (p.get("authors") or []) if a.get("name")],
        "citation_count": p.get("citationCount", 0),
        "is_oa": bool(p.get("openAccessPdf")),
        "source": "semantic_scholar",
    }


# ----------------------------------------------------------------------------
# Per-source fetch
# ----------------------------------------------------------------------------
def _openalex_search(query: str, size: int) -> list[dict]:
    params = {"search": query, "per_page": max(1, min(size, 50)), "mailto": _MAILTO}
    data = _http_json(f"{OPENALEX_API}?{urllib.parse.urlencode(params)}")
    return [_norm_openalex(w) for w in (data.get("results") or [])]


def _s2_get(path: str, params: dict) -> dict:
    headers = {"Accept": "application/json"}
    key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    if key:
        headers["x-api-key"] = key
    return _http_json(f"{S2_API}{path}?{urllib.parse.urlencode(params)}", headers)


def _s2_search(query: str, size: int) -> list[dict]:
    data = _s2_get("/paper/search",
                   {"query": query, "limit": max(1, min(size, 100)), "fields": _S2_FIELDS})
    return [_norm_s2(p) for p in (data.get("data") or [])]


# OpenAlex citation graph — keyless, so references/citations don't depend on an S2
# API key (none is provisioned). S2 still backs multi-source *search* above.
def _openalex_work_by_doi(doi: str) -> dict:
    doi = _norm_doi(doi)
    if not doi:
        raise RuntimeError("a DOI is required")
    return _http_json(f"{OPENALEX_API}/doi:{urllib.parse.quote(doi, safe='')}"
                      f"?mailto={urllib.parse.quote(_MAILTO)}")


def _reconstruct_abstract(inv: dict | None) -> str:
    """OpenAlex stores abstracts as an inverted index {word: [positions]}; rebuild the text."""
    if not inv:
        return ""
    positions: list[tuple[int, str]] = []
    for word, locs in inv.items():
        for p in locs:
            positions.append((p, word))
    positions.sort()
    return " ".join(w for _, w in positions)


def _s2_paper_by_doi(doi: str) -> dict | None:
    """Fetch a single paper (incl. abstract) from Semantic Scholar by DOI. None on failure."""
    d = _norm_doi(doi)
    if not d:
        return None
    try:
        return _s2_get("/paper/DOI:" + d,
                       {"fields": "title,abstract,year,venue,authors,externalIds"})
    except Exception:  # noqa: BLE001
        return None


def abstract_by_doi(doi: str) -> dict | None:
    """Resolve a DOI to {doi,title,year,venue,authors,abstract,...} for claim extraction in the
    deep-research fetch step. OpenAlex for metadata; falls back to Semantic Scholar for the
    abstract (OpenAlex omits many abstracts for licensing → empty inverted index). None if
    unresolved / no title."""
    rec: dict | None = None
    try:
        w = _openalex_work_by_doi(doi)
        rec = _norm_openalex(w)
        rec["abstract"] = _reconstruct_abstract(w.get("abstract_inverted_index"))
    except RuntimeError:
        rec = None

    if rec is None or not rec.get("abstract"):
        s2 = _s2_paper_by_doi(doi)
        if s2:
            if rec is None:
                rec = {
                    "doi": _norm_doi(doi),
                    "pmid": str(s2["externalIds"]["PubMed"]) if (s2.get("externalIds") or {}).get("PubMed") else None,
                    "title": _clean(s2.get("title")),
                    "year": s2.get("year"),
                    "venue": _clean(s2.get("venue")),
                    "authors": [a.get("name", "") for a in (s2.get("authors") or []) if a.get("name")],
                    "source": "semantic_scholar",
                }
            if not rec.get("abstract"):
                rec["abstract"] = s2.get("abstract") or ""
    return rec if rec and rec.get("title") else None


def _openalex_by_ids(work_urls: list[str], size: int) -> list[dict]:
    """Fetch metadata for OpenAlex work IDs (batched OR-filter), preserving input order."""
    ids = [w.rsplit("/", 1)[-1] for w in work_urls][:size]
    got: dict[str, dict] = {}
    for i in range(0, len(ids), 50):                       # OpenAlex OR-filter caps ~50/req
        batch = ids[i:i + 50]
        params = {"filter": "openalex_id:" + "|".join(batch),
                  "per_page": len(batch), "mailto": _MAILTO}
        data = _http_json(f"{OPENALEX_API}?{urllib.parse.urlencode(params)}")
        for w in (data.get("results") or []):
            got[(w.get("id") or "").rsplit("/", 1)[-1]] = _norm_openalex(w)
    return [got[i] for i in ids if i in got]


# ----------------------------------------------------------------------------
# Merge / dedup
# ----------------------------------------------------------------------------
def _fill(base: dict, extra: dict) -> None:
    """Backfill empty fields of `base` from `extra`; OR the OA flag; union sources."""
    for f in ("pmid", "title", "year", "venue", "citation_count"):
        if not base.get(f) and extra.get(f):
            base[f] = extra[f]
    if not base.get("authors") and extra.get("authors"):
        base["authors"] = extra["authors"]
    base["is_oa"] = bool(base.get("is_oa")) or bool(extra.get("is_oa"))
    srcs = set(base["source"].split("+")) | set(extra["source"].split("+"))
    base["source"] = "+".join(sorted(srcs))


def _merge(*lists: list[dict]) -> list[dict]:
    """Dedup by normalized DOI (fallback: lowercased title), preserving first-seen order."""
    out: dict[str, dict] = {}
    order: list[str] = []
    for lst in lists:
        for r in lst:
            key = r["doi"] or (f"title:{r['title'].lower().strip()}" if r["title"] else "")
            if not key:
                continue
            if key not in out:
                out[key] = dict(r)
                order.append(key)
            else:
                _fill(out[key], r)
    return [out[k] for k in order]


# ----------------------------------------------------------------------------
# Public API (wrapped as @tool in worker.py)
# ----------------------------------------------------------------------------
def search_literature_multi(query: str, size: int = 10) -> list[dict]:
    """OpenAlex + Semantic Scholar fused search, deduped by DOI, OA-tagged.

    Returns [{doi,pmid,title,year,venue,authors,citation_count,is_oa,source}],
    relevance order. Tolerates one source failing; raises only if both fail.
    """
    size = max(1, min(size, 50))
    oa: list[dict] = []
    s2: list[dict] = []
    try:
        oa = _openalex_search(query, size)
    except RuntimeError:
        pass
    try:
        s2 = _s2_search(query, size)
    except RuntimeError:
        pass
    if not oa and not s2:
        raise RuntimeError("both OpenAlex and Semantic Scholar requests failed")
    return _merge(oa, s2)[:size]


def get_references(doi: str, size: int = 20) -> list[dict]:
    """Papers cited BY `doi` (backward snowball). DOI-keyed via OpenAlex (keyless)."""
    work = _openalex_work_by_doi(doi)
    return _openalex_by_ids(work.get("referenced_works") or [], size)


def get_citations(doi: str, size: int = 20) -> list[dict]:
    """Papers that CITE `doi` (forward snowball). DOI-keyed via OpenAlex (keyless)."""
    work = _openalex_work_by_doi(doi)
    wid = (work.get("id") or "").rsplit("/", 1)[-1]
    if not wid:
        return []
    params = {"filter": f"cites:{wid}", "per_page": max(1, min(size, 50)),
              "sort": "cited_by_count:desc", "mailto": _MAILTO}
    data = _http_json(f"{OPENALEX_API}?{urllib.parse.urlencode(params)}")
    return [_norm_openalex(w) for w in (data.get("results") or [])][:size]


# ----------------------------------------------------------------------------
# APA7 (7th edition) reference formatting — deterministic, generated from metadata
# ----------------------------------------------------------------------------
def _apa7_author(name: str) -> str:
    """'James S. Jumper' -> 'Jumper, J. S.' (best-effort APA inverted form)."""
    parts = [p for p in name.replace(".", " ").split() if p]
    if len(parts) < 2:
        return name.strip()
    initials = " ".join(f"{p[0].upper()}." for p in parts[:-1])
    return f"{parts[-1]}, {initials}"


def _apa7_authors(authors: list[str]) -> str:
    names = [_apa7_author(a) for a in authors if a]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) <= 20:
        return ", ".join(names[:-1]) + ", & " + names[-1]
    return ", ".join(names[:19]) + ", ... " + names[-1]      # APA7: 21+ authors


def format_apa7(rec: dict) -> str:
    """One unified record -> an APA7 journal-article reference. Volume/issue/pages are
    unavailable from OpenAlex/S2, which APA7 permits omitting. Venue is *italicised*
    (markdown) for frontend rendering."""
    bits = []
    authors = _apa7_authors(rec.get("authors") or [])
    if authors:
        bits.append(authors)
    bits.append(f"({rec['year']})." if rec.get("year") else "(n.d.).")
    title = (rec.get("title") or "").strip().rstrip(".")
    if title:
        bits.append(f"{title}.")
    venue = (rec.get("venue") or "").strip()
    if venue:
        bits.append(f"*{venue}*.")
    if rec.get("doi"):
        bits.append(f"https://doi.org/{rec['doi']}")
    return " ".join(bits)


def cite_by_doi(doi: str) -> str | None:
    """Resolve a bare DOI to its APA7 reference via OpenAlex. None if unresolved."""
    try:
        rec = _norm_openalex(_openalex_work_by_doi(doi))
    except RuntimeError:
        return None
    return format_apa7(rec) if rec.get("title") else None


# ----------------------------------------------------------------------------
# Self-check
# ----------------------------------------------------------------------------
def _selfcheck() -> int:
    print("== search_literature_multi ==")
    res = search_literature_multi("CFH age-related macular degeneration", size=5)
    for r in res:
        print(f"  DOI:{r['doi'] or '—'} pmid:{r['pmid'] or '—'} oa:{r['is_oa']} "
              f"[{r['source']}] ({r['year']}) {(r['title'] or '')[:55]}")
    ok = any(r["doi"] for r in res)

    seed = next((r["doi"] for r in res if r["doi"]), None)
    refs_ok = False
    if seed:
        print(f"\n== get_references({seed}) [OpenAlex] ==")
        refs = get_references(seed, size=3)
        refs_ok = len(refs) > 0
        for r in refs:
            print(f"  DOI:{r['doi'] or '—'} ({r['year']}) {(r['title'] or '')[:55]}")
        print(f"\n== get_citations({seed}) [OpenAlex] ==")
        for r in get_citations(seed, size=2):
            print(f"  DOI:{r['doi'] or '—'} cited:{r['citation_count']} {(r['title'] or '')[:45]}")

    print("\n== APA7 ==")
    for r in res[:2]:
        print(f"  {format_apa7(r)}")

    print(f"\n{'PASS' if ok and refs_ok else 'FAIL'}: {len(res)} hits "
          f"({sum(1 for r in res if r['doi'])} w/DOI), refs_ok={refs_ok}")
    return 0 if (ok and refs_ok) else 1


if __name__ == "__main__":
    import sys
    sys.exit(_selfcheck())
