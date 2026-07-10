// Capability inventory for the settings page (技能 + 工具/MCP). Built by INTROSPECTING the real MCP
// tool definitions (litmcp.ts litToolDefs + intake.ts searchDiseaseTool) — each tool's name, description
// and inputSchema are read straight off the SDK tool object, so what the model reads and what the UI
// shows are the same thing (no separate registry, no drift). `enabled` comes from the toolgate store;
// `required` (search_disease — intake depends on it) can't be disabled. The internal `submit` server
// is excluded (forced-output plumbing).
import { litToolDefs } from "./litmcp";
import { searchDiseaseTool } from "./intake";
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
  required: boolean;
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

// UI presentation only (labels + order); tool data itself comes from the tool objects.
const SERVER_LABELS: Record<string, string> = {
  literature: "文献 · literature",
  ontology: "本体 / 术语 · ontology",
  opentargets: "Open Targets · opentargets",
  cellatlas: "单细胞 / 空间 / 图谱 · cellatlas",
};
const SERVER_ORDER = ["literature", "ontology", "opentargets", "cellatlas"];
const CORE_TOOLS = new Set(["search_disease"]); // policy: can't be disabled (intake gate needs it)

/** Read param name/type/required off a tool's zod inputSchema (SDK stores the raw shape). */
function paramsOf(inputSchema: Record<string, any> | undefined): ToolParam[] {
  return Object.entries(inputSchema ?? {}).map(([name, zt]) => {
    const t = zt?.def?.type ?? "string";
    return { name, type: t === "optional" ? (zt?.def?.innerType?.def?.type ?? "string") : t, required: t !== "optional" };
  });
}

export function getCapabilities(): Capabilities {
  const disabled = getDisabledTools();
  // introspect the actual MCP tool objects, grouped by their server
  const defs = litToolDefs();
  const bySrv: Record<string, any[]> = {
    literature: defs.literature ?? [],
    ontology: defs.ontology ?? [],
    // search_disease (intake's server) + get_opentarget_targets both live under `opentargets`
    opentargets: [searchDiseaseTool(), ...(defs.opentargets ?? [])],
    cellatlas: defs.cellatlas ?? [],
  };
  const toolGroups: ToolGroup[] = SERVER_ORDER.map((server) => ({
    server,
    kind: "mcp" as const,
    label: SERVER_LABELS[server] ?? server,
    tools: (bySrv[server] ?? []).map((t) => {
      const required = CORE_TOOLS.has(t.name);
      return {
        name: t.name,
        desc: t.description, // read straight off the MCP tool object
        params: paramsOf(t.inputSchema),
        required,
        enabled: required || !disabled.has(t.name),
      };
    }),
  }));
  return { skills: [], toolGroups };
}
