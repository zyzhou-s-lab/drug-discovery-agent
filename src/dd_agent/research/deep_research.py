"""deep-research M2: the full five-phase engine, SDK port of the Workflow blueprint.

  Scope (scope.py) → Search → URL-dedup → Fetch+Extract → 3-vote adversarial Verify → Synthesize

Faithful port of the Claude Code `deep-research` Workflow script (its schemas / prompts /
dedup / claim-ranking / vote-survival logic are reproduced verbatim, only the structured-
output ending is changed to a forced `submit_*` MCP call, since the SDK has no StructuredOutput).

This first cut is the pure-URL pipeline (WebSearch + WebFetch), matching the blueprint exactly.
The engine is parameterized via `extra_mcp` so the planned three-source fusion (OpenTargets +
paperfetch, plan §2.4) and the DOI→evidence bibliography layer can be added in M3 without
touching the orchestration.

Structural caps match the blueprint (plan §2.2): MAX_FETCH=15 (global), VOTES_PER_CLAIM=3,
REFUTATIONS_REQUIRED=2, MAX_VERIFY_CLAIMS=25. Worst-case fan-out ≈ 1+6+15+25×3+1 ≈ 98 agents.

See docs/deep-research-port-plan.md §3–§6 and the blueprint
`…/workflows/scripts/deep-research-wf_*.js`.
"""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse

from .orchestrate import Budget, run_agent

# ─── Structural constants (verbatim from blueprint) ───
VOTES_PER_CLAIM = 3
REFUTATIONS_REQUIRED = 2
MAX_FETCH = 15
MAX_VERIFY_CLAIMS = 25

REL_RANK = {"high": 0, "medium": 1, "low": 2}
IMP_RANK = {"central": 0, "supporting": 1, "tangential": 2}
QUAL_RANK = {"primary": 0, "secondary": 1, "blog": 2, "forum": 3, "unreliable": 4}
CONF_RANK = {"high": 0, "medium": 1, "low": 2}

# ─── Schemas (full JSON Schema, passed through to the forced submit_* tool) ───
SEARCH_SCHEMA = {
    "type": "object", "required": ["results"],
    "properties": {
        "results": {"type": "array", "maxItems": 8, "items": {
            "type": "object", "required": ["title", "relevance", "source_type"],
            "properties": {
                "url": {"type": "string"},                 # web / database record-or-API URL
                "doi": {"type": "string"},                 # paper sources
                "title": {"type": "string"},
                "snippet": {"type": "string"},
                "relevance": {"enum": ["high", "medium", "low"]},
                "source_type": {"enum": ["web", "paper", "database"]},
            },
        }},
    },
}
EXTRACT_SCHEMA = {
    "type": "object", "required": ["claims", "sourceQuality"],
    "properties": {
        "sourceQuality": {"enum": ["primary", "secondary", "blog", "forum", "unreliable"]},
        "publishDate": {"type": "string"},
        "claims": {"type": "array", "maxItems": 5, "items": {
            "type": "object", "required": ["claim", "quote", "importance"],
            "properties": {
                "claim": {"type": "string"},
                "quote": {"type": "string"},
                "importance": {"enum": ["central", "supporting", "tangential"]},
            },
        }},
    },
}
VERDICT_SCHEMA = {
    "type": "object", "required": ["refuted", "evidence", "confidence"],
    "properties": {
        "refuted": {"type": "boolean"},
        "evidence": {"type": "string"},
        "confidence": {"enum": ["high", "medium", "low"]},
        "counterSource": {"type": "string"},
    },
}
REPORT_SCHEMA = {
    "type": "object", "required": ["summary", "findings", "caveats"],
    "properties": {
        "summary": {"type": "string"},
        "findings": {"type": "array", "items": {
            "type": "object", "required": ["claim", "confidence", "sources", "evidence"],
            "properties": {
                "claim": {"type": "string"},
                "confidence": {"enum": ["high", "medium", "low"]},
                "sources": {"type": "array", "items": {"type": "string"}},
                "evidence": {"type": "string"},
                "vote": {"type": "string"},
            },
        }},
        "caveats": {"type": "string"},
        "openQuestions": {"type": "array", "items": {"type": "string"}},
    },
}

