// Phase-0 de-risk spike for the Bun/TS migration (docs/bun-migration-eval.md §2b/§7).
// GO/NO-GO gate: does the TS Agent SDK do forced submit_* (in-process MCP) + custom base_url +
// settingSources:[] + env injection on a NON-Anthropic backend (mimo/kimi/deepseek)?
// Result (2026-06-21, Kimi): GO — model invoked the forced tool with valid structured args.
//
// Reproduce:
//   bun add @anthropic-ai/claude-agent-sdk zod
//   SPIKE_BASE_URL=… SPIKE_TOKEN=… SPIKE_MODEL=… bun scripts/bun-phase0-spike.ts
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const BASE_URL = process.env.SPIKE_BASE_URL!;
const TOKEN = process.env.SPIKE_TOKEN!;
const MODEL = process.env.SPIKE_MODEL!;
if (!BASE_URL || !TOKEN || !MODEL) {
  console.error("need SPIKE_BASE_URL / SPIKE_TOKEN / SPIKE_MODEL");
  process.exit(2);
}

// forced structured output = an in-process MCP tool the prompt makes the ONLY completion action,
// captured via closure — exactly the Python `submit_*` pattern.
let captured: unknown = null;
const submit = tool(
  "submit_result",
  "Submit the structured result. Call exactly once.",
  { answer: z.string(), confidence: z.enum(["high", "medium", "low"]) },
  async (args) => {
    captured = args;
    return { content: [{ type: "text", text: "ok" }] };
  },
);
const server = createSdkMcpServer({ name: "spike", version: "1.0.0", tools: [submit] });

const prompt =
  "Answer the question by calling the submit_result tool exactly once. " +
  "Question: what is the capital of France? Set answer to the city name, confidence to high. " +
  "Your ONLY completion action is to call submit_result — no prose, no explanation.";

const t0 = Date.now();
let sawToolUse = false, sawResult = false, isError = false, resultText = "";
try {
  for await (const msg of query({
    prompt,
    options: {
      model: MODEL,
      mcpServers: { spike: server },
      settingSources: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 4,
      env: { ...process.env, ANTHROPIC_BASE_URL: BASE_URL, ANTHROPIC_AUTH_TOKEN: TOKEN, ANTHROPIC_MODEL: MODEL },
    },
  } as any)) {
    const m = msg as any;
    if (m.type === "assistant") {
      for (const b of m.message?.content ?? []) if (b.type === "tool_use") sawToolUse = true;
    }
    if (m.type === "result") { sawResult = true; isError = !!m.is_error; resultText = m.result ?? ""; }
  }
} catch (e) {
  console.error("QUERY THREW:", (e as Error).message);
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n=== SPIKE VERDICT ===");
console.log("base_url:", BASE_URL, "| model:", MODEL, "| elapsed:", dt + "s");
console.log("forced tool CALLED:", captured !== null, "| captured:", JSON.stringify(captured));
console.log("saw tool_use:", sawToolUse, "| saw result:", sawResult, "| result is_error:", isError);
console.log("result text:", resultText.slice(0, 200));
console.log(
  captured !== null
    ? "\n✅ GO — TS SDK forced submit_* + custom base_url works on this backend"
    : "\n❌ NO-GO — model did not invoke the forced tool on this backend",
);
