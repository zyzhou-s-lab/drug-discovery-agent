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
import { abstractByDoi, cellxgeneDatasets, clinicalTrials, clinvarVariants, geneInfo, gwasForGene, hcaProjects, ontologyLookup, openTargetTargets, searchLiteratureMulti } from "./tools/paperfetch";

export interface LitDeps {
  searchLiteratureMulti: typeof searchLiteratureMulti;
  abstractByDoi: typeof abstractByDoi;
  ontologyLookup: typeof ontologyLookup;
  openTargetTargets: typeof openTargetTargets;
  cellxgeneDatasets: typeof cellxgeneDatasets;
  hcaProjects: typeof hcaProjects;
  clinicalTrials: typeof clinicalTrials;
  geneInfo: typeof geneInfo;
  clinvarVariants: typeof clinvarVariants;
  gwasForGene: typeof gwasForGene;
}
const DEFAULT_DEPS: LitDeps = { searchLiteratureMulti, abstractByDoi, ontologyLookup, openTargetTargets, cellxgeneDatasets, hcaProjects, clinicalTrials, geneInfo, clinvarVariants, gwasForGene };

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

/** get_clinical_trials body → interventional drug-trial JSON, or "[]" when empty/error (never throws). */
export async function clinicalTrialsText(disease: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let rows: unknown[] = [];
  try {
    rows = await deps.clinicalTrials(disease, 20);
  } catch (e) {
    toolError("get_clinical_trials", e, disease);
    rows = [];
  }
  return rows.length ? JSON.stringify(rows) : "[]";
}

/** get_gene_info body → gene record JSON, or "NOT_FOUND" (never throws). */
export async function geneInfoText(gene: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  let r: unknown = null;
  try {
    r = await deps.geneInfo(gene);
  } catch (e) {
    toolError("get_gene_info", e, gene);
    r = null;
  }
  return r ? JSON.stringify(r) : "NOT_FOUND";
}

/** get_clinvar_variants body → {gene,pathogenicCount,variants} JSON (never throws). */
export async function clinvarText(gene: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  try {
    return JSON.stringify(await deps.clinvarVariants(gene, 10));
  } catch (e) {
    toolError("get_clinvar_variants", e, gene);
    return JSON.stringify({ gene, pathogenicCount: 0, variants: [] });
  }
}

