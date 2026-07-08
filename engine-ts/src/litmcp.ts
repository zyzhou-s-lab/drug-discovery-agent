// Phase-3b TS port of deep_research.py _lit_server — the in-process MCP exposing the literature
// tools (search_literature / get_paper / ontology_lookup), injected additively into search/fetch
// agents (the `extraMcp` arg of runAgent). Each tool NEVER throws (a failing tool makes the agent
// loop) — it returns "[]" / "NOT_FOUND" and best-effort emits a tool_error.
//
// The tool BODIES are standalone, dependency-injected functions (searchLiteratureText/…) so they
// unit-test without mocking the SDK or the paperfetch module. See bun-migration-eval §5.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { emit } from "./events";
import { abstractByDoi, ontologyLookup, openTargetTargets, searchLiteratureMulti } from "./tools/paperfetch";

export interface LitDeps {
  searchLiteratureMulti: typeof searchLiteratureMulti;
  abstractByDoi: typeof abstractByDoi;
  ontologyLookup: typeof ontologyLookup;
  openTargetTargets: typeof openTargetTargets;
}
const DEFAULT_DEPS: LitDeps = { searchLiteratureMulti, abstractByDoi, ontologyLookup, openTargetTargets };

// Tuned constants (verbatim from deep_research.py _lit_server). LIT_SEARCH_SIZE is intentionally
// below searchLiteratureMulti's default 10: these results carry abstracts + tldr, so a smaller set
// bounds the context the fetch agent ingests.
const LIT_SEARCH_SIZE = 8;
const ONTOLOGY_LIST = "mondo,efo,hp,go";
const ONTOLOGY_SIZE = 12;
const OT_TARGETS_SIZE = 25;

function toolError(name: string, err: unknown, argSummary: string): void {
  try {
    emit("deep-research", "lit", "tool_error", {
      tool: name,
      error: String(err instanceof Error ? err.message : err).slice(0, 500),
      args_summary: argSummary.slice(0, 200),
    });
  } catch {
    // diagnostics must never crash the tool
  }
}

/** search_literature body → the tool's text payload. Slims rows + drops untitled; "[]" on error. */
export async function searchLiteratureText(query: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  try {
    const rows = await deps.searchLiteratureMulti(query, LIT_SEARCH_SIZE);
    // carry abstract + tldr so the agent can extract claims directly (no extra get_paper hop)
    const slim = rows
      .filter((r) => r.title)
      .map((r) => ({
        doi: r.doi, title: r.title, year: r.year, venue: r.venue, authors: r.authors ?? [],
        citation_count: r.citation_count, tldr: r.tldr ?? "", abstract: r.abstract ?? "",
      }));
    return JSON.stringify(slim);
  } catch (e) {
    toolError("search_literature", e, query);
    return "[]";
  }
}

/** get_paper body → the record JSON, or "NOT_FOUND" if unresolved (never throws). */
export async function getPaperText(doi: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rec: unknown = null;
  try {
    rec = await deps.abstractByDoi(doi);
  } catch (e) {
    toolError("get_paper", e, doi);
    rec = null;
  }
  return rec ? JSON.stringify(rec) : "NOT_FOUND";
}

/** ontology_lookup body → the records JSON, or "[]" when empty/error (never throws). */
export async function ontologyText(query: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rows: unknown[] = [];
  try {
    rows = await deps.ontologyLookup(query, ONTOLOGY_LIST, ONTOLOGY_SIZE);
  } catch (e) {
    toolError("ontology_lookup", e, query);
    rows = [];
  }
  return rows.length ? JSON.stringify(rows) : "[]";
}

/** get_opentarget_targets body → ranked target JSON, or "[]" when empty/error (never throws). */
export async function openTargetsText(disease: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rows: unknown[] = [];
  try {
    rows = await deps.openTargetTargets(disease, OT_TARGETS_SIZE);
  } catch (e) {
    toolError("get_opentarget_targets", e, disease);
    rows = [];
  }
  return rows.length ? JSON.stringify(rows) : "[]";
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Build the literature MCP server dict to spread into runAgent's extraMcp. */
export function makeLitMcp(deps: LitDeps = DEFAULT_DEPS): Record<string, unknown> {
  const searchLit = tool(
    "search_literature",
    "Search peer-reviewed literature (OpenAlex + Semantic Scholar). Returns papers with " +
      "doi/title/year/venue. Use this for the scholarly-literature part of the angle.",
    { query: z.string() },
    async (args: { query: string }) => text(await searchLiteratureText(args.query ?? "", deps)),
  );
  const getPaper = tool(
    "get_paper",
    "Fetch a paper's abstract + metadata by DOI (for claim extraction).",
    { doi: z.string() },
    async (args: { doi: string }) => text(await getPaperText(args.doi ?? "", deps)),
  );
  const ontology = tool(
    "ontology_lookup",
    "Look up disease/phenotype/gene terms in ontologies (MONDO/EFO/HP/GO via EBI OLS4 API). " +
      "Returns STRUCTURED records [{id,label,ontology,definition}]. Use this for ontology IDs / " +
      "subtypes / classifications instead of WebFetch-ing ontology web pages (which need JS).",
    { query: z.string() },
    async (args: { query: string }) => text(await ontologyText(args.query ?? "", deps)),
  );
  const otTargets = tool(
    "get_opentarget_targets",
    "Get RANKED drug-target–disease associations from the Open Targets Platform (keyless GraphQL). " +
      "Accepts a disease NAME (e.g. 'metabolic dysfunction-associated steatohepatitis') OR an ontology " +
      "id (MONDO/EFO/HP). Returns STRUCTURED rows [{symbol,name,ensemblId,score,evidence:{genetic_" +
      "association,literature,clinical,...}}] ranked by overall association score. Use this for the " +
      "target-discovery / druggable-target part of an angle instead of WebFetch-ing the Open Targets " +
      "website (which needs JS and returns nothing).",
    { disease: z.string() },
    async (args: { disease: string }) => text(await openTargetsText(args.disease ?? "", deps)),
  );
  return { lit: createSdkMcpServer({ name: "lit", version: "1.0.0", tools: [searchLit, getPaper, ontology, otTargets] }) };
}