# Prose-ending mitigation (plan §6 / §8.1): the SDK can't force a tool call, so every web
# agent's prompt ends by making `submit_*` the ONLY completion action — no prose, no Sources.
_END = ("\n\nYour ONLY completion action is to call `{tool}` exactly once with the structured "
        "result. Do NOT write a prose answer, a summary, or a Sources list — just call the tool.")


# Lazily-built in-process MCP exposing the literature tools (search_literature / get_paper),
# injected additively into search/fetch agents. Lazy import keeps deep_research importable
# (and unit-testable) without the SDK installed.
_LIT = None


def _lit_server():
    global _LIT
    if _LIT is not None:
        return _LIT
    import asyncio as _aio
    import json as _json

    from claude_agent_sdk import create_sdk_mcp_server, tool

    from ..tools.paperfetch import abstract_by_doi, search_literature_multi

    @tool("search_literature",
          "Search peer-reviewed literature (OpenAlex + Semantic Scholar). Returns papers with "
          "doi/title/year/venue. Use this for the scholarly-literature part of the angle.",
          {"query": str})
    async def _search_lit(args):
        rows = await _aio.to_thread(search_literature_multi, args.get("query", ""), 8)
        slim = [{"doi": r.get("doi"), "title": r.get("title"), "year": r.get("year"),
                 "venue": r.get("venue"), "citation_count": r.get("citation_count")}
                for r in rows if r.get("title")]
        return {"content": [{"type": "text", "text": _json.dumps(slim, ensure_ascii=False)}]}

    @tool("get_paper", "Fetch a paper's abstract + metadata by DOI (for claim extraction).",
          {"doi": str})
    async def _get_paper(args):
        rec = await _aio.to_thread(abstract_by_doi, args.get("doi", ""))
        if not rec:
            return {"content": [{"type": "text", "text": "NOT_FOUND"}]}
        return {"content": [{"type": "text", "text": _json.dumps(rec, ensure_ascii=False)}]}

    _LIT = {"lit": create_sdk_mcp_server("lit", "1.0.0", [_search_lit, _get_paper])}
    return _LIT


def SEARCH_PROMPT(question: str, angle: dict) -> str:
    return (
        "## Source Scout: " + angle["label"] + "\n\n"
        "Research question: \"" + question + "\"\n\n"
        "Your angle: **" + angle["label"] + "** — " + (angle.get("rationale") or "") + "\n"
        "Search query: `" + angle["query"] + "`\n\n"
        "## Task\nFind the top 4-8 most relevant sources for this angle, drawing on THREE kinds of sources:\n"
        "1. **web** — use WebSearch for guidelines, reviews, institutional pages. Skip SEO spam/content farms.\n"
        "2. **paper** — use the `search_literature` tool for peer-reviewed papers; return each paper's `doi`.\n"
        "3. **database** — when relevant, surface AUTHORITATIVE database / ontology API records and return their\n"
        "   record/API URL: disease ontologies (EFO/MONDO via EBI OLS4), gene/variant resources\n"
        "   (Ensembl, MyGene, ClinVar), trial registries (ClinicalTrials.gov). Prefer primary databases.\n\n"
        "Tag every result with `source_type` (web | paper | database). For paper set `doi`; for web/database set `url`.\n"
        "Rank by relevance to the ORIGINAL question, not just the search query. Add a short snippet per result.\n\n"
        "GUARDRAIL: databases here are for IDENTIFICATION / CLASSIFICATION / qualitative facts (ontology IDs,\n"
        "subtypes, gene roles) only. Do NOT fetch or eyeball quantitative association scores or target rankings\n"
        "(e.g. OpenTargets association scores) — that is a separate downstream step."
        + _END.format(tool="submit_results")
    )


