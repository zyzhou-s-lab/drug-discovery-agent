// Phase-2b TS port of tools/paperfetch.py — OpenAlex + Semantic Scholar literature search.
// The normalization / merge / APA7 / abstract-reconstruction logic is pure and unit-tested from
// fixtures; the fetch wrappers are thin. See docs/bun-migration-eval.md Phase 2.
const OPENALEX_API = "https://api.openalex.org/works";
const S2_API = "https://api.semanticscholar.org/graph/v1";
const MAILTO = process.env.UNPAYWALL_EMAIL || "dd-agent@example.com";
const S2_FIELDS =
  "paperId,title,abstract,tldr,year,citationCount,authors,journal,venue,externalIds,openAccessPdf";

const HTML_TAG = /<[^>]+>/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function unescapeHtml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return NAMED[ent] ?? m;
  });
}

/** Strip HTML tags (OpenAlex titles embed <i>/<sub>) and unescape entities. */
export function clean(s: string | null | undefined): string {
  return unescapeHtml((s ?? "").replace(HTML_TAG, "")).trim();
}

/** Strip URL/scheme prefixes and lowercase so the same DOI dedups across sources. */
export function normDoi(doi: string | null | undefined): string {
  if (!doi) return "";
  let d = doi.trim();
  for (const p of ["https://doi.org/", "http://doi.org/", "doi:"]) {
    if (d.toLowerCase().startsWith(p)) d = d.slice(p.length);
  }
  return d.toLowerCase();
}

export interface Paper {
  doi: string;
  pmid: string | null;
  title: string;
  year: number | null;
  venue: string;
  authors: string[];
  citation_count: number;
  is_oa: boolean;
  abstract: string;
  tldr: string;
  source: string;
}

/** OpenAlex stores abstracts as an inverted index {word: [positions]}; rebuild the text. */
export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const positions: [number, string][] = [];
  for (const [word, locs] of Object.entries(inv)) for (const p of locs) positions.push([p, word]);
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ");
}

export function normOpenalex(w: any): Paper {
  const authors = (w.authorships ?? []).map((a: any) => a.author?.display_name ?? "");
  let pmid: string = (w.ids ?? {}).pmid ?? "";
  if (pmid) pmid = pmid.replace(/\/$/, "").split("/").pop() ?? "";
  const source = w.primary_location?.source ?? {};
  return {
    doi: normDoi(w.doi),
    pmid: pmid || null,
    title: clean(w.title),
    year: w.publication_year ?? null,
    venue: clean(source.display_name),
    authors: authors.filter((a: string) => a),
    citation_count: w.cited_by_count ?? 0,
    is_oa: Boolean(w.open_access?.is_oa),
    abstract: reconstructAbstract(w.abstract_inverted_index).slice(0, 600),
    tldr: "",
    source: "openalex",
  };
}

export function normS2(p: any): Paper {
  const ext = p.externalIds ?? {};
  const venue = p.journal?.name || p.venue || "";
  return {
    doi: normDoi(ext.DOI),
    pmid: ext.PubMed ? String(ext.PubMed) : null,
    title: clean(p.title),
    year: p.year ?? null,
    venue: clean(venue),
    authors: (p.authors ?? []).map((a: any) => a.name ?? "").filter((a: string) => a),
    citation_count: p.citationCount ?? 0,
    is_oa: Boolean(p.openAccessPdf),
    abstract: clean(p.abstract).slice(0, 600),
    tldr: clean(p.tldr?.text ?? ""),
    source: "semantic_scholar",
  };
}

/** Backfill empty fields of `base` from `extra`; OR the OA flag; union sources. */
export function fill(base: Paper, extra: Paper): void {
  for (const f of ["pmid", "title", "year", "venue", "citation_count", "abstract", "tldr"] as const) {
    if (!base[f] && extra[f]) (base as any)[f] = extra[f];
  }
  if (!base.authors?.length && extra.authors?.length) base.authors = extra.authors;
  base.is_oa = Boolean(base.is_oa) || Boolean(extra.is_oa);
  const srcs = new Set([...base.source.split("+"), ...extra.source.split("+")]);
  base.source = [...srcs].sort().join("+");
}