/** get_gwas_for_gene body → {gene,snpCount,snps} JSON (never throws). */
export async function gwasText(gene: string, deps: LitDeps = DEFAULT_DEPS): Promise<string> {
  try {
    return JSON.stringify(await deps.gwasForGene(gene, 10));
  } catch (e) {
    toolError("get_gwas_for_gene", e, gene);
    return JSON.stringify({ gene, snpCount: 0, snps: [] });
  }
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** The tool definitions, grouped by the MCP server they belong to. This is the SINGLE source: the
 * descriptions here are what the model reads; capabilities.ts introspects these same objects (name /
 * description / inputSchema) for the settings page — no duplicated registry. */
export function litToolDefs(deps: LitDeps = DEFAULT_DEPS): Record<string, any[]> {
  return {
    literature: [
      tool(
        "search_literature",
        "Search peer-reviewed literature (OpenAlex + Semantic Scholar). Returns papers with " +
          "doi/title/year/venue. Use this for the scholarly-literature part of the angle.",
        { query: z.string() },
        async (args: { query: string }) => text(await searchLiteratureText(args.query ?? "", deps)),
      ),
      tool(
        "get_paper",
        "Fetch a paper's abstract + metadata by DOI (for claim extraction).",
        { doi: z.string() },
        async (args: { doi: string }) => text(await getPaperText(args.doi ?? "", deps)),
      ),
    ],
    ontology: [
      tool(
        "ontology_lookup",
        "Look up disease/phenotype/gene terms in ontologies (MONDO/EFO/HP/GO via EBI OLS4 API). " +
          "Returns STRUCTURED records [{id,label,ontology,definition}]. Use this for ontology IDs / " +
          "subtypes / classifications instead of WebFetch-ing ontology web pages (which need JS).",
        { query: z.string() },
        async (args: { query: string }) => text(await ontologyText(args.query ?? "", deps)),
      ),
    ],
    opentargets: [
      tool(
        "get_opentarget_targets",
        "Get RANKED drug-target–disease associations from the Open Targets Platform (keyless GraphQL). " +
          "Accepts a disease NAME (e.g. 'metabolic dysfunction-associated steatohepatitis') OR an ontology " +
          "id (MONDO/EFO/HP). Returns STRUCTURED rows [{symbol,name,ensemblId,score,evidence:{genetic_" +
          "association,literature,clinical,...}}] ranked by overall association score. Use this for the " +
          "target-discovery / druggable-target part of an angle instead of WebFetch-ing the Open Targets " +
          "website (which needs JS and returns nothing).",
        { disease: z.string() },
        async (args: { disease: string }) => text(await openTargetsText(args.disease ?? "", deps)),
      ),
    ],
    cellatlas: [
      tool(
        "get_cellxgene_datasets",
        "Find single-cell & spatial-transcriptomics DATASETS for a disease/tissue from the CZI CELLxGENE " +
          "Discover index (keyless). Pass a disease name or tissue (e.g. 'metabolic dysfunction-associated " +
          "steatohepatitis' or 'liver'). Returns STRUCTURED rows [{title,disease,tissue,assay,organism," +
          "cell_count,spatial,link}] (spatial=true for Visium/Slide-seq/etc.). Use this instead of " +
          "WebFetch-ing the CELLxGENE website for the single-cell / spatial part of an angle.",
        { query: z.string() },
        async (args: { query: string }) => text(await cellxgeneText(args.query ?? "", deps)),
      ),
      tool(
        "get_hca_projects",
        "Find Human Cell Atlas projects for an ORGAN/tissue (Azul facet, e.g. 'liver', 'brain', 'lung'; " +
          "keyless). Returns STRUCTURED rows [{title,organ,cell_count,lab,doi,link}]. Pass the organ, not a " +
          "disease name. Complements get_cellxgene_datasets for single-cell data availability.",
        { organ: z.string() },
        async (args: { organ: string }) => text(await hcaText(args.organ ?? "", deps)),
      ),
    ],
    clinicaltrials: [
      tool(
        "get_clinical_trials",
        "Find INTERVENTIONAL drug trials for a disease from ClinicalTrials.gov (v2 API, keyless). Returns " +
          "STRUCTURED rows [{nctId,title,status,phase,interventions:[{type,name}],conditions,url}] — the " +
          "drugs/modalities already in clinical development for this disease (real phases only; NA / " +
          "non-drug interventions filtered out). Use this for the existing-drugs / clinical-validation " +
          "part of an angle instead of WebFetch-ing the ClinicalTrials.gov site.",
        { disease: z.string() },
        async (args: { disease: string }) => text(await clinicalTrialsText(args.disease ?? "", deps)),
      ),
    ],
    genetics: [
      tool(
        "get_gene_info",
        "Get a CROSS-DATABASE gene record from MyGene.info (keyless aggregator) — ONE call folds together " +
          "NCBI Gene (summary/aliases/type), Ensembl + UniProt ids, PATHWAYS (KEGG/Reactome/WikiPathways), " +
          "InterPro protein DOMAINS, PDB STRUCTURES (presence ⇒ structural tractability), and Gene Ontology " +
          "(MF/BP). Pass a gene SYMBOL (e.g. 'PNPLA3'). Returns {symbol,name,entrezId,ensemblId,uniprotId," +
          "type,aliases,summary,pathways:[{db,id,name}],domains:[{id,name}],pdb:[...],go:{MF,BP}}. Use this " +
          "for gene function / pathway / structure / druggability context instead of WebFetch-ing NCBI Gene " +
          "/ KEGG / UniProt / PDB pages.",
        { gene: z.string() },
        async (args: { gene: string }) => text(await geneInfoText(args.gene ?? "", deps)),
      ),
      tool(
        "get_clinvar_variants",
        "Get pathogenic / likely-pathogenic ClinVar variants for a gene (NCBI, keyless): total count + top " +
          "variant summaries {gene,pathogenicCount,variants:[{title,clinicalSignificance,condition,reviewStatus}]}. " +
          "Pass a gene SYMBOL. Use this for human genetic / variant evidence instead of esearch-ing ClinVar.",
        { gene: z.string() },
        async (args: { gene: string }) => text(await clinvarText(args.gene ?? "", deps)),
      ),
      tool(
        "get_gwas_for_gene",
        "Get GWAS Catalog variants mapped to a gene (EBI, keyless): the SNP count + top rsIds/functional " +
          "classes — a genetic-association presence signal {gene,snpCount,snps:[{rsId,functionalClass}]}. " +
          "Pass a gene SYMBOL. Use this instead of hand-querying the EBI GWAS REST API.",
        { gene: z.string() },
        async (args: { gene: string }) => text(await gwasText(args.gene ?? "", deps)),
      ),
    ],
  };
}

/** Build the MCP servers (one per data source) to spread into runAgent's extraMcp. Disabled tools
 * (settings 工具 toggles) are filtered out at build time → a toggle takes effect on the next run. */
export function makeLitMcp(deps: LitDeps = DEFAULT_DEPS, disabled: Set<string> = new Set()): Record<string, unknown> {
  const defs = litToolDefs(deps);
  const srv = (name: string, tools: any[]) =>
    createSdkMcpServer({ name, version: "1.0.0", tools: tools.filter((t) => !disabled.has(t.name)) });
  return {
    literature: srv("literature", defs.literature!),
    ontology: srv("ontology", defs.ontology!),
    opentargets: srv("opentargets", defs.opentargets!),
    cellatlas: srv("cellatlas", defs.cellatlas!),
    clinicaltrials: srv("clinicaltrials", defs.clinicaltrials!),
    genetics: srv("genetics", defs.genetics!),
  };
}