def FETCH_PROMPT(question: str, source: dict, angle: str) -> str:
    st = source.get("source_type") or "web"
    if st == "paper":
        retrieve = ("## Task\n1. Call the `get_paper` tool with this DOI to retrieve the abstract + metadata:\n"
                    "   **DOI:** " + (source.get("doi") or "") + "\n"
                    "   (if it returns NOT_FOUND or an empty abstract, return claims: [] and sourceQuality: \"unreliable\")\n")
    elif st == "database":
        retrieve = ("## Task\n1. Use WebFetch to GET this database / ontology API record and read its structured fields:\n"
                    "   **URL:** " + (source.get("url") or "") + "\n"
                    "   Treat it as a PRIMARY source; extract the concrete records (IDs, classifications, qualitative facts).\n")
    else:
        retrieve = ("## Task\n1. Use WebFetch to retrieve the page content:\n"
                    "   **URL:** " + (source.get("url") or "") + "\n")
    return (
        "## Source Extractor (" + st + ")\n\n"
        "Research question: \"" + question + "\"\n\n"
        "Extract key claims from this source:\n"
        "**Title:** " + (source.get("title") or "") + "\n**Found via:** " + angle + " search\n\n"
        + retrieve +
        "2. Assess source quality: primary research/database/institution? secondary reporting? blog/opinion? forum? unreliable?\n"
        "3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n"
        "   - be a concrete, checkable statement (not vague generalities)\n"
        "   - include a direct quote (or the exact field value, for database records) as support\n"
        "   - be rated central/supporting/tangential to the research question\n"
        "4. Note publish date if available.\n\n"
        "If retrieval fails or the content is irrelevant/paywalled, return claims: [] and sourceQuality: \"unreliable\"."
        + _END.format(tool="submit_claims")
    )


def VERIFY_PROMPT(question: str, claim: dict, v: int) -> str:
    return (
        "## Adversarial Claim Verifier (voter " + str(v + 1) + "/" + str(VOTES_PER_CLAIM) + ")\n\n"
        "Be SKEPTICAL. Try to REFUTE this claim. ≥" + str(REFUTATIONS_REQUIRED) + "/" + str(VOTES_PER_CLAIM) + " refutations kill it.\n\n"
        "## Research question\n" + question + "\n\n"
        "## Claim under review\n\"" + claim["claim"] + "\"\n\n"
        "**Source:** " + str(claim.get("sourceUrl")) + " (" + str(claim.get("sourceQuality")) + ")\n"
        "**Supporting quote:** \"" + claim.get("quote", "") + "\"\n\n"
        "## Checklist\n"
        "1. Is the claim actually supported by the quote, or is it an overreach/misread?\n"
        "2. WebSearch for contradicting evidence — does any credible source dispute or heavily qualify this?\n"
        "3. Is the source quality sufficient for the claim's strength? (extraordinary claims need primary sources)\n"
        "4. Is the claim outdated? (check dates — old claims about fast-moving fields are suspect)\n"
        "5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?\n\n"
        "**refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\n"
        "**refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.\n"
        "Default to refuted=true if uncertain. Evidence MUST be specific."
        + _END.format(tool="submit_verdict")
    )


def _synth_block(confirmed: list) -> str:
    parts = []
    for i, c in enumerate(confirmed):
        kept = [v for v in c["verdicts"] if not v.get("refuted")]
        best = sorted(kept, key=lambda v: CONF_RANK.get(v.get("confidence"), 3))[0] if kept else {}
        parts.append(
            "### [" + str(i) + "] " + c["claim"] + "\n"
            "Vote: " + str(len(c["verdicts"]) - c["refutedVotes"]) + "-" + str(c["refutedVotes"]) +
            " · Source: " + str(c.get("sourceUrl")) + " (" + str(c.get("sourceQuality")) + ")\n"
            "Quote: \"" + c.get("quote", "") + "\"\nVerifier evidence (" + str(best.get("confidence", "low")) + "): "
            + str(best.get("evidence", "")) + "\n"
        )
    return "\n".join(parts)


