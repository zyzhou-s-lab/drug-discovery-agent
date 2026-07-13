// Phase-3c TS port of deep_research.py research() — the five-phase engine: Search → Fetch → Verify
// → Synthesize over pre-scoped angles. Uses the ported primitives: runAgent (3a), the literature
// MCP (3b), the pure logic (core: dedupResults/rankClaims/survives), the zod schemas (3b), and
// paperfetch.citeByDoi (2b). Prompts are verbatim from the Python. research() accepts an injected
// runAgent for offline orchestration tests. See docs/bun-migration-eval.md Phase 3.
import { Budget, clampInt, IMP_RANK, lexicalClusters, MAX_FETCH, MAX_VERIFY_CLAIMS, CONF_RANK, dedupResults, normUrl, QUAL_RANK, rankClaims, type SearchResult, survives, VOTES_PER_CLAIM, REFUTATIONS_REQUIRED, MAX_DB_RAW } from "./core";
import { makeLitMcp } from "./litmcp";
import { getDisabledTools } from "./toolgate";
import { WEB_FETCH, WEB_SEARCH, webRooterMcp } from "./webrooter";
import { CircuitBreaker, type OnMessage, runAgent as realRunAgent, type RunAgentOpts, Semaphore, type ToolResult } from "./orchestrate";
import { AngleFindingSchema, ExtractSchema, MergeSchema, NominateSchema, SearchSchema, VerdictSubmitSchema } from "./schemas";
import { abstractByDoi, citeByDoi, normDoi } from "./tools/paperfetch";

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
    "1. **web** — use the `" + WEB_SEARCH + "` tool for guidelines, reviews, institutional pages. Skip SEO spam/content farms.\n" +
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
    "- Make AT MOST ~2 `" + WEB_SEARCH + "` calls and ~1 `search_literature` call total, then submit. Do not loop.\n" +
    "- Do NOT open/read pages here — just return the URLs/DOIs; a later step reads them.\n" +
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
      "   for DRUG-TARGET–disease associations (Open Targets — target lists, association scores,\n" +
      "   evidence types) PREFER the `get_opentarget_targets` tool (pass the disease name or MONDO/EFO id;\n" +
      "   returns ranked structured targets) — do NOT " + WEB_FETCH + " the Open Targets site (JS-only, returns nothing);\n" +
      "   for SINGLE-CELL / SPATIAL datasets PREFER `get_cellxgene_datasets` (disease or tissue) and\n" +
      "   `get_hca_projects` (organ, e.g. 'liver') — both return structured dataset rows;\n" +
      "   for CLINICAL TRIALS / existing drugs PREFER `get_clinical_trials` (pass the disease name; returns\n" +
      "   structured interventional drug-trial rows) — do NOT " + WEB_FETCH + " the ClinicalTrials.gov site;\n" +
      "   for a specific GENE PREFER `get_gene_info` (function + pathways KEGG/Reactome), for its human\n" +
      "   PATHOGENIC variants PREFER `get_clinvar_variants`, and for its GWAS variants PREFER\n" +
      "   `get_gwas_for_gene` (all take a gene SYMBOL) — do NOT esearch NCBI / " + WEB_FETCH + " KEGG or the EBI GWAS API;\n" +
      "   otherwise use `" + WEB_FETCH + "` on the API / record URL:\n" +
      "   **URL:** " + (source.url ?? "") + "\n" +
      "   Treat it as a PRIMARY source; capture the EXACT record fields/values (IDs, gene-subtype\n" +
      "   mappings, counts, classifications) — not a vague prose summary.\n";
  } else {
    retrieve = "## Task\n1. Use `" + WEB_FETCH + "` to retrieve the page content:\n   **URL:** " + (source.url ?? "") + "\n";
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
    "2. Use `" + WEB_SEARCH + "` for contradicting evidence — does any credible source dispute or heavily qualify this? " +
    "Use `" + WEB_FETCH + "` to read a page; for peer-reviewed papers use `search_literature` / `get_paper`.\n" +
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

// MAP step (#30 phase 3): synthesize ONE finding from a single angle's confirmed claims + its own
// database records. The prompt only ever holds one angle's data → no end-of-pipeline context pile-up.
export function ANGLE_SYNTH_PROMPT(question: string, angle: Angle, confirmed: any[], dbRawContext?: any[]): string {
  const block = synthBlock(confirmed, dbRawContext);
  const empty = confirmed.length === 0;
  // only attach the DB-citation instruction when there ARE claims (and thus a block of raw records);
  // when empty the block is hidden ("(none)") so the instruction would dangle.
  const dbInstruction = !empty && dbRawContext && dbRawContext.length
    ? "\n- For a finding backed by database sources, you MUST cite the concrete field values " +
      "(ontology IDs, gene symbols, association scores, classification terms, cohort sizes) from the " +
      "raw records above — do NOT paraphrase into a vague summary; the raw records are authoritative."
    : "";
  return (
    "## Angle Synthesis: " + angle.label + "\n\n" +
    "**Question:** " + question + "\n" +
    "**This angle:** " + angle.label + " — " + (angle.rationale ?? angle.query ?? "") + "\n\n" +
    confirmed.length + " confirmed claims for THIS angle survived " + VOTES_PER_CLAIM + "-vote adversarial verification.\n\n" +
    "## Confirmed claims (this angle only)\n" + (empty ? "(none)\n" : block) + "\n\n" +
    "## Instructions — produce EXACTLY ONE finding for this angle:\n" +
    "1. Merge claims that say the same thing; combine their sources.\n" +
    "2. `confidence`: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single/weak source).\n" +
    "3. `evidence`: 2-4 sentences synthesizing what this angle's claims establish.\n" +
    "4. `sources`: the URLs backing the finding.\n" +
    (empty
      ? '\nThis angle yielded NO confirmed claims — still return a finding with confidence "low" and evidence explaining the insufficient data.'
      : "\nAddress THIS angle specifically; do not generalize beyond its claims.") +
    dbInstruction +
    END("submit_finding")
  );
}

// REDUCE step (#30 phase 3): merge the per-angle findings into the overview prose. Input is the
// already-compressed findings (not raw claims), so this stays small regardless of corpus size.
export function MERGE_PROMPT(question: string, findings: any[]): string {
  const list = findings
    .map((f, i) => "### [" + (i + 1) + '] angle="' + (f.angle ?? "UNKNOWN") + '" (' + (f.confidence ?? "low") + ")\n" + f.claim + "\n" + (f.evidence ?? ""))
    .join("\n\n");
  return (
    "## Research Synthesis: merge\n\n" +
    "**Question:** " + question + "\n\n" +
    findings.length + " per-angle findings were produced:\n\n" + list + "\n\n" +
    "## Instructions\n" +
    "1. Write a 3-5 sentence executive summary answering the research question, drawing across the findings above.\n" +
    "2. Note caveats: what's uncertain, which sources were weak, what time-sensitivity applies.\n" +
    "3. List 2-4 open questions that emerged but weren't answered.\n" +
    "Synthesize ACROSS the findings — do not restate each one." +
    END("submit_merge")
  );
}

// ── target nomination (hybrid) ──────────────────────────────────────────────────────────────────
// Deterministic base: parse the Open Targets ranked-target rows the run actually captured in
// databaseFacts (raw = "[get_opentarget_targets] [{target,score,genetic_association,…}]"). Returns
// de-duped rows (highest overall score per symbol), score-sorted — objective, no model prior.
export function otBase(dbOut: any[]): Array<{ symbol: string; name: string | null; scores: Record<string, number>; source: string }> {
  const byS = new Map<string, { symbol: string; name: string | null; scores: Record<string, number>; source: string }>();
  for (const f of dbOut ?? []) {
    const raw = String((f as any)?.raw ?? "");
    const m = raw.match(/\[get_opentarget_targets\]\s*(\[[\s\S]*\])/);
    if (!m) continue;
    let rows: any[];
    try { rows = JSON.parse(m[1] ?? "[]"); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const symbol = String(r?.target ?? "").trim();
      if (!symbol) continue;
      const scores: Record<string, number> = {};
      for (const k of ["score", "genetic_association", "literature", "clinical"]) if (typeof r?.[k] === "number") scores[k === "score" ? "overall" : k] = r[k];
      const prev = byS.get(symbol);
      if (!prev || (scores.overall ?? 0) > (prev.scores.overall ?? 0)) byS.set(symbol, { symbol, name: r?.approvedName ?? null, scores, source: String((f as any)?.source ?? "") });
    }
  }
  return [...byS.values()].sort((a, b) => (b.scores.overall ?? 0) - (a.scores.overall ?? 0));
}

// Anti-hallucination guard: keep only candidates whose symbol is GROUNDED — it came from the Open
// Targets base, or appears as a bounded token in a confirmed claim's text/quote. Normalizes shape,
// de-dupes by symbol. This is what makes "no invented target names" enforceable, not just prompted.
export function guardCandidates(raw: any[], otPool: Array<{ symbol: string }>, confirmed: any[]): any[] {
  const baseSyms = new Set(otPool.map((r) => r.symbol.toUpperCase()));
  const evText = confirmed.map((c) => (c.claim ?? "") + " " + (c.quote ?? "")).join(" ").toUpperCase();
  const grounded = (sym: string): boolean => {
    const s = sym.toUpperCase();
    if (baseSyms.has(s)) return true;
    const esc = s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    return new RegExp("(^|[^A-Z0-9])" + esc + "([^A-Z0-9]|$)").test(evText);
  };
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of raw ?? []) {
    const symbol = String(c?.symbol ?? "").trim();
    if (!symbol || seen.has(symbol.toUpperCase()) || !grounded(symbol)) continue;
    seen.add(symbol.toUpperCase());
    out.push({
      symbol,
      name: c?.name ?? null,
      modality: c?.modality ?? null,
      evidence: Array.isArray(c?.evidence) ? c.evidence : [],
      scores: c?.scores && typeof c.scores === "object" ? c.scores : {},
      rationale: String(c?.rationale ?? ""),
    });
  }
  return out;
}

