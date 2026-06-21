// Phase-3c TS port of deep_research.py research() — the five-phase engine: Search → Fetch → Verify
// → Synthesize over pre-scoped angles. Uses the ported primitives: runAgent (3a), the literature
// MCP (3b), the pure logic (core: dedupResults/rankClaims/survives), the zod schemas (3b), and
// paperfetch.citeByDoi (2b). Prompts are verbatim from the Python. research() accepts an injected
// runAgent for offline orchestration tests. See docs/bun-migration-eval.md Phase 3.
import { Budget, MAX_FETCH, MAX_VERIFY_CLAIMS, CONF_RANK, dedupResults, normUrl, rankClaims, type SearchResult, survives, VOTES_PER_CLAIM, REFUTATIONS_REQUIRED, MAX_DB_RAW } from "./core";
import { makeLitMcp } from "./litmcp";
import { type OnMessage, runAgent as realRunAgent, type RunAgentOpts, Semaphore, type ToolResult } from "./orchestrate";
import { ExtractSchema, ReportSchema, SearchSchema, VerdictSubmitSchema } from "./schemas";
import { citeByDoi } from "./tools/paperfetch";

const END = (toolName: string) =>
  `\n\nYour ONLY completion action is to call \`${toolName}\` exactly once with the structured ` +
  `result. Do NOT write a prose answer, a summary, or a Sources list — just call the tool.`;

export interface Angle {
  label: string;
  query: string;
  rationale?: string;
}

/** The shape FETCH_PROMPT reads from a search result. */
export interface FetchSource {
  url?: string;
  doi?: string | null;
  title?: string | null;
  source_type?: string;
}

/** The shape VERIFY_PROMPT / synthBlock read from an extracted claim. */
export interface VerifyClaim {
  claim: string;
  quote?: string;
  sourceUrl?: string;
  sourceQuality?: string;
}

export function SEARCH_PROMPT(question: string, angle: Angle): string {
  return (
    "## Source Scout: " + angle.label + "\n\n" +
    'Research question: "' + question + '"\n\n' +
    "Your angle: **" + angle.label + "** — " + (angle.rationale ?? "") + "\n" +
    "Search query: `" + angle.query + "`\n\n" +
    "## Task\nFind the top 4-8 most relevant sources for this angle, drawing on THREE kinds of sources:\n" +
    "1. **web** — use WebSearch for guidelines, reviews, institutional pages. Skip SEO spam/content farms.\n" +
    "2. **paper** — use the `search_literature` tool for peer-reviewed papers; return each paper's `doi`.\n" +
    "3. **database** — when relevant, surface AUTHORITATIVE database / ontology API records and return their\n" +
    "   record/API URL: disease ontologies (EFO/MONDO via EBI OLS4), gene/variant resources\n" +
    "   (Ensembl, MyGene, ClinVar), trial registries (ClinicalTrials.gov), and — when the angle touches\n" +
    "   genetics / expression / perturbation — functional-genomics & cohort resources: GWAS Catalog and\n" +
    "   population cohorts (UK Biobank, FinnGen), perturbation / screen atlases (LINCS L1000 & CMap,\n" +
    "   DepMap, Perturb-seq / CRISPR screens), and single-cell atlases (CELLxGENE, Human Cell Atlas,\n" +
    "   disease-specific atlases e.g. SEA-AD). Prefer primary databases.\n\n" +
    "Tag every result with `source_type` (web | paper | database). For paper set `doi`; for web/database set `url`.\n" +
    "Rank by relevance to the ORIGINAL question, not just the search query. Add a short snippet per result.\n\n" +
    "BE FAST — this is only source DISCOVERY, not reading:\n" +
    "- Make AT MOST ~2 WebSearch calls and ~1 `search_literature` call total, then submit. Do not loop.\n" +
    "- Do NOT WebFetch / open pages here — just return the URLs/DOIs; a later step reads them.\n" +
    "- A database result is just a known record/API URL (e.g. an OLS4 term URL); return it, don't fetch it.\n\n" +
    "NOTE: database / dataset records are PRIMARY factual sources — freely surface them and capture the\n" +
    "exact field values as data, INCLUDING quantitative ones (GWAS associations, LINCS L1000 / CMap\n" +
    "signatures, DepMap dependencies, OpenTargets scores, cohort sizes). Record concrete values verbatim." +
    END("submit_results")
  );
}