def SYNTH_PROMPT(question: str, confirmed: list, killed: list) -> str:
    block = _synth_block(confirmed)
    killed_block = ""
    if killed:
        killed_block = "\n## Refuted claims (for transparency)\n" + "\n".join(
            "- \"" + c["claim"] + "\" (" + str(c.get("sourceUrl")) + ", vote "
            + str(len(c["verdicts"]) - c["refutedVotes"]) + "-" + str(c["refutedVotes"]) + ")"
            for c in killed
        )
    return (
        "## Synthesis: research report\n\n"
        "**Question:** " + question + "\n\n"
        + str(len(confirmed)) + " claims survived " + str(VOTES_PER_CLAIM) + "-vote adversarial verification. "
        "Merge semantic duplicates and synthesize.\n\n"
        "## Confirmed claims\n" + block + "\n" + killed_block + "\n\n"
        "## Instructions\n"
        "1. Identify claims that say the same thing — merge them, combine their sources.\n"
        "2. Group related claims into coherent findings. Each finding should directly address the research question.\n"
        "3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n"
        "4. Write a 3-5 sentence executive summary answering the research question.\n"
        "5. Note caveats: what's uncertain, what sources were weak, what time-sensitivity applies.\n"
        "6. List 2-4 open questions that emerged but weren't answered."
        + _END.format(tool="submit_report")
    )


# ─── Pure logic (unit-tested offline; no SDK) ───
def norm_url(u: str) -> str:
    try:
        p = urlparse(u)
        host = (p.hostname or "")
        host = host[4:] if host.startswith("www.") else host
        return (host + p.path.rstrip("/")).lower()
    except Exception:
        return u.lower()


def source_key(r) -> str:
    """Dedup identity: papers by DOI, web/database by normalized URL."""
    doi = (r.get("doi") or "").strip().lower()
    return ("doi:" + doi) if doi else norm_url(r.get("url", ""))


def dedup_results(results, angle, seen, slots, dupes, budget_dropped):
    """Port of the blueprint's per-searcher dedup. Mutates seen / slots / dupes / budget_dropped.
    slots is a 1-element list (shared mutable fetch budget). Returns the novel results to fetch."""
    ordered = sorted(results, key=lambda r: REL_RANK.get(r.get("relevance"), 3))
    novel = []
    for r in ordered:
        key = source_key(r)
        if key in seen:
            dupes.append({**r, "angle": angle, "dupOf": seen[key]})
            continue
        if slots[0] <= 0 and REL_RANK.get(r.get("relevance"), 3) >= 1:
            budget_dropped.append({**r, "angle": angle})
            continue
        seen[key] = {"angle": angle, "title": r.get("title")}
        slots[0] -= 1
        novel.append(r)
    return novel


def rank_claims(claims, limit: int = MAX_VERIFY_CLAIMS):
    return sorted(
        claims,
        key=lambda c: (IMP_RANK.get(c.get("importance"), 3), QUAL_RANK.get(c.get("sourceQuality"), 5)),
    )[:limit]


def survives(verdicts) -> bool:
    """Survive only if adjudicated: a quorum of valid votes AND fewer than REFUTATIONS_REQUIRED
    refuting. Too many abstentions (null votes) = unverified, must NOT pass (else all-abstain →
    refuted=0 → false survive)."""
    valid = [v for v in verdicts if v]
    refuted = sum(1 for v in valid if v.get("refuted"))
    return len(valid) >= REFUTATIONS_REQUIRED and refuted < REFUTATIONS_REQUIRED


