// Capability inventory surfaced in the settings page (技能 + 工具/MCP). Mirrors the tools registered
// on the in-process MCP servers (litmcp.ts `lit`, intake.ts `otdisease`). The `submit` server is
// internal plumbing (forced structured output), not a user-facing capability, so it's excluded.
// Static because these tools are compiled in and don't change at runtime — keep in sync when tools change.

export interface ToolInfo {
  name: string;
  desc: string;
}
export interface ToolGroup {
  server: string; // MCP server id (mcp__<server>__<tool>) or "builtin"
  kind: "mcp" | "builtin";
  label: string;
  tools: ToolInfo[];
}
export interface SkillInfo {
  name: string;
  desc: string;
}
export interface Capabilities {
  skills: SkillInfo[];
  toolGroups: ToolGroup[];
}

export function getCapabilities(): Capabilities {
  return {
    // No model-invoked skills yet — the deep-research pipeline runs fixed stages over the MCP tools below.
    skills: [],
    toolGroups: [
      {
        server: "lit",
        kind: "mcp",
        label: "文献 / 组学 · lit",
        tools: [
          { name: "search_literature", desc: "检索同行评审文献(OpenAlex + Semantic Scholar),返回可追溯论文" },
          { name: "get_paper", desc: "按 DOI 取论文摘要 + 元数据(用于论断抽取)" },
          { name: "ontology_lookup", desc: "在本体库查疾病 / 表型 / 基因术语(MONDO / EFO / HP / GO,经 EBI OLS4)" },
          { name: "get_opentarget_targets", desc: "从 Open Targets 取排序后的「靶点–疾病」关联(keyless GraphQL)" },
          { name: "get_cellxgene_datasets", desc: "按疾病 / 组织找单细胞与空间转录组数据集(CZI CELLxGENE)" },
          { name: "get_hca_projects", desc: "按器官 / 组织找 Human Cell Atlas 项目(Azul facet)" },
        ],
      },
      {
        server: "otdisease",
        kind: "mcp",
        label: "疾病解析 · otdisease",
        tools: [{ name: "search_disease", desc: "把疾病名解析为 Open Targets EFO id(intake 门用,EFO 命中 = 真实疾病)" }],
      },
    ],
  };
}
