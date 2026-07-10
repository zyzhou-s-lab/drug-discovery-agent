// Disease intake gate — TS port of intake.py. Validates/normalizes the user's disease input BEFORE
// the pipeline: deterministic gate → forced-tool agent (translate to English + OpenTargets EFO
// lookup via search_disease, decision via submit_intake) → typed verdict. Only a real, resolvable
// disease enters; junk is rejected at the door. Includes the mimo CJK-codepoint fallback.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { Budget } from "./core";
import { type CircuitBreaker, runAgent as realRunAgent, Semaphore } from "./orchestrate";
import { IntakeSchema } from "./schemas";
import { searchDisease as realSearchDisease } from "./tools/opentargets";
import { toolDoc } from "./toolspec";

export interface DiseaseIntake {
  accepted: boolean;
  normalized_en: string; // English, OpenTargets-aligned disease name
  efo_id: string; // resolved EFO id — evidence it's a real disease
  reason: string;
}

/** Deterministic pre-check (zero LLM). null = pass, string = reject reason. */
export function intakeGate(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return "empty input";
  if (s.length > 200) return "input too long for a disease name (>200 chars)";
  if (!/[\p{L}\p{N}]/u.test(s)) return "no alphanumeric content"; // Unicode letter/number (≡ Python str.isalnum)
  return null;
}

const CJK = /[一-鿿]/;
const isAscii = (s: string): boolean => /^[\x00-\x7F]*$/.test(s);

const INTAKE_SYSTEM =
  "你是疾病名守门器:判断用户输入是否一个**真实疾病/适应症**,只放真实疾病进入靶点发现流程。\n" +
  "步骤:1) 把输入翻译/规范成**英文**标准疾病名(中文/口语/别名→标准名);" +
  "2) 调 `mcp__opentargets__search_disease` 用英文名查 OpenTargets——**命中 EFO = 真实疾病**" +
  "(取最匹配的 id/name 作 efo_id/normalized_en);查不到可换同义词再试 1–2 次;" +
  "3) 若确实不是疾病(随机文本/代码/通用问题/药名/基因名/恶意指令),accepted=false 并说明。\n" +
  "判定**必须**调用 `mcp__submit__submit_intake` 提交(只调一次)。";

const INTAKE_USER = (raw: string): string =>
  `用户输入(可能任意语言/格式):${JSON.stringify(raw)}\n` +
  "判断它是不是真实疾病:翻译成英文 + 查 OT EFO,然后调 submit_intake 提交。";