def _bibliography(confirmed, all_sources):
    """From the sources that backed CONFIRMED claims, split into APA7 references (papers),
    web sources, and database sources. cite_by_doi is a deterministic network format step
    (OpenAlex), run only over confirmed papers. Returns (references, webSources, dbSources)."""
    try:
        from ..tools.paperfetch import cite_by_doi
    except Exception:  # noqa: BLE001 — offline tests / paperfetch unavailable
        def cite_by_doi(_d):
            return None

    cited = set()
    for c in confirmed:
        doi = (c.get("doi") or "").strip().lower()
        cited.add(("doi:" + doi) if doi else norm_url(c.get("sourceUrl", "")))

    refs, web, db, seen = [], [], [], set()
    for s in all_sources:
        doi = (s.get("doi") or "").strip().lower()
        key = ("doi:" + doi) if doi else norm_url(s.get("url", ""))
        if key not in cited or key in seen:
            continue
        seen.add(key)
        st = s.get("source_type") or "web"
        if st == "paper" and s.get("doi"):
            try:
                apa = cite_by_doi(s["doi"])
            except Exception:  # noqa: BLE001
                apa = None
            refs.append({"n": len(refs) + 1, "doi": s["doi"], "apa7": apa or "", "title": s.get("title")})
        elif st == "database":
            db.append({"title": s.get("title"), "url": s.get("url")})
        else:
            web.append({"title": s.get("title"), "url": s.get("url")})
    return refs, web, db