export function FETCH_PROMPT(question: string, source: FetchSource, angle: string): string {
  const st = source.source_type ?? "web";
  let retrieve: string;
  if (st === "paper") {
    retrieve =
      "## Task\n1. Call the `get_paper` tool with this DOI to retrieve the abstract + metadata:\n" +
      "   **DOI:** " + (source.doi ?? "") + "\n" +
      '   (if it returns NOT_FOUND or an empty abstract, return claims: [] and sourceQuality: "unreliable")\n';
  } else if (st === "database") {
    retrieve =
      "## Task\n1. Read this database / ontology record and extract its CONCRETE fields. For ontology\n" +
      "   terms (MONDO/EFO/HP/GO) PREFER the `ontology_lookup` tool (returns structured records);\n" +
      "   otherwise WebFetch the API / record URL:\n" +
      "   **URL:** " + (source.url ?? "") + "\n" +
      "   Treat it as a PRIMARY source; capture the EXACT record fields/values (IDs, gene-subtype\n" +
      "   mappings, counts, classifications) — not a vague prose summary.\n";
  } else {
    retrieve = "## Task\n1. Use WebFetch to retrieve the page content:\n   **URL:** " + (source.url ?? "") + "\n";
  }
  return (
    "## Source Extractor (" + st + ")\n\n" +
    'Research question: "' + question + '"\n\n' +
    "Extract key claims from this source:\n" +
    "**Title:** " + (source.title ?? "") + "\n**Found via:** " + angle + " search\n\n" +
    retrieve +
    "2. Assess source quality: primary research/database/institution? secondary reporting? blog/opinion? forum? unreliable?\n" +
    "3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n" +
    "   - be a concrete, checkable statement (not vague generalities)\n" +
    "   - include a direct quote (or the exact field value, for database records) as support\n" +
    "   - be rated central/supporting/tangential to the research question\n" +
    "4. Note publish date if available.\n\n" +
    'If retrieval fails or the content is irrelevant/paywalled, return claims: [] and sourceQuality: "unreliable".' +
    END("submit_claims")
  );
}

export function VERIFY_PROMPT(question: string, claim: VerifyClaim, v: number): string {
  return (
    "## Adversarial Claim Verifier (voter " + (v + 1) + "/" + VOTES_PER_CLAIM + ")\n\n" +
    "Be SKEPTICAL. Try to REFUTE this claim. ≥" + REFUTATIONS_REQUIRED + "/" + VOTES_PER_CLAIM + " refutations kill it.\n\n" +
    "## Research question\n" + question + "\n\n" +
    '## Claim under review\n"' + claim.claim + '"\n\n' +
    "**Source:** " + claim.sourceUrl + " (" + claim.sourceQuality + ")\n" +
    '**Supporting quote:** "' + (claim.quote ?? "") + '"\n\n' +
    "## Checklist\n" +
    "1. Is the claim actually supported by the quote, or is it an overreach/misread?\n" +
    "2. WebSearch for contradicting evidence — does any credible source dispute or heavily qualify this? " +
    "Use WebFetch to read a page; for peer-reviewed papers use `search_literature` / `get_paper`.\n" +
    "3. Is the source quality sufficient for the claim's strength? (extraordinary claims need primary sources)\n" +
    "4. Is the claim outdated? (check dates — old claims about fast-moving fields are suspect)\n" +
    "5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?\n\n" +
    "**refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\n" +
    "**refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.\n" +
    "Default to refuted=true if uncertain. Evidence MUST be specific." +
    END("submit_verdict")
  );
}

