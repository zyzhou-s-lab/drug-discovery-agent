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
import { abstractByDoi, cellxgeneDatasets, hcaProjects, ontologyLookup, openTargetTargets, searchLiteratureMulti } from "./tools/paperfetch";
import { toolDoc } from "./toolspec";

export interface LitDeps {
  searchLiteratureMulti: typeof searchLiteratureMulti;
  abstractByDoi: typeof abstractByDoi;
  ontologyLookup: typeof ontologyLookup;
  openTargetTargets: typeof openTargetTargets;
  cellxgeneDatasets: typeof cellxgeneDatasets;
  hcaProjects: typeof hcaProjects;
}
const DEFAULT_DEPS: LitDeps = { searchLiteratureMulti, abstractByDoi, ontologyLookup, openTargetTargets, cellxgeneDatasets, hcaProjects };

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

/** get_cellxgene_datasets body → dataset JSON, or "[]" when empty/error (never throws). */
export async function cellxgeneText(query: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rows: unknown[] = [];
  try {
    rows = await deps.cellxgeneDatasets(query, OT_TARGETS_SIZE);
  } catch (e) {
    toolError("get_cellxgene_datasets", e, query);
    rows = [];
  }
  return rows.length ? JSON.stringify(rows) : "[]";
}

/** get_hca_projects body → project JSON, or "[]" when empty/error (never throws). */
export async function hcaText(organ: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rows: unknown[] = [];
  try {
    rows = await deps.hcaProjects(organ, 15);
  } catch (e) {
    toolError("get_hca_projects", e, organ);
    rows = [];
  }
  return rows.length ? JSON.stringify(rows) : "[]";
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Build the literature MCP server dict to spread into runAgent's extraMcp. */
export function makeLitMcp(deps: LitDeps = DEFAULT_DEPS, disabled: Set<string> = new Set()): Record<string, unknown> {
  // tool descriptions come from the single source (toolspec.ts) — same string the settings UI shows
  const searchLit = tool("search_literature", toolDoc("search_literature"), { query: z.string() },
    async (args: { query: string }) => text(await searchLiteratureText(args.query ?? "", deps)));
  const getPaper = tool("get_paper", toolDoc("get_paper"), { doi: z.string() },
    async (args: { doi: string }) => text(await getPaperText(args.doi ?? "", deps)));
  const ontology = tool("ontology_lookup", toolDoc("ontology_lookup"), { query: z.string() },
    async (args: { query: string }) => text(await ontologyText(args.query ?? "", deps)));
  const otTargets = tool("get_opentarget_targets", toolDoc("get_opentarget_targets"), { disease: z.string() },
    async (args: { disease: string }) => text(await openTargetsText(args.disease ?? "", deps)));
  const cellxgene = tool("get_cellxgene_datasets", toolDoc("get_cellxgene_datasets"), { query: z.string() },
    async (args: { query: string }) => text(await cellxgeneText(args.query ?? "", deps)));
  const hca = tool("get_hca_projects", toolDoc("get_hca_projects"), { organ: z.string() },
    async (args: { organ: string }) => text(await hcaText(args.organ ?? "", deps)));
  // Focused, single-source MCP servers (the settings 工具 page groups by these). Each tool is filtered
  // by the toolgate disabled set → a toggle takes effect on the next run. search_disease lives in the
  // intake agent's own `opentargets` server (intake.ts); here `opentargets` carries the target query.
  const pick = <T,>(items: T[], names: string[]): T[] => items.filter((_, i) => !disabled.has(names[i]!));
  return {
    literature: createSdkMcpServer({ name: "literature", version: "1.0.0", tools: pick([searchLit, getPaper], ["search_literature", "get_paper"]) }),
    ontology: createSdkMcpServer({ name: "ontology", version: "1.0.0", tools: pick([ontology], ["ontology_lookup"]) }),
    opentargets: createSdkMcpServer({ name: "opentargets", version: "1.0.0", tools: pick([otTargets], ["get_opentarget_targets"]) }),
    cellatlas: createSdkMcpServer({ name: "cellatlas", version: "1.0.0", tools: pick([cellxgene, hca], ["get_cellxgene_datasets", "get_hca_projects"]) }),
  };
}