# ─── Orchestration ───
async def research(question: str, angles: list, *, budget: Budget | None = None,
                   sem=None, on_event=None, on_progress=None, on_agent=None, should_stop=None,
                   fetch_budget: int = MAX_FETCH,
                   max_verify_claims: int = MAX_VERIFY_CLAIMS) -> dict:
    """Run Search→Fetch→Verify→Synthesize over pre-scoped `angles`.

    on_event(phase, message): text progress callback (worker → events.emit text lines).
    on_progress(phase, done, total): structured per-phase counters for the run UI's phase tree
    (Search 5/5, Fetch 27/27, Verify 75/75, Synthesize 1/1). Totals for fetch/verify are not
    known upfront (pipeline) and grow as the run proceeds.
    on_agent(label, msg): per-agent SDK-message callback — each agent gets a unique label so the
    UI can render one expandable session card per agent (search/fetch/verify/synth), with its
    own thinking / tool calls / outcome.
    Returns the report dict (+ refuted/sources/stats/budget), or a salvage dict on empty paths.
    """
    budget = budget or Budget()
    sem = sem or asyncio.Semaphore(int(os.environ.get("DD_DR_CONC", "6")))

    def ev(phase: str, message: str) -> None:
        if on_event is not None:
            try:
                on_event(phase, message)
            except Exception:  # noqa: BLE001
                pass

    def amsg(label: str):
        """Build a per-agent on_message callback that tags every SDK message with `label`."""
        if on_agent is None:
            return None
        return lambda m: on_agent(label, m)

    # ── per-phase progress counters for the UI phase tree ──
    prog = {"search": [0, len(angles)], "fetch": [0, 0], "verify": [0, 0], "synthesize": [0, 1]}
    plock = asyncio.Lock()

    def _emit_prog(phase: str) -> None:
        if on_progress is not None:
            try:
                on_progress(phase, prog[phase][0], prog[phase][1])
            except Exception:  # noqa: BLE001
                pass

    async def bump(phase: str, ddone: int = 0, dtotal: int = 0) -> None:
        async with plock:
            prog[phase][0] += ddone
            prog[phase][1] += dtotal
            _emit_prog(phase)

    for _ph in prog:  # seed initial totals (search known; others grow)
        _emit_prog(_ph)

    seen: dict = {}
    dupes: list = []
    budget_dropped: list = []
    slots = [fetch_budget]
    lock = asyncio.Lock()

    try:
        lit = _lit_server()  # search_literature / get_paper, injected into search + fetch agents
    except Exception:  # noqa: BLE001 — SDK/paperfetch unavailable (offline tests): run web-only
        lit = {}

    # ── pipeline: search → dedup → fetch+extract (link-level concurrency, one barrier at the end) ──
    async def angle_chain(angle: dict) -> list:
        sr = await run_agent("search", SEARCH_PROMPT(question, angle), "submit_results",
                             SEARCH_SCHEMA, lit, budget, sem,
                             on_message=amsg("search · " + angle["label"][:28]), should_stop=should_stop)
        if not sr or not sr.get("results"):
            ev("search", angle["label"] + ": 0 结果")
            await bump("search", ddone=1)
            return []
        ev("search", angle["label"] + ": " + str(len(sr["results"])) + " 结果")
        await bump("search", ddone=1)
        async with lock:
            novel = dedup_results(sr["results"], angle["label"], seen, slots, dupes, budget_dropped)
        if len(novel) < len(sr["results"]):
            ev("search", angle["label"] + ": " + str(len(novel)) + " 新 (" +
               str(len(sr["results"]) - len(novel)) + " 过滤)")
        await bump("fetch", dtotal=len(novel))

        async def fetch_one(source: dict):
            host = ""
            try:
                host = urlparse(source.get("url", "")).hostname or ""
            except Exception:  # noqa: BLE001
                host = ""
            flabel = "fetch · " + ((source.get("title") or host or source.get("doi") or "source")[:28])
            ext = await run_agent("fetch", FETCH_PROMPT(question, source, angle["label"]),
                                  "submit_claims", EXTRACT_SCHEMA, lit, budget, sem,
                                  on_message=amsg(flabel), should_stop=should_stop)
            await bump("fetch", ddone=1)
            if not ext:
                return None
            sq = ext.get("sourceQuality")
            st = source.get("source_type") or "web"
            doi = source.get("doi") or None
            url = source.get("url") or (f"https://doi.org/{doi}" if doi else "")
            return {
                "url": url, "title": source.get("title"), "angle": angle["label"],
                "source_type": st, "doi": doi, "sourceQuality": sq, "publishDate": ext.get("publishDate"),
                "claims": [{**c, "sourceUrl": url, "doi": doi, "source_type": st, "sourceQuality": sq}
                           for c in (ext.get("claims") or [])],
            }

        fetched = await asyncio.gather(*[fetch_one(s) for s in novel])
        return [f for f in fetched if f]

    per_angle = await asyncio.gather(*[angle_chain(a) for a in angles])
    all_sources = [s for chain in per_angle for s in chain]
    all_claims = [c for s in all_sources for c in s["claims"]]
    ranked = rank_claims(all_claims, max_verify_claims)
    ev("fetch", "抓取 " + str(len(all_sources)) + " 源 → " + str(len(all_claims)) +
       " claims → 验证前 " + str(len(ranked)))

    stats_base = {"angles": len(angles), "sources": len(all_sources),
                  "claims": len(all_claims), "dupes": len(dupes), "budgetDropped": len(budget_dropped)}

    if not ranked:
        return {
            "question": question,
            "summary": "No claims extracted. " + str(len(all_sources)) + " sources fetched, all empty/failed.",
            "findings": [], "refuted": [],
            "sources": [{"url": s["url"], "quality": s["sourceQuality"]} for s in all_sources],
            "stats": stats_base, "budget": budget.report(),
        }

    # ── verify: 3-vote adversarial (barrier — claim pool must be fully assembled first) ──
    await bump("verify", dtotal=len(ranked) * VOTES_PER_CLAIM)

    async def verify_claim(claim: dict) -> dict:
        verdicts = await asyncio.gather(*[
            run_agent("verify", VERIFY_PROMPT(question, claim, v), "submit_verdict",
                      VERDICT_SCHEMA, {}, budget, sem,
                      on_message=amsg("verify · " + claim["claim"][:18] + " v" + str(v + 1)),
                      should_stop=should_stop)
            for v in range(VOTES_PER_CLAIM)
        ])
        await bump("verify", ddone=VOTES_PER_CLAIM)
        valid = [v for v in verdicts if v]
        refuted = sum(1 for v in valid if v.get("refuted"))
        surv = survives(verdicts)
        abstained = VOTES_PER_CLAIM - len(valid)
        ev("verify", "\"" + claim["claim"][:50] + "…\": " + str(len(valid) - refuted) + "-" + str(refuted)
           + ((" (" + str(abstained) + " 弃权)") if abstained else "") + (" ✓" if surv else " ✗"))
        return {**claim, "verdicts": valid, "refutedVotes": refuted, "survives": surv}

    voted = await asyncio.gather(*[verify_claim(c) for c in ranked])
    confirmed = [c for c in voted if c["survives"]]
    killed = [c for c in voted if not c["survives"]]
    ev("verify", "验证完成:" + str(len(voted)) + " → 确认 " + str(len(confirmed)) + ",否决 " + str(len(killed)))

    refuted_out = [{"claim": c["claim"], "vote": str(len(c["verdicts"]) - c["refutedVotes"]) + "-"
                    + str(c["refutedVotes"]), "source": c.get("sourceUrl")} for c in killed]

    if not confirmed:
        return {
            "question": question,
            "summary": "All " + str(len(voted)) + " claims refuted by adversarial verification. "
                       "Research inconclusive — sources may be low-quality or claims overstated.",
            "findings": [], "refuted": refuted_out,
            "sources": [{"url": s["url"], "quality": s["sourceQuality"], "claimCount": len(s["claims"])}
                        for s in all_sources],
            "stats": {**stats_base, "verified": len(voted), "confirmed": 0, "killed": len(killed)},
            "budget": budget.report(),
        }

    # ── synthesize ──
    report = await run_agent("synthesize", SYNTH_PROMPT(question, confirmed, killed),
                             "submit_report", REPORT_SCHEMA, {}, budget, sem,
                             on_message=amsg("synthesize"), should_stop=should_stop)
    await bump("synthesize", ddone=1)
    sources_out = [{"url": s["url"], "quality": s["sourceQuality"], "angle": s["angle"],
                    "claimCount": len(s["claims"])} for s in all_sources]
    stats = {
        **stats_base, "verified": len(voted), "confirmed": len(confirmed), "killed": len(killed),
        "agentCalls": 1 + len(angles) + len(all_sources) + len(voted) * VOTES_PER_CLAIM + 1,
    }
    # bibliography over the sources that backed CONFIRMED claims (papers→APA7, web, database)
    references, web_sources, db_sources = _bibliography(confirmed, all_sources)
    biblio = {"references": references, "webSources": web_sources, "dbSources": db_sources}

    if not report:
        return {
            "question": question,
            "summary": "Synthesis step was skipped or failed — returning " + str(len(confirmed)) + " verified claims unmerged.",
            "findings": [],
            "confirmed": [{"claim": c["claim"], "source": c.get("sourceUrl"), "quote": c.get("quote"),
                           "vote": str(len(c["verdicts"]) - c["refutedVotes"]) + "-" + str(c["refutedVotes"])}
                          for c in confirmed],
            "refuted": refuted_out, "sources": sources_out, **biblio,
            "stats": {**stats, "afterSynthesis": 0}, "budget": budget.report(),
        }

    ev("synthesize", "报告生成:" + str(len(report.get("findings", []))) + " 条发现")
    return {
        "question": question,
        **report,
        "refuted": refuted_out,
        "sources": sources_out,
        **biblio,
        "stats": {**stats, "afterSynthesis": len(report.get("findings", []))},
        "budget": budget.report(),
    }