function synthBlock(confirmed: any[], dbContext?: any[]): string {
  const parts: string[] = [];
  confirmed.forEach((c, i) => {
    const kept = c.verdicts.filter((v: any) => !v.refuted);
    const best = kept.length ? [...kept].sort((a, b) => (CONF_RANK[a.confidence] ?? 3) - (CONF_RANK[b.confidence] ?? 3))[0] : {};
    parts.push(
      "### [" + i + "] " + c.claim + "\n" +
      "Vote: " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes +
      " · Source: " + c.sourceUrl + " (" + c.sourceQuality + ")\n" +
      'Quote: "' + (c.quote ?? "") + '"\nVerifier evidence (' + (best.confidence ?? "low") + "): " + (best.evidence ?? "") + "\n",
    );
  });
  if (dbContext && dbContext.length) {
    parts.push("\n## Raw database records (authoritative — cite values directly)\n");
    let totalDb = 0;
    for (const rec of dbContext) {
      const rawText = String(rec.raw ?? "").slice(0, 12000);
      if (totalDb + rawText.length > MAX_DB_RAW) {
        parts.push("\n(... remaining database records truncated to stay within token limits ...)\n");
        break;
      }
      totalDb += rawText.length;
      parts.push("### " + rec.sourceUrl + " (" + rec.sourceQuality + ")\n```\n" + rawText + "\n```\n");
    }
  }
  return parts.join("\n");
}

export function SYNTH_PROMPT(question: string, confirmed: any[], killed: any[], dbRawContext?: any[], angles?: Angle[]): string {
  const block = synthBlock(confirmed, dbRawContext);
  let killedBlock = "";
  if (killed.length) {
    killedBlock = "\n## Refuted claims (for transparency)\n" + killed
      .map((c) => '- "' + c.claim + '" (' + c.sourceUrl + ", vote " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes + ")")
      .join("\n");
  }
  let dbInstruction = "";
  if (dbRawContext && dbRawContext.length) {
    dbInstruction =
      "\n8. For findings backed by database sources, you MUST cite the concrete field values " +
      "(ontology IDs, gene symbols, association scores, classification terms, cohort sizes) " +
      "from the raw records above. Do NOT paraphrase into vague summaries — the raw records " +
      "are authoritative primary data.";
  }
  let angleSection = "";
  if (angles && angles.length) {
    const angleList = angles.map((a, idx) => idx + 1 + '. angle="' + a.label + '" — ' + (a.rationale ?? a.query ?? "")).join("\n");
    angleSection =
      "\n## Research angles (from Scope phase)\n" +
      "The disease was decomposed into these research angles:\n" + angleList + "\n\n" +
      "You MUST produce EXACTLY " + angles.length + " findings — one per angle above, in the same order.\n" +
      "Each finding MUST include an `angle` field set to the EXACT angle label string shown above.\n" +
      "The `findings` array length MUST equal " + angles.length + ".\n" +
      'If an angle yielded no confirmed claims, still include it with confidence: "low" ' +
      "and evidence explaining insufficient data.\n" +
      "Do NOT write a generic literature review. Address each angle individually.\n";
  }
  return (
    "## Synthesis: research report\n\n" +
    "**Question:** " + question + "\n\n" +
    confirmed.length + " claims survived " + VOTES_PER_CLAIM + "-vote adversarial verification. " +
    "Merge semantic duplicates and synthesize.\n\n" +
    angleSection +
    "## Confirmed claims\n" + block + "\n" + killedBlock + "\n\n" +
    "## Instructions\n" +
    "1. Identify claims that say the same thing — merge them, combine their sources.\n" +
    "2. For each research angle, produce ONE finding. The `angle` field is REQUIRED — set it to the exact angle label.\n" +
    "3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n" +
    "4. Write a 3-5 sentence executive summary answering the research question.\n" +
    "5. Note caveats: what's uncertain, what sources were weak, what time-sensitivity applies.\n" +
    "6. List 2-4 open questions that emerged but weren't answered." +
    dbInstruction +
    END("submit_report")
  );
}

/** From the sources backing CONFIRMED claims, build one unified, sequentially-numbered reference
 * list (papers get an APA7 string via citeByDoi). */