/** Dedup by normalized DOI (fallback: lowercased title), preserving first-seen order. */
export function merge(...lists: Paper[][]): Paper[] {
  const out = new Map<string, Paper>();
  const order: string[] = [];
  for (const lst of lists) {
    for (const r of lst) {
      const key = r.doi || (r.title ? `title:${r.title.toLowerCase().trim()}` : "");
      if (!key) continue;
      if (!out.has(key)) {
        out.set(key, { ...r });
        order.push(key);
      } else {
        fill(out.get(key)!, r);
      }
    }
  }
  return order.map((k) => out.get(k)!);
}

// ── HTTP ──
async function httpJson(url: string, headers?: Record<string, string>): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers: headers ?? { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(`request failed (${url.split("?")[0]}): ${(e as Error).message}`);
  }
  return resp.json();
}

async function openalexSearch(query: string, size: number): Promise<Paper[]> {
  const params = new URLSearchParams({ search: query, per_page: String(Math.max(1, Math.min(size, 50))), mailto: MAILTO });
  const data = await httpJson(`${OPENALEX_API}?${params}`);
  return (data.results ?? []).map(normOpenalex);
}

async function s2Search(query: string, size: number): Promise<Paper[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (key) headers["x-api-key"] = key;
  const params = new URLSearchParams({ query, limit: String(Math.max(1, Math.min(size, 100))), fields: S2_FIELDS });
  const data = await httpJson(`${S2_API}/paper/search?${params}`, headers);
  return (data.data ?? []).map(normS2);
}

/** OpenAlex + Semantic Scholar fused search, deduped by DOI. Tolerates one source failing. */
export async function searchLiteratureMulti(query: string, size = 10): Promise<Paper[]> {
  size = Math.max(1, Math.min(size, 50));
  let oa: Paper[] = [], s2: Paper[] = [];
  try { oa = await openalexSearch(query, size); } catch { /* one source may fail */ }
  try { s2 = await s2Search(query, size); } catch { /* one source may fail */ }
  if (!oa.length && !s2.length) throw new Error("both OpenAlex and Semantic Scholar requests failed");
  return merge(oa, s2).slice(0, size);
}

// ── APA7 (deterministic, generated from metadata) ──
/** 'James S. Jumper' -> 'Jumper, J. S.' (best-effort APA inverted form). */
export function apa7Author(name: string): string {
  const parts = name.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  const initials = parts.slice(0, -1).map((p) => `${p[0]!.toUpperCase()}.`).join(" ");
  return `${parts[parts.length - 1]}, ${initials}`;
}

export function apa7Authors(authors: string[]): string {
  const names = authors.filter(Boolean).map(apa7Author);
  if (!names.length) return "";
  if (names.length === 1) return names[0]!;
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, ... ${names[names.length - 1]}`; // APA7: 21+ authors
}

/** One unified record -> an APA7 journal-article reference (venue *italicised* for markdown). */
export function formatApa7(rec: Partial<Paper>): string {
  const bits: string[] = [];
  const authors = apa7Authors(rec.authors ?? []);
  if (authors) bits.push(authors);
  bits.push(rec.year ? `(${rec.year}).` : "(n.d.).");
  const title = (rec.title ?? "").trim().replace(/\.$/, "");
  if (title) bits.push(`${title}.`);
  const venue = (rec.venue ?? "").trim();
  if (venue) bits.push(`*${venue}*.`);
  if (rec.doi) bits.push(`https://doi.org/${rec.doi}`);
  return bits.join(" ");
}

// ── remaining HTTP capabilities (thin wrappers; integration-tested, not unit) ──
export interface OntologyTerm {
  id: string | null;
  label: string | null;
  ontology: string | null;
  definition: string;
  iri: string | null;
}

/** EBI OLS4 ontology search → structured terms. Returns [] on failure (never throws). */
export async function ontologyLookup(query: string, ontology = "mondo,efo,hp,go", size = 12): Promise<OntologyTerm[]> {
  try {
    const params = new URLSearchParams({ q: query, ontology, rows: String(Math.max(1, Math.min(size, 20))) });
    const data = await httpJson(`https://www.ebi.ac.uk/ols4/api/search?${params}`);
    const out: OntologyTerm[] = [];
    for (const d of data.response?.docs ?? []) {
      const desc = d.description;
      out.push({
        id: d.obo_id ?? d.short_form ?? null,
        label: d.label ?? null,
        ontology: d.ontology_name ?? null,
        definition: Array.isArray(desc) && desc.length ? desc[0] : typeof desc === "string" ? desc : "",
        iri: d.iri ?? null,
      });
    }
    return out.filter((o) => o.label);
  } catch {
    return [];
  }
}

