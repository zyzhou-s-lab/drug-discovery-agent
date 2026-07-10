// Phase-3 live smoke: runAgent forced submit_* + Budget against a real backend.
// Run: SPIKE_BASE_URL=… SPIKE_TOKEN=… SPIKE_MODEL=… bun scripts/phase3-runagent-smoke.ts
import { z } from "zod";
import { Budget, runAgent, Semaphore } from "../src/orchestrate";
process.env.DD_DR_MODEL = process.env.SPIKE_MODEL;
process.env.DD_DR_BASE_URL = process.env.SPIKE_BASE_URL;
process.env.DD_DR_AUTH_TOKEN = process.env.SPIKE_TOKEN;
const budget = new Budget();
const sem = new Semaphore(2);
const schema = { answer: z.string(), confidence: z.enum(["high", "medium", "low"]) };
const prompt = "Answer the question by calling submit_result exactly once. Q: what is the capital of France? Set answer to the city, confidence to high. Your ONLY completion action is to call submit_result.";
const t0 = Date.now();
const [result, tools] = await runAgent("test", prompt, "submit_result", schema, {}, budget, sem, { maxTurns: 4 });
console.log("result:", JSON.stringify(result), "| tools:", tools.length, "| spent:", budget.spent(), "tok |", ((Date.now()-t0)/1000).toFixed(1)+"s");
console.log((result as any)?.answer ? "✅ runAgent GO — forced submit + budget works" : "❌ FAIL");