export async function bibliography(confirmed: any[], allSources: any[]): Promise<any[]> {
  // Index each confirmed claim by BOTH its doi key AND its normalized-URL key (defensive over the
  // Python's single key): a source then matches on either, so a claim/source whose doi and url keys
  // diverge (e.g. an anomalous claim missing a doi the source has) is never silently dropped.
  const cited = new Set<string>();
  for (const c of confirmed) {
    const doi = (c.doi ?? "").trim().toLowerCase();
    if (doi) cited.add("doi:" + doi);
    if (c.sourceUrl) cited.add(normUrl(c.sourceUrl));
  }
  const refs: any[] = [];
  const seen = new Set<string>();
  for (const s of allSources) {
    const doi = (s.doi ?? "").trim().toLowerCase();
    const key = doi ? "doi:" + doi : normUrl(s.url ?? "");
    if (!cited.has(key) || seen.has(key)) continue;
    seen.add(key);
    const st = s.source_type ?? "web";
    const n = refs.length + 1;
    if (st === "paper" && s.doi) {
      let apa: string | null = null;
      try {
        apa = await citeByDoi(s.doi);
      } catch {
        apa = null;
      }
      refs.push({ n, kind: "paper", doi: s.doi, apa7: apa ?? "", title: s.title });
    } else {
      refs.push({ n, kind: st === "database" ? "database" : "web", title: s.title, url: s.url });
    }
  }
  return refs;
}

export type RunAgentFn = (
  phase: string, prompt: string, submitName: string, schema: any, extraMcp: Record<string, unknown>,
  budget: Budget, sem: Semaphore, opts?: RunAgentOpts,
) => Promise<[Record<string, unknown> | null, ToolResult[]]>;

export interface ResearchOpts {
  budget?: Budget;
  sem?: Semaphore;
  onEvent?: (phase: string, message: string) => void;
  onProgress?: (phase: string, done: number, total: number) => void;
  onAgent?: (label: string, msg: unknown) => void;
  shouldStop?: () => boolean;
  fetchBudget?: number;
  maxVerifyClaims?: number;
  runAgent?: RunAgentFn; // injectable for offline orchestration tests
  lit?: Record<string, unknown>; // injectable; defaults to makeLitMcp()
}

/** Run Search→Fetch→Verify→Synthesize over pre-scoped `angles`. Returns the report dict (or a
 * salvage dict on empty paths). 1:1 port of deep_research.py research(). */
