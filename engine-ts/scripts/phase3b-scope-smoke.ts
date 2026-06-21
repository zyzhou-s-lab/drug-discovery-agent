// Phase-3b live smoke: scope() decomposes a disease into research angles against a real backend.
// Run: SPIKE_BASE_URL=… SPIKE_TOKEN=… SPIKE_MODEL=… bun scripts/phase3b-scope-smoke.ts
import { scope } from "../src/scope";
process.env.DD_DR_MODEL = process.env.SPIKE_MODEL;
process.env.DD_DR_BASE_URL = process.env.SPIKE_BASE_URL;
process.env.DD_DR_AUTH_TOKEN = process.env.SPIKE_TOKEN;
const t0 = Date.now();
const out = await scope("age-related macular degeneration");
const angles = (out?.angles as any[]) ?? [];
console.log("question:", out?.question, "| angles:", angles.length, "| spent:", (out?.budget as any)?.spent_tokens, "tok |", ((Date.now()-t0)/1000).toFixed(1)+"s");
for (const a of angles) console.log("  -", a.label, ":", (a.query ?? "").slice(0, 60));
console.log(angles.length >= 3 ? "✅ scope GO — disease → angles works" : "❌ FAIL");