/** Backend-only raw GET → JSON verbatim / HTML stripped to text. '' on failure. (Not an agent tool.) */
export async function fetchText(url: string, maxChars = 2500): Promise<string> {
  if (!/^https?:\/\//.test(url || "")) return "";
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; dd-agent/1.0)", Accept: "application/json,text/html,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
    const ctype = (resp.headers.get("Content-Type") || "").toLowerCase();
    let body = (await resp.text()).slice(0, 800_000);
    if (!ctype.includes("json")) {
      body = body.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ");
      body = unescapeHtml(body.replace(HTML_TAG, " ")).replace(/\s+/g, " ");
    }
    return body.trim().slice(0, maxChars);
  } catch {
    return "";
  }
}

async function openalexWorkByDoi(doi: string): Promise<any> {
  const d = normDoi(doi);
  if (!d) throw new Error("a DOI is required");
  return httpJson(`${OPENALEX_API}/doi:${encodeURIComponent(d)}?mailto=${encodeURIComponent(MAILTO)}`);
}

async function openalexByIds(workUrls: string[], size: number): Promise<Paper[]> {
  const ids = workUrls.map((w) => w.split("/").pop() ?? "").slice(0, size);
  const got = new Map<string, Paper>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({ filter: "openalex_id:" + batch.join("|"), per_page: String(batch.length), mailto: MAILTO });
    const data = await httpJson(`${OPENALEX_API}?${params}`);
    for (const w of data.results ?? []) got.set((w.id ?? "").split("/").pop() ?? "", normOpenalex(w));
  }
  return ids.filter((i) => got.has(i)).map((i) => got.get(i)!);
}

async function s2PaperByDoi(doi: string): Promise<any | null> {
  const d = normDoi(doi);
  if (!d) return null;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (key) headers["x-api-key"] = key;
    const params = new URLSearchParams({ fields: "title,abstract,year,venue,authors,externalIds" });
    return await httpJson(`${S2_API}/paper/DOI:${d}?${params}`, headers);
  } catch {
    return null;
  }
}

/** Resolve a DOI → metadata + abstract (OpenAlex, S2 fallback for the abstract). null if unresolved. */
export async function abstractByDoi(doi: string): Promise<Partial<Paper> | null> {
  let rec: Partial<Paper> | null = null;
  try {
    const w = await openalexWorkByDoi(doi);
    rec = normOpenalex(w);
    rec.abstract = reconstructAbstract(w.abstract_inverted_index);
  } catch {
    rec = null; // must not raise — a hanging DOI made a fetch agent loop to max_turns
  }
  if (rec === null || !rec.abstract) {
    const s2 = await s2PaperByDoi(doi);
    if (s2) {
      if (rec === null) {
        rec = {
          doi: normDoi(doi),
          pmid: (s2.externalIds ?? {}).PubMed ? String(s2.externalIds.PubMed) : null,
          title: clean(s2.title),
          year: s2.year ?? null,
          venue: clean(s2.venue),
          authors: (s2.authors ?? []).map((a: any) => a.name ?? "").filter(Boolean),
          source: "semantic_scholar",
        };
      }
      if (!rec.abstract) rec.abstract = s2.abstract || "";
    }
  }
  return rec && rec.title ? rec : null;
}

/** Papers cited BY `doi` (backward snowball), keyless via OpenAlex. */
export async function getReferences(doi: string, size = 20): Promise<Paper[]> {
  const work = await openalexWorkByDoi(doi);
  return openalexByIds(work.referenced_works ?? [], size);
}

/** Papers that CITE `doi` (forward snowball), keyless via OpenAlex. */
export async function getCitations(doi: string, size = 20): Promise<Paper[]> {
  const work = await openalexWorkByDoi(doi);
  const wid = (work.id ?? "").split("/").pop() ?? "";
  if (!wid) return [];
  const params = new URLSearchParams({
    filter: `cites:${wid}`, per_page: String(Math.max(1, Math.min(size, 50))), sort: "cited_by_count:desc", mailto: MAILTO,
  });
  const data = await httpJson(`${OPENALEX_API}?${params}`);
  return (data.results ?? []).map(normOpenalex).slice(0, size);
}

/** Resolve a bare DOI to its APA7 reference via OpenAlex. null if unresolved. */
export async function citeByDoi(doi: string): Promise<string | null> {
  let rec: Paper;
  try {
    rec = normOpenalex(await openalexWorkByDoi(doi));
  } catch {
    return null;
  }
  return rec.title ? formatApa7(rec) : null;
}