export async function research(question: string, angles: Angle[], opts: ResearchOpts = {}): Promise<Record<string, any>> {
  const budget = opts.budget ?? new Budget();
  const sem = opts.sem ?? new Semaphore(parseInt(process.env.DD_DR_CONC ?? "6", 10));
  const fetchBudget = opts.fetchBudget ?? MAX_FETCH;
  const maxVerifyClaims = opts.maxVerifyClaims ?? MAX_VERIFY_CLAIMS;
  const runAgent: RunAgentFn = opts.runAgent ?? realRunAgent;
  let lit = opts.lit;
  if (lit === undefined) {
    try {
      lit = makeLitMcp();
    } catch {
      lit = {};
    }
  }

  const ev = (phase: string, message: string) => {
    try {
      opts.onEvent?.(phase, message);
    } catch { /* best-effort */ }
  };
  const amsg = (label: string): OnMessage | undefined => (opts.onAgent ? (m) => opts.onAgent!(label, m) : undefined);

  const prog: Record<string, [number, number]> = { search: [0, angles.length], fetch: [0, 0], verify: [0, 0], synthesize: [0, 1] };
  const emitProg = (phase: string) => {
    try {
      opts.onProgress?.(phase, prog[phase]![0], prog[phase]![1]);
    } catch { /* best-effort */ }
  };
  const bump = (phase: string, ddone = 0, dtotal = 0) => {
    prog[phase]![0] += ddone;
    prog[phase]![1] += dtotal;
    emitProg(phase);
  };
  for (const ph of Object.keys(prog)) emitProg(ph);

  const seen: Record<string, { angle: string; title?: string }> = {};
  const dupes: unknown[] = [];
  const budgetDropped: unknown[] = [];
  const slots: [number] = [fetchBudget];

  // ── pipeline: search → dedup → fetch+extract (link-level concurrency, one barrier at the end) ──
  const angleChain = async (angle: Angle): Promise<any[]> => {
    const [sr] = await runAgent("search", SEARCH_PROMPT(question, angle), "submit_results", SearchSchema.shape, lit!, budget, sem, {
      onMessage: amsg("search · " + angle.label.slice(0, 28)),
      shouldStop: opts.shouldStop,
    });
    if (!sr || !(sr as any).results) {
      ev("search", angle.label + ": 0 结果");
      bump("search", 1);
      return [];
    }
    const results = (sr as any).results as SearchResult[];
    ev("search", angle.label + ": " + results.length + " 结果");
    bump("search", 1);
    const novel = dedupResults(results, angle.label, seen, slots, dupes, budgetDropped);
    if (novel.length < results.length) ev("search", angle.label + ": " + novel.length + " 新 (" + (results.length - novel.length) + " 过滤)");
    bump("fetch", 0, novel.length);

    const fetchOne = async (source: any): Promise<any | null> => {
      let host = "";
      try {
        host = new URL(source.url ?? "").hostname || "";
      } catch { /* not a URL */ }
      const flabel = "fetch · " + String(source.title || host || source.doi || "source").slice(0, 28);
      const [ext, toolResults] = await runAgent("fetch", FETCH_PROMPT(question, source, angle.label), "submit_claims", ExtractSchema.shape, lit!, budget, sem, {
        onMessage: amsg(flabel),
        shouldStop: opts.shouldStop,
      });
      bump("fetch", 1);
      if (!ext) return null;
      const sq = (ext as any).sourceQuality;
      const st = source.source_type ?? "web";
      const doi = source.doi ?? null;
      const url = source.url ?? (doi ? `https://doi.org/${doi}` : "");
      // for DATABASE sources, capture the agent's ACTUAL MCP tool results so the report preserves
      // the structured data the agent saw (not a re-fetched URL that may differ or fail).
      let raw = "";
      if (st === "database" && toolResults.length) {
        const parts: string[] = [];
        for (const tr of toolResults) {
          const content = tr.content;
          if (content == null) continue;
          let txt: string;
          if (typeof content === "string") txt = content;
          else if (Array.isArray(content)) txt = content.map((b: any) => (b && typeof b === "object" ? b.text ?? "" : String(b))).join("\n");
          else txt = JSON.stringify(content);
          if (txt.trim()) parts.push(`[${tr.tool}]\n${txt}`);
        }
        raw = parts.join("\n---\n");
      }
      return {
        url, title: source.title, angle: angle.label, source_type: st, doi, sourceQuality: sq,
        publishDate: (ext as any).publishDate,
        claims: ((ext as any).claims ?? []).map((c: any) => ({ ...c, sourceUrl: url, doi, source_type: st, sourceQuality: sq, raw })),
      };
    };

    const fetched = await Promise.all(novel.map(fetchOne));
    return fetched.filter((f): f is any => f != null);
  };

  const perAngle = await Promise.all(angles.map(angleChain));
  const allSources = perAngle.flat();
  const allClaims = allSources.flatMap((s) => s.claims);
  const dbFacts = allClaims.filter((c) => c.source_type === "database");
  const ranked = rankClaims(allClaims, maxVerifyClaims);
  ev("fetch", "抓取 " + allSources.length + " 源 → " + allClaims.length + " claims(数据库记录 " + dbFacts.length + ",数据保留)→ 验证前 " + ranked.length);

  const statsBase = {
    angles: angles.length, sources: allSources.length, claims: allClaims.length,
    dupes: dupes.length, budgetDropped: budgetDropped.length, databaseFacts: dbFacts.length,
  };

  if (!ranked.length) {
    return {
      question,
      summary: "No claims extracted. " + allSources.length + " sources fetched, all empty/failed.",
      findings: [], refuted: [],
      sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality })),
      stats: statsBase, budget: budget.report(),
    };
  }

  // ── verify: 3-vote adversarial (barrier — claim pool fully assembled first) ──
  bump("verify", 0, ranked.length * VOTES_PER_CLAIM);
  const verifyClaim = async (claim: any): Promise<any> => {
    const rawVerdicts = await Promise.all(
      Array.from({ length: VOTES_PER_CLAIM }, (_, v) =>
        runAgent("verify", VERIFY_PROMPT(question, claim, v), "submit_verdict", VerdictSubmitSchema.shape, lit!, budget, sem, {
          onMessage: amsg("verify · " + claim.claim.slice(0, 18) + " v" + (v + 1)),
          shouldStop: opts.shouldStop,
        }).then((r) => r[0]),
      ),
    );
    bump("verify", VOTES_PER_CLAIM);
    const verdicts = rawVerdicts.filter((v) => v != null) as any[];
    const refuted = verdicts.filter((v) => v.refuted).length;
    const surv = survives(verdicts);
    ev("verify", '"' + claim.claim.slice(0, 50) + '…": ' + (verdicts.length - refuted) + "-" + refuted + (surv ? " ✓" : " ✗"));
    return { ...claim, verdicts, refutedVotes: refuted, survives: surv };
  };
  const voted = await Promise.all(ranked.map(verifyClaim));
  const confirmed = voted.filter((c) => c.survives);
  const killed = voted.filter((c) => !c.survives);
  ev("verify", "验证完成:" + voted.length + " → 确认 " + confirmed.length + ",否决 " + killed.length);

  const refutedOut = killed.map((c) => ({ claim: c.claim, vote: c.verdicts.length - c.refutedVotes + "-" + c.refutedVotes, source: c.sourceUrl }));

  // raw database data — ALWAYS preserved, annotated with its verify status
  const ok = new Set(confirmed.map((c) => c.claim + "|" + c.sourceUrl));
  const no = new Set(killed.map((c) => c.claim + "|" + c.sourceUrl));
  const dbStatus = (c: any) => {
    const k = c.claim + "|" + c.sourceUrl;
    return ok.has(k) ? "confirmed" : no.has(k) ? "refuted" : "unverified";
  };
  const dbOut = dbFacts.map((c) => ({ claim: c.claim, quote: c.quote, source: c.sourceUrl, doi: c.doi, quality: c.sourceQuality, status: dbStatus(c), raw: c.raw }));

  if (!confirmed.length) {
    return {
      question,
      summary: "All " + voted.length + " claims refuted by adversarial verification. Research inconclusive — sources may be low-quality or claims overstated.",
      findings: [], refuted: refutedOut, databaseFacts: dbOut,
      sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
      stats: { ...statsBase, verified: voted.length, confirmed: 0, killed: killed.length },
      budget: budget.report(),
    };
  }

  // ── synthesize ──
  const dbRawContext = allClaims.filter((c) => c.source_type === "database" && c.raw).map((c) => ({ sourceUrl: c.sourceUrl, sourceQuality: c.sourceQuality, raw: c.raw }));
  const [synthReport] = await runAgent("synthesize", SYNTH_PROMPT(question, confirmed, killed, dbRawContext, angles), "submit_report", ReportSchema.shape, {}, budget, sem, {
    onMessage: amsg("synthesize"),
    shouldStop: opts.shouldStop,
  });
  bump("synthesize", 1);

  const sourcesOut = allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, angle: s.angle, claimCount: s.claims.length }));
  const stats = {
    ...statsBase, verified: voted.length, confirmed: confirmed.length, killed: killed.length,
    agentCalls: 1 + angles.length + allSources.length + voted.length * VOTES_PER_CLAIM + 1,
  };
  const references = await bibliography(confirmed, allSources);
  const biblio = { references, databaseFacts: dbOut };

  if (!synthReport) {
    return {
      question,
      summary: "Synthesis step was skipped or failed — returning " + confirmed.length + " verified claims unmerged.",
      findings: [],
      confirmed: confirmed.map((c) => ({ claim: c.claim, source: c.sourceUrl, quote: c.quote, vote: c.verdicts.length - c.refutedVotes + "-" + c.refutedVotes })),
      refuted: refutedOut, sources: sourcesOut, ...biblio,
      stats: { ...stats, afterSynthesis: 0 }, budget: budget.report(),
    };
  }

  ev("synthesize", "报告生成:" + ((synthReport as any).findings?.length ?? 0) + " 条发现");
  return {
    question,
    ...(synthReport as any),
    refuted: refutedOut,
    sources: sourcesOut,
    ...biblio,
    stats: { ...stats, afterSynthesis: (synthReport as any).findings?.length ?? 0 },
    budget: budget.report(),
  };
}
