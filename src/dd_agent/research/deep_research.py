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
        "results": {"type": "array", "maxItems": 6, "items": {
            "type": "object", "required": ["url", "title", "relevance"],
            "properties": {
                "url": {"type": "string"},
                "title": {"type": "string"},
                "snippet": {"type": "string"},
                "relevance": {"enum": ["high", "medium", "low"]},
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


def SEARCH_PROMPT(question: str, angle: dict) -> str:
    return (
        "## Web Searcher: " + angle["label"] + "\n\n"
        "Research question: \"" + question + "\"\n\n"
        "Your angle: **" + angle["label"] + "** — " + (angle.get("rationale") or "") + "\n"
        "Search query: `" + angle["query"] + "`\n\n"
        "## Task\nUse WebSearch with the query above (or a refined version). Return the top 4-6 most relevant results.\n"
        "Rank by relevance to the ORIGINAL question, not just the search query. Skip obvious SEO spam/content farms.\n"
        "Include a short snippet capturing why each result is relevant."
        + _END.format(tool="submit_results")
    )


def FETCH_PROMPT(question: str, source: dict, angle: str) -> str:
    return (
        "## Source Extractor\n\n"
        "Research question: \"" + question + "\"\n\n"
        "Fetch and extract key claims from this source:\n"
        "**URL:** " + source["url"] + "\n**Title:** " + source.get("title", "") + "\n**Found via:** " + angle + " search\n\n"
        "## Task\n1. Use WebFetch to retrieve the page content.\n"
        "2. Assess source quality: primary research/institution? secondary reporting? blog/opinion? forum? unreliable?\n"
        "3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n"
        "   - be a concrete, checkable statement (not vague generalities)\n"
        "   - include a direct quote from the source as support\n"
        "   - be rated central/supporting/tangential to the research question\n"
        "4. Note publish date if available.\n\n"
        "If the fetch fails or the page is irrelevant/paywalled, return claims: [] and sourceQuality: \"unreliable\"."
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


def dedup_results(results, angle, seen, slots, dupes, budget_dropped):
    """Port of the blueprint's per-searcher dedup. Mutates seen / slots / dupes / budget_dropped.
    slots is a 1-element list (shared mutable fetch budget). Returns the novel results to fetch."""
    ordered = sorted(results, key=lambda r: REL_RANK.get(r.get("relevance"), 3))
    novel = []
    for r in ordered:
        key = norm_url(r.get("url", ""))
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


# ─── Orchestration ───
async def research(question: str, angles: list, *, budget: Budget | None = None,
                   sem=None, on_event=None, fetch_budget: int = MAX_FETCH) -> dict:
    """Run Search→Fetch→Verify→Synthesize over pre-scoped `angles`.

    on_event(phase, message): optional progress callback (worker wires it to events.emit so
    the run UI shows live phase lines; the blueprint's log() lines map here).
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

    seen: dict = {}
    dupes: list = []
    budget_dropped: list = []
    slots = [fetch_budget]
    lock = asyncio.Lock()

    # ── pipeline: search → dedup → fetch+extract (link-level concurrency, one barrier at the end) ──
    async def angle_chain(angle: dict) -> list:
        sr = await run_agent("search", SEARCH_PROMPT(question, angle), "submit_results",
                             SEARCH_SCHEMA, {}, budget, sem)
        if not sr or not sr.get("results"):
            ev("search", angle["label"] + ": 0 结果")
            return []
        ev("search", angle["label"] + ": " + str(len(sr["results"])) + " 结果")
        async with lock:
            novel = dedup_results(sr["results"], angle["label"], seen, slots, dupes, budget_dropped)
        if len(novel) < len(sr["results"]):
            ev("search", angle["label"] + ": " + str(len(novel)) + " 新 (" +
               str(len(sr["results"]) - len(novel)) + " 过滤)")

        async def fetch_one(source: dict):
            ext = await run_agent("fetch", FETCH_PROMPT(question, source, angle["label"]),
                                  "submit_claims", EXTRACT_SCHEMA, {}, budget, sem)
            if not ext:
                return None
            sq = ext.get("sourceQuality")
            return {
                "url": source["url"], "title": source.get("title"), "angle": angle["label"],
                "sourceQuality": sq, "publishDate": ext.get("publishDate"),
                "claims": [{**c, "sourceUrl": source["url"], "sourceQuality": sq}
                           for c in (ext.get("claims") or [])],
            }

        fetched = await asyncio.gather(*[fetch_one(s) for s in novel])
        return [f for f in fetched if f]

    per_angle = await asyncio.gather(*[angle_chain(a) for a in angles])
    all_sources = [s for chain in per_angle for s in chain]
    all_claims = [c for s in all_sources for c in s["claims"]]
    ranked = rank_claims(all_claims)
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
    async def verify_claim(claim: dict) -> dict:
        verdicts = await asyncio.gather(*[
            run_agent("verify", VERIFY_PROMPT(question, claim, v), "submit_verdict",
                      VERDICT_SCHEMA, {}, budget, sem)
            for v in range(VOTES_PER_CLAIM)
        ])
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
                             "submit_report", REPORT_SCHEMA, {}, budget, sem)
    sources_out = [{"url": s["url"], "quality": s["sourceQuality"], "angle": s["angle"],
                    "claimCount": len(s["claims"])} for s in all_sources]
    stats = {
        **stats_base, "verified": len(voted), "confirmed": len(confirmed), "killed": len(killed),
        "agentCalls": 1 + len(angles) + len(all_sources) + len(voted) * VOTES_PER_CLAIM + 1,
    }

    if not report:
        return {
            "question": question,
            "summary": "Synthesis step was skipped or failed — returning " + str(len(confirmed)) + " verified claims unmerged.",
            "findings": [],
            "confirmed": [{"claim": c["claim"], "source": c.get("sourceUrl"), "quote": c.get("quote"),
                           "vote": str(len(c["verdicts"]) - c["refutedVotes"]) + "-" + str(c["refutedVotes"])}
                          for c in confirmed],
            "refuted": refuted_out, "sources": sources_out,
            "stats": {**stats, "afterSynthesis": 0}, "budget": budget.report(),
        }

    ev("synthesize", "报告生成:" + str(len(report.get("findings", []))) + " 条发现")
    return {
        "question": question,
        **report,
        "refuted": refuted_out,
        "sources": sources_out,
        "stats": {**stats, "afterSynthesis": len(report.get("findings", []))},
        "budget": budget.report(),
    }
