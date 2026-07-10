// Capability inventory surfaced in the settings page (技能 + 工具/MCP). Mirrors the tools registered
// on the in-process MCP servers (litmcp.ts: literature/ontology/opentargets/cellatlas; intake.ts adds
// search_disease under the same `opentargets` server). The `submit` server is
// internal plumbing (forced structured output), not a user-facing capability, so it's excluded.
// Static (tools are compiled in) — keep in sync when tools change. `enabled` reflects the toolgate
// store; `required` tools (search_disease — intake depends on it) can't be disabled.
import { getDisabledTools } from "./toolgate";

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
}
export interface ToolInfo {
  name: string;
  desc: string;
  params: ToolParam[];
  required: boolean; // core tool — toggle locked
  enabled: boolean;
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

const str = (name: string): ToolParam => ({ name, type: "string", required: true });

export function getCapabilities(): Capabilities {
  const disabled = getDisabledTools();
  const mk = (name: string, desc: string, params: ToolParam[], required = false): ToolInfo => ({
    name,
    desc,
    params,
    required,
    enabled: required || !disabled.has(name),
  });
  return {
    // No model-invoked skills yet — the deep-research pipeline runs fixed stages over the MCP tools below.
    skills: [],
    toolGroups: [
      {
        server: "literature",
        kind: "mcp",
        label: "文献 · literature",
        tools: [
          mk("search_literature", "检索同行评审文献(OpenAlex + Semantic Scholar),返回可追溯论文", [str("query")]),
          mk("get_paper", "按 DOI 取论文摘要 + 元数据(用于论断抽取)", [str("doi")]),
        ],
      },
      {
        server: "ontology",
        kind: "mcp",
        label: "本体 / 术语 · ontology",
        tools: [mk("ontology_lookup", "在本体库查疾病 / 表型 / 基因术语(MONDO / EFO / HP / GO,经 EBI OLS4)", [str("query")])],
      },
      {
        server: "opentargets",
        kind: "mcp",
        label: "Open Targets · opentargets",
        tools: [
          mk("search_disease", "把疾病名解析为 Open Targets EFO id(intake 门用,EFO 命中 = 真实疾病)", [str("name")], true),
          mk("get_opentarget_targets", "给定疾病取排序后的候选靶点(Open Targets 关联分,keyless GraphQL)", [str("disease")]),
        ],
      },
      {
        server: "cellatlas",
        kind: "mcp",
        label: "单细胞 / 空间 / 图谱 · cellatlas",
        tools: [
          mk("get_cellxgene_datasets", "按疾病 / 组织找单细胞与空间转录组数据集(CZI CELLxGENE)", [str("query")]),
          mk("get_hca_projects", "按器官 / 组织找 Human Cell Atlas 项目(Azul facet)", [str("organ")]),
        ],
      },
    ],
  };
}
