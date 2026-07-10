// Single source of truth for tool metadata. Both the MCP tool() registrations (litmcp.ts / intake.ts)
// and the settings-page inventory (capabilities.ts) read from here, so the description the MODEL sees
// and the description the USER sees are always the same string — no drift. `doc` strings are the exact
// text the agent reads when deciding to call a tool. `server` groups them for the settings page.
export type ServerId = "literature" | "ontology" | "opentargets" | "cellatlas";

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
}
export interface ToolSpec {
  name: string;
  server: ServerId;
  doc: string; // read by tool() AND shown in the UI
  params: ToolParam[];
  required?: boolean; // core tool — toggle locked (intake depends on it)
}

const q = (name: string): ToolParam => ({ name, type: "string", required: true });

export const SERVER_LABELS: Record<ServerId, string> = {
  literature: "文献 · literature",
  ontology: "本体 / 术语 · ontology",
  opentargets: "Open Targets · opentargets",
  cellatlas: "单细胞 / 空间 / 图谱 · cellatlas",
};

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "search_literature",
    server: "literature",
    doc:
      "Search peer-reviewed literature (OpenAlex + Semantic Scholar). Returns papers with " +
      "doi/title/year/venue. Use this for the scholarly-literature part of the angle.",
    params: [q("query")],
  },
  {
    name: "get_paper",
    server: "literature",
    doc: "Fetch a paper's abstract + metadata by DOI (for claim extraction).",
    params: [q("doi")],
  },
  {
    name: "ontology_lookup",
    server: "ontology",
    doc:
      "Look up disease/phenotype/gene terms in ontologies (MONDO/EFO/HP/GO via EBI OLS4 API). " +
      "Returns STRUCTURED records [{id,label,ontology,definition}]. Use this for ontology IDs / " +
      "subtypes / classifications instead of WebFetch-ing ontology web pages (which need JS).",
    params: [q("query")],
  },
  {
    name: "search_disease",
    server: "opentargets",
    doc: "Resolve a disease name to OpenTargets EFO ids. Returns JSON [{id,name}]. Empty list = not a recognized disease.",
    params: [q("name")],
    required: true, // intake gate depends on it
  },
  {
    name: "get_opentarget_targets",
    server: "opentargets",
    doc:
      "Get RANKED drug-target–disease associations from the Open Targets Platform (keyless GraphQL). " +
      "Accepts a disease NAME (e.g. 'metabolic dysfunction-associated steatohepatitis') OR an ontology " +
      "id (MONDO/EFO/HP). Returns STRUCTURED rows [{symbol,name,ensemblId,score,evidence:{genetic_" +
      "association,literature,clinical,...}}] ranked by overall association score. Use this for the " +
      "target-discovery / druggable-target part of an angle instead of WebFetch-ing the Open Targets " +
      "website (which needs JS and returns nothing).",
    params: [q("disease")],
  },
  {
    name: "get_cellxgene_datasets",
    server: "cellatlas",
    doc:
      "Find single-cell & spatial-transcriptomics DATASETS for a disease/tissue from the CZI CELLxGENE " +
      "Discover index (keyless). Pass a disease name or tissue (e.g. 'metabolic dysfunction-associated " +
      "steatohepatitis' or 'liver'). Returns STRUCTURED rows [{title,disease,tissue,assay,organism," +
      "cell_count,spatial,link}] (spatial=true for Visium/Slide-seq/etc.). Use this instead of " +
      "WebFetch-ing the CELLxGENE website for the single-cell / spatial part of an angle.",
    params: [q("query")],
  },
  {
    name: "get_hca_projects",
    server: "cellatlas",
    doc:
      "Find Human Cell Atlas projects for an ORGAN/tissue (Azul facet, e.g. 'liver', 'brain', 'lung'; " +
      "keyless). Returns STRUCTURED rows [{title,organ,cell_count,lab,doi,link}]. Pass the organ, not a " +
      "disease name. Complements get_cellxgene_datasets for single-cell data availability.",
    params: [q("organ")],
  },
];

/** The description the model reads for a tool — the single source for tool() registrations. */
export function toolDoc(name: string): string {
  const s = TOOL_SPECS.find((t) => t.name === name);
  if (!s) throw new Error(`toolDoc: unknown tool ${name}`); // fail loud — a typo shouldn't silently ship an empty desc
  return s.doc;
}