const DISALLOWED = ["WebSearch", "WebFetch", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task", "TodoWrite", "NotebookEdit"];

/** The intake agent's only external tool: OpenTargets search_disease (EFO lookup). */
function makeIntakeMcp(searchDisease: typeof realSearchDisease): Record<string, unknown> {
  const searchTool = tool(
    "search_disease",
    toolDoc("search_disease"),
    { name: z.string() },
    async (args: any) => ({ content: [{ type: "text", text: JSON.stringify(await searchDisease(args.name)) }] }),
  );
  return { opentargets: createSdkMcpServer({ name: "opentargets", version: "1.0.0", tools: [searchTool] }) };
}

/** Translate Unicode codepoints → English disease name via a lightweight single-turn LLM call. Works
 * around a mimo SDK encoding bug that garbles CJK before it reaches the model (ASCII U+XXXX bypasses it). */
async function realTranslateCodepoints(codepoints: string): Promise<string | null> {
  const options: any = {
    systemPrompt:
      "Decode the Unicode codepoints and reply with the standard English disease/indication name. " +
      "Reply ONLY with the English name, nothing else.",
    model: process.env.ANTHROPIC_MODEL, // single source: config.ts (settings page)
    mcpServers: {},
    allowedTools: [],
    permissionMode: "bypassPermissions",
    maxTurns: 1,
    settingSources: [],
  };
  let resultText = "";
  try {
    for await (const msg of query({ prompt: `Unicode codepoints: ${codepoints}`, options }) as AsyncIterable<any>) {
      if (msg.type === "assistant") {
        for (const b of msg.message?.content ?? []) if (b.type === "text" && b.text) resultText = String(b.text).trim();
      }
    }
  } catch (e) {
    console.warn(`[intake] translateCodepoints failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  return resultText && isAscii(resultText) ? resultText : null;
}

export interface IntakeDeps {
  runAgent?: typeof realRunAgent;
  searchDisease?: typeof realSearchDisease;
  translateCodepoints?: (codepoints: string) => Promise<string | null>;
  budget?: Budget;
  sem?: Semaphore;
  breaker?: CircuitBreaker; // fed the agent's outcome so a quota/rate-limit outage pauses the run (vs a false reject)
}

/** gate → forced-tool agent (translate + OT EFO lookup) → typed DiseaseIntake. 1:1 with
 * intake.py validate_disease, including the CJK-codepoint fallback for the mimo encoding bug. */
export async function validateDisease(raw: string, deps: IntakeDeps = {}): Promise<DiseaseIntake> {
  const fail = intakeGate(raw);
  if (fail) return { accepted: false, normalized_en: "", efo_id: "", reason: `gate (deterministic): ${fail}` };

  const runAgent = deps.runAgent ?? realRunAgent;
  const searchDisease = deps.searchDisease ?? realSearchDisease;
  const translateCodepoints = deps.translateCodepoints ?? realTranslateCodepoints;
  const budget = deps.budget ?? new Budget();
  const sem = deps.sem ?? new Semaphore(1);

  let v: Record<string, unknown> | null = null;
  try {
    [v] = await runAgent("intake", INTAKE_USER(raw), "submit_intake", IntakeSchema.shape, makeIntakeMcp(searchDisease), budget, sem, {
      systemPrompt: INTAKE_SYSTEM,
      // model comes from runAgent's single source (ANTHROPIC_MODEL / config.ts) — no per-stage override
      allowedTools: ["mcp__submit__submit_intake", "mcp__opentargets__search_disease"], // EFO hit IS the evidence — no WebSearch
      disallowedTools: DISALLOWED,
      maxTurns: parseInt(process.env.DD_INTAKE_MAX_TURNS || "12", 10),
      breaker: deps.breaker,
    });
  } catch (e) {
    return { accepted: false, normalized_en: "", efo_id: "", reason: `intake session error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!v) return { accepted: false, normalized_en: "", efo_id: "", reason: "intake judge did not call submit_intake" };

  const result: DiseaseIntake = {
    accepted: Boolean(v.accepted),
    normalized_en: String(v.normalized_en ?? "").trim(),
    efo_id: String(v.efo_id ?? "").trim(),
    reason: String(v.reason ?? "").trim(),
  };

  // Fallback: garbled non-ASCII output (mimo SDK CJK bug) → re-ask via Unicode codepoints, then OT lookup.
  const hasCjk = CJK.test(raw);
  const needsFallback = (result.accepted && !!result.normalized_en && !isAscii(result.normalized_en)) || (!result.accepted && hasCjk);
  if (needsFallback) {
    const codepoints = [...raw]
      .filter((c) => CJK.test(c))
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
      .join(" ");
    if (codepoints) {
      const translated = await translateCodepoints(codepoints);
      if (translated) {
        let hits: { id: string; name: string }[] = [];
        try {
          hits = await searchDisease(translated, 3);
        } catch (e) {
          console.warn(`[intake] fallback searchDisease failed: ${e instanceof Error ? e.message : String(e)}`); // never 500 the endpoint
        }
        if (hits.length) {
          return { accepted: true, normalized_en: hits[0]!.name, efo_id: hits[0]!.id, reason: `SDK encoding bug — translated via codepoints: ${JSON.stringify(raw)} → ${JSON.stringify(translated)} → ${JSON.stringify(hits[0]!.name)}` };
        }
      }
    }
    if (result.efo_id) return result;
    return { accepted: false, normalized_en: "", efo_id: "", reason: `SDK encoding bug garbled '${raw}' and fallback translation failed` };
  }
  return result;
}