export function NOMINATE_PROMPT(question: string, otPool: Array<{ symbol: string; name: string | null; scores: Record<string, number> }>, confirmed: any[]): string {
  const base = otPool.map((r, i) => `${i + 1}. ${r.symbol}${r.name ? " (" + r.name + ")" : ""} — scores ${JSON.stringify(r.scores)}`).join("\n");
  const ev = confirmed.slice(0, 60).map((c, i) => `[C${i + 1}] ${c.claim}  «${String(c.quote ?? "").slice(0, 160)}»  — ${c.sourceUrl ?? ""}`).join("\n");
  return (
    "## Target Nominator\n\n" +
    'Research question: "' + question + '"\n\n' +
    "Nominate the most promising **drug targets** for this question, grounded ONLY in the evidence\n" +
    "below — NEVER invent gene names from prior knowledge.\n\n" +
    "## Deterministic base — Open Targets ranked, disease-associated targets (with scores)\n" +
    (base || "(none captured)") + "\n\n" +
    "## Verified evidence — adversarially-confirmed claims (each with its source)\n" +
    (ev || "(none)") + "\n\n" +
    "## Task\nProduce a RANKED list of up to 20 target candidates:\n" +
    "1. Start from the Open Targets base — those are real, disease-associated, scored targets.\n" +
    "2. You MAY add a target NOT in the base ONLY if a confirmed claim above directly implicates it\n" +
    "   (genetics / causal mechanism); cite that claim as its evidence ref. Add nothing else.\n" +
    "3. For EACH candidate fill: `symbol` (gene), `name`, `modality` (druggability if evident, else null),\n" +
    "   `scores` (carry the Open Targets scores; you may add 0-1 dims like `genetic` / `mechanism`),\n" +
    "   `evidence` (array of {kind, source, detail, ref} — `ref` MUST be a source URL/DOI from the\n" +
    "   evidence above; every target claim needs a ref), and a 1-2 sentence `rationale`.\n" +
    "4. RANK by strength of genetic + causal support relevant to the question (genetically-supported,\n" +
    "   mechanistically-implicated, tractable targets first).\n" +
    "5. Only include targets with ≥1 real piece of evidence — better 8 well-grounded than 20 thin.\n" +
    END("submit_candidates")
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

/** Read model for the frontend's literature-card list: one card per paper source (deduped by DOI),
 * enriched with structured metadata (title/authors/venue/year via OpenAlex) and tagged with our OWN
 * verify status — confirmed / refuted / uncited (retrieved but not used). The card's "summary" is the
 * extracted claim we actually used (empty for uncited). Sorted confirmed → refuted → uncited. Network
 * only (no LLM); best-effort per paper (a DOI that won't resolve keeps the source's own title). */
export async function buildLiterature(confirmed: any[], killed: any[], allSources: any[], allClaims: any[]): Promise<any[]> {
  const voteStr = (c: any) => c?.vote ?? (c?.verdicts ? c.verdicts.length - (c.refutedVotes ?? 0) + "-" + (c.refutedVotes ?? 0) : undefined);
  const byDoi = (arr: any[]) => {
    const m = new Map<string, any>();
    for (const c of arr) { const k = normDoi(c.doi ?? ""); if (k && !m.has(k)) m.set(k, c); }
    return m;
  };
  const confByDoi = byDoi(confirmed), killedByDoi = byDoi(killed), claimByDoi = byDoi(allClaims);
  const seen = new Set<string>();
  const papers: { doi: string; title: string; angle?: string }[] = [];
  for (const s of allSources) {
    if (s.source_type !== "paper" || !s.doi) continue;
    const k = normDoi(s.doi);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    papers.push({ doi: s.doi, title: s.title, angle: s.angle });
  }
  const out: any[] = [];
  for (const p of papers) { // serial (like bibliography) — avoids bursting OpenAlex
    const k = normDoi(p.doi);
    const c = confByDoi.get(k), kc = killedByDoi.get(k);
    const status = c ? "confirmed" : kc ? "refuted" : "uncited";
    const src = c ?? kc;
    const meta = await abstractByDoi(p.doi).catch(() => null);
    out.push({
      doi: p.doi,
      title: meta?.title || p.title || "",
      authors: meta?.authors ?? [],
      venue: meta?.venue ?? "",
      year: meta?.year ?? null,
      status,
      vote: voteStr(src),
      claim: status === "uncited" ? "" : (src?.claim ?? claimByDoi.get(k)?.claim ?? ""),
      angle: src?.angle ?? p.angle,
    });
  }
  const order: Record<string, number> = { confirmed: 0, refuted: 1, uncited: 2 };
  out.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  return out;
}

/** Pre-verify claim dedup (Stage A, lexical / lossless): collapse near-duplicate claims (the same
 * assertion surfacing under different angles/sources) so each fact is verified once instead of N×3.
 * Representative = the cluster's highest-importance, best-quality member; it carries `mergedRefs`
 * (every member's source) for provenance. Lossless: the bibliography reads allSources (unchanged)
 * and db records are preserved separately, so no source/evidence is dropped — only the verify set
 * shrinks. Toggle DD_DR_DEDUP=off; threshold DD_DR_DEDUP_SIM (default 0.85). */
function dedupeClaims(claims: any[]): { deduped: any[]; clusters: any[] } {
  if (process.env.DD_DR_DEDUP === "off" || claims.length < 2) return { deduped: claims, clusters: [] };
  const simRaw = parseFloat(process.env.DD_DR_DEDUP_SIM ?? "0.85");
  const sim = Number.isFinite(simRaw) ? simRaw : 0.85;
  const groups = lexicalClusters(claims.map((c) => String(c?.claim ?? "")), sim);
  const deduped: any[] = [];
  const clusters: any[] = [];
  for (const g of groups) {
    if (g.length < 2) {
      deduped.push(claims[g[0] as number]);
      continue;
    }
    // representative: highest importance, then best source quality
    const ordered = [...g].sort(
      (a, b) =>
        (IMP_RANK[claims[a]?.importance ?? ""] ?? 3) - (IMP_RANK[claims[b]?.importance ?? ""] ?? 3) ||
        (QUAL_RANK[claims[a]?.sourceQuality ?? ""] ?? 5) - (QUAL_RANK[claims[b]?.sourceQuality ?? ""] ?? 5),
    );
    const rep = claims[ordered[0] as number];
    const mergedRefs = ordered.map((i) => ({ source: claims[i]?.sourceUrl, doi: claims[i]?.doi, angle: claims[i]?.angle }));
    deduped.push({ ...rep, mergedRefs });
    clusters.push({
      representative: rep?.claim,
      members: ordered.map((i) => ({ claim: claims[i]?.claim, source: claims[i]?.sourceUrl, angle: claims[i]?.angle })),
    });
  }
  return { deduped, clusters };
}

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
  persistStep?: (step: string, key: string, payload: Record<string, unknown>) => void; // per-sub-agent deepresearch/ record (single source of truth; assets/ are derived from it)
  breaker?: CircuitBreaker; // rate-limit auto-pause; research checks .tripped in its stop predicate
  // resume-from-checkpoint: skip the completed phases when a prior run (e.g. paused by a 429) already
  // produced them. `resumeState` is loaded by the caller; `onCheckpoint` lets the caller persist the
  // post-fetch / post-verify state so a future re-run can resume the tail instead of redoing it all.
  resumeState?: { phase: "fetched" | "verified"; allSources: any[]; voted?: any[] } | null;
  onCheckpoint?: (phase: "fetched" | "verified", state: { allSources: any[]; voted?: any[] }) => void;
}

/** Run Search→Fetch→Verify→Synthesize over pre-scoped `angles`. Returns the report dict (or a
 * salvage dict on empty paths). 1:1 port of deep_research.py research(). */
export async function research(question: string, angles: Angle[], opts: ResearchOpts = {}): Promise<Record<string, any>> {
  const budget = opts.budget ?? new Budget();
  const sem = opts.sem ?? new Semaphore(parseInt(process.env.DD_DR_CONC ?? "6", 10));
  // read the workload caps live (like DD_DR_CONC above) so the Settings UI / settings.json take
  // effect on the NEXT run without an engine restart; the core constants are the defaults.
  const fetchBudget = opts.fetchBudget ?? clampInt(process.env.DD_DR_MAX_FETCH, MAX_FETCH, 1, 100);
  const maxVerifyClaims = opts.maxVerifyClaims ?? clampInt(process.env.DD_DR_MAX_CLAIMS, MAX_VERIFY_CLAIMS, 1, 80);
  const maxCandidates = clampInt(process.env.DD_DR_MAX_CANDIDATES, 20, 1, 100); // nomination top-N
  const runAgent: RunAgentFn = opts.runAgent ?? realRunAgent;
  // stop predicate seen by every agent: a user stop OR the circuit breaker tripping (sustained
  // rate-limit) — so a dead provider auto-pauses the run instead of grinding every agent to failure.
  const stopPred = () => (opts.shouldStop?.() ?? false) || (opts.breaker?.tripped ?? false);
  let lit = opts.lit;
  if (lit === undefined) {
    try {
      lit = { ...makeLitMcp(undefined, getDisabledTools()), ...webRooterMcp() };
    } catch {
      lit = {};
    }
  }

  const ev = (phase: string, message: string) => {
    try {
      opts.onEvent?.(phase, message);
    } catch { /* best-effort */ }
  };
  // per-sub-agent record under deepresearch/{step}/ — the incremental, crash-safe source of truth.
  // search/fetch/verify each spawn many agents, so every one is sedimented to its own file the moment
  // it completes; a crash/kill mid-run still leaves every finished agent's output, and assets/ are
  // derived from this afterwards (deriveAssets). Best-effort — a persist failure (disk full /
  // permission) NEVER fails the run, but is surfaced via ev (the event stream), not swallowed.
  const doPersistStep = (step: string, key: string, payload: Record<string, unknown>) => {
    try {
      opts.persistStep?.(step, key, payload);
    } catch (e) {
      ev("persist", `step '${step}/${key}' 落盘失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const pad = (n: number) => String(n).padStart(2, "0"); // ordering prefix for per-item file names
  let fetchSeq = 0; // global counters → unique, ordered file names across concurrent per-angle chains
  let verifySeq = 0;
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
  const angleChain = async (angle: Angle, aidx: number): Promise<any[]> => {
    const [sr] = await runAgent("search", SEARCH_PROMPT(question, angle), "submit_results", SearchSchema.shape, lit!, budget, sem, {
      onMessage: amsg("search · " + angle.label.slice(0, 28)),
      shouldStop: stopPred, breaker: opts.breaker,
    });
    const results = ((sr as any)?.results ?? []) as SearchResult[];
    // per-angle search agent → 02_search/NN_<angle>.json (recorded even on a 0-result/failed search)
    doPersistStep("02_search", `${pad(aidx)}_${angle.label}`, { angle: angle.label, query: angle.query, count: results.length, results });
    if (!sr || !(sr as any).results) {
      ev("search", angle.label + ": 0 结果");
      bump("search", 1);
      return [];
    }
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
        shouldStop: stopPred, breaker: opts.breaker,
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
      const record = {
        url, title: source.title, angle: angle.label, source_type: st, doi, sourceQuality: sq,
        publishDate: (ext as any).publishDate,
        // claims carry their scope angle (#30 phase 3) — the grouping key for per-angle synthesis
        claims: ((ext as any).claims ?? []).map((c: any) => ({ ...c, sourceUrl: url, doi, source_type: st, sourceQuality: sq, raw, angle: angle.label })),
      };
      // per-source fetch/extract agent → 03_fetch/NN_<source>.json
      doPersistStep("03_fetch", `${pad(++fetchSeq)}_${source.title || host || doi || "source"}`, record);
      return record;
    };

    const fetched = await Promise.all(novel.map(fetchOne));
    return fetched.filter((f): f is any => f != null);
  };

  // ── search + fetch — run the per-angle chains, OR resume: skip them when a prior run already
  // produced the sources (checkpoint written after fetch). Lets a 429-paused run continue the tail. ──
  const resume = opts.resumeState ?? null;
  let allSources: any[];
  if (resume) {
    allSources = resume.allSources ?? [];
    prog.search = [angles.length, angles.length]; emitProg("search");
    prog.fetch = [allSources.length, allSources.length]; emitProg("fetch");
    ev("search", "续跑:复用已落盘的检索 + 抓取(" + allSources.length + " 源)");
  } else {
    const perAngle = await Promise.all(angles.map((a, i) => angleChain(a, i)));
    allSources = perAngle.flat();
    opts.onCheckpoint?.("fetched", { allSources });
  }
  const allClaims = allSources.flatMap((s) => s.claims);
  const dbFacts = allClaims.filter((c) => c.source_type === "database");
  const statsBase = {
    angles: angles.length, sources: allSources.length, claims: allClaims.length,
    dupes: dupes.length, budgetDropped: budgetDropped.length, databaseFacts: dbFacts.length,
  };

  // ── verify: 3-vote adversarial (barrier) — or resume the already-verified claim pool ──
  let voted: any[];
  if (resume?.phase === "verified" && resume.voted) {
    voted = resume.voted;
    const vt = voted.length * VOTES_PER_CLAIM;
    prog.verify = [vt, vt]; emitProg("verify");
    ev("verify", "续跑:复用已落盘的 " + voted.length + " 条核验裁决");
  } else {
    // pre-verify dedup: collapse near-duplicate claims so each fact is verified once (lossless — see
    // dedupeClaims). Persisted for audit; db records + bibliography use allClaims/allSources.
    const { deduped, clusters } = dedupeClaims(allClaims);
    if (clusters.length) {
      ev("fetch", "去重:" + allClaims.length + " → " + deduped.length + " claims(合并 " + clusters.length + " 簇,每簇仅验一次)");
      doPersistStep("03b_dedup", "clusters", { before: allClaims.length, after: deduped.length, merged: clusters.length, clusters });
    }
    const ranked = rankClaims(deduped, maxVerifyClaims);
    ev("fetch", "抓取 " + allSources.length + " 源 → " + allClaims.length + " claims(数据库 " + dbFacts.length + " 保留;去重后 " + deduped.length + ")→ 验证前 " + ranked.length);
    if (!ranked.length) {
      return {
        question,
        summary: "No claims extracted. " + allSources.length + " sources fetched, all empty/failed.",
        findings: [], refuted: [],
        sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality })),
        stats: statsBase, budget: budget.report(),
      };
    }
    bump("verify", 0, ranked.length * VOTES_PER_CLAIM);
    const verifyClaim = async (claim: any): Promise<any> => {
      const rawVerdicts = await Promise.all(
        Array.from({ length: VOTES_PER_CLAIM }, (_, v) =>
          runAgent("verify", VERIFY_PROMPT(question, claim, v), "submit_verdict", VerdictSubmitSchema.shape, lit!, budget, sem, {
            onMessage: amsg("verify · " + claim.claim.slice(0, 18) + " v" + (v + 1)),
            shouldStop: stopPred, breaker: opts.breaker,
          }).then((r) => r[0]),
        ),
      );
      bump("verify", VOTES_PER_CLAIM);
      const verdicts = rawVerdicts.filter((v) => v != null) as any[];
      const refuted = verdicts.filter((v) => v.refuted).length;
      const surv = survives(verdicts);
      ev("verify", '"' + claim.claim.slice(0, 50) + '…": ' + (verdicts.length - refuted) + "-" + refuted + (surv ? " ✓" : " ✗"));
      // per-claim 3-vote verification → 04_verify/NN_<claim>.json
      doPersistStep("04_verify", `${pad(++verifySeq)}_${claim.claim}`, {
        claim: claim.claim, quote: claim.quote, source: claim.sourceUrl, doi: claim.doi, angle: claim.angle,
        votes: verdicts.length, refutedVotes: refuted, survives: surv,
        vote: (verdicts.length - refuted) + "-" + refuted, verdicts,
      });
      return { ...claim, verdicts, refutedVotes: refuted, survives: surv };
    };
    voted = await Promise.all(ranked.map(verifyClaim));
    opts.onCheckpoint?.("verified", { allSources, voted });
  }
  const confirmed = voted.filter((c) => c.survives);
  const killed = voted.filter((c) => !c.survives);
  ev("verify", "验证完成:" + voted.length + " → 确认 " + confirmed.length + ",否决 " + killed.length);

  const refutedOut = killed.map((c) => ({ claim: c.claim, vote: c.verdicts.length - c.refutedVotes + "-" + c.refutedVotes, source: c.sourceUrl }));
  // literature read-model (paper cards + our verify status) — network-only, never fails the run
  let literature: any[] = [];
  try {
    literature = await buildLiterature(confirmed, killed, allSources, allClaims);
  } catch (e) {
    console.warn("buildLiterature failed:", e instanceof Error ? e.message : e);
  }

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
      findings: [], refuted: refutedOut, candidates: [], databaseFacts: dbOut, literature,
      sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
      stats: { ...statsBase, verified: voted.length, confirmed: 0, killed: killed.length },
      budget: budget.report(),
    };
  }

  // ── synthesize: per-angle map-reduce (#30 phase 3) ── each angle is synthesized from ONLY its own
  // confirmed claims + its own database records (no end-of-pipeline context pile-up), then a light
  // merge writes the overview prose across the per-angle findings.
  const dbRawByAngle = new Map<string, any[]>();
  for (const c of allClaims) {
    if (c.source_type === "database" && c.raw) {
      const arr = dbRawByAngle.get(c.angle) ?? [];
      arr.push({ sourceUrl: c.sourceUrl, sourceQuality: c.sourceQuality, raw: c.raw });
      dbRawByAngle.set(c.angle, arr);
    }
  }
  const confirmedByAngle = new Map<string, any[]>();
  for (const c of confirmed) {
    const arr = confirmedByAngle.get(c.angle) ?? [];
    arr.push(c);
    confirmedByAngle.set(c.angle, arr);
  }

  prog.synthesize = [0, angles.length + 1]; // N angle-maps + 1 merge
  emitProg("synthesize");

  // MAP — one finding per angle, concurrent (sem-bounded). Each result is written to its OWN slot
  // (indexed by angle position, not push) so the incremental snapshot stays in angle order even when
  // a later angle finishes first; the last completing map persists all N in order. Crash-safe.
  const findingsAcc: any[] = new Array(angles.length);
  const mapAngle = async (a: Angle, idx: number): Promise<any> => {
    const conf = confirmedByAngle.get(a.label) ?? [];
    const dbr = dbRawByAngle.get(a.label) ?? [];
    const [f] = await runAgent("synthesize", ANGLE_SYNTH_PROMPT(question, a, conf, dbr), "submit_finding", AngleFindingSchema.shape, {}, budget, sem, {
      onMessage: amsg("synth · " + a.label.slice(0, 24)),
      shouldStop: stopPred, breaker: opts.breaker,
    });
    bump("synthesize", 1);
    findingsAcc[idx] = f
      ? { ...(f as any), angle: a.label } // angle AFTER spread — the caller's scope label always wins, even if the agent hallucinated an `angle`
      : { angle: a.label, claim: "(synthesis unavailable)", confidence: "low", sources: [], evidence: "Per-angle synthesis did not complete for this angle." };
    // per-angle synthesis (MAP) agent → 05_synthesize/NN_<angle>.json
    doPersistStep("05_synthesize", `${pad(idx)}_${a.label}`, findingsAcc[idx]);
    return findingsAcc[idx];
  };
  const findings = await Promise.all(angles.map((a, i) => mapAngle(a, i))); // result array preserves angle order

  // REDUCE — merge the per-angle findings into summary / caveats / openQuestions
  const [merged] = await runAgent("synthesize", MERGE_PROMPT(question, findings), "submit_merge", MergeSchema.shape, {}, budget, sem, {
    onMessage: amsg("merge"),
    shouldStop: stopPred, breaker: opts.breaker,
  });
  bump("synthesize", 1);
  // reduce/merge agent → 05_synthesize/merge.json
  doPersistStep("05_synthesize", "merge", (merged as any) ?? { summary: "", caveats: "", openQuestions: [] });
  ev("synthesize", "报告生成:" + findings.length + " 条 per-angle 发现 + 合并");

  // ── nominate: hybrid — deterministic Open Targets base (parsed from the run's own databaseFacts)
  // + LLM enrichment → ranked TargetCandidate[]. The guard drops any symbol not grounded in the base
  // or a confirmed claim, so nominated targets are always traceable, never hallucinated. ──
  const otPool = otBase(dbOut).slice(0, 30);
  let candidates: any[] = [];
  if (otPool.length || confirmed.length) {
    const [nom] = await runAgent("synthesize", NOMINATE_PROMPT(question, otPool, confirmed), "submit_candidates", NominateSchema.shape, {}, budget, sem, {
      onMessage: amsg("nominate"),
      shouldStop: stopPred, breaker: opts.breaker,
      disallowedTools: ["WebSearch", "WebFetch", "Bash"], // synthesize from the given evidence ONLY — no fetching
    });
    candidates = guardCandidates(((nom as any)?.candidates ?? []) as any[], otPool, confirmed).slice(0, maxCandidates);
    doPersistStep("06_nominate", "candidates", { question, count: candidates.length, candidates });
    ev("synthesize", "靶点提名:" + candidates.length + " 个候选靶点");
  }

  const sourcesOut = allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, angle: s.angle, claimCount: s.claims.length }));
  const references = await bibliography(confirmed, allSources);
  const stats = {
    ...statsBase, verified: voted.length, confirmed: confirmed.length, killed: killed.length,
    // 1 scope + N search + M fetch + (verify×3) + N angle-maps + 1 merge
    agentCalls: 1 + angles.length + allSources.length + voted.length * VOTES_PER_CLAIM + angles.length + 1,
    afterSynthesis: findings.length,
  };
  return {
    question,
    summary: (merged as any)?.summary ?? "Synthesized " + findings.length + " per-angle findings from " + confirmed.length + " verified claims.",
    findings,
    caveats: (merged as any)?.caveats ?? "",
    openQuestions: (merged as any)?.openQuestions ?? [],
    refuted: refutedOut,
    candidates,
    sources: sourcesOut,
    references,
    literature,
    databaseFacts: dbOut,
    stats,
    budget: budget.report(),
  };
}
