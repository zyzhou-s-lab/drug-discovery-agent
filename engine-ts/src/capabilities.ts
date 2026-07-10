// Capability inventory surfaced in the settings page (技能 + 工具/MCP). Built ENTIRELY from the single
// source of truth (toolspec.ts) — the `desc` shown here is the exact string the model reads, so UI and
// model never drift. `enabled` reflects the toolgate store; `required` tools (search_disease — intake
// depends on it) can't be disabled. The internal `submit` server is excluded (forced-output plumbing).
import { getDisabledTools } from "./toolgate";
import { SERVER_LABELS, type ServerId, TOOL_SPECS } from "./toolspec";

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
}
export interface ToolInfo {
  name: string;
  desc: string; // == toolspec doc (what the model reads)
  params: ToolParam[];
  required: boolean; // core tool — toggle locked
  enabled: boolean;
}
export interface ToolGroup {
  server: string;
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

const SERVER_ORDER: ServerId[] = ["literature", "ontology", "opentargets", "cellatlas"];

export function getCapabilities(): Capabilities {
  const disabled = getDisabledTools();
  const toolGroups: ToolGroup[] = SERVER_ORDER.map((server) => ({
    server,
    kind: "mcp" as const,
    label: SERVER_LABELS[server],
    tools: TOOL_SPECS.filter((s) => s.server === server).map((s) => ({
      name: s.name,
      desc: s.doc, // single source — same text the agent reads
      params: s.params,
      required: Boolean(s.required),
      enabled: Boolean(s.required) || !disabled.has(s.name),
    })),
  }));
  return {
    // No model-invoked skills yet — the deep-research pipeline runs fixed stages over the MCP tools above.
    skills: [],
    toolGroups,
  };
}
