// Phase-3c live smoke: the full Search→Fetch→Verify→Synthesize pipeline, capped small (1 angle,
// fetchBudget 2, maxVerifyClaims 2) to bound cost. Run with SPIKE_* + bun scripts/phase3c-research-smoke.ts
import { research, type Angle } from "../src/deep_research";
process.env.DD_DR_MODEL = process.env.SPIKE_MODEL;
process.env.DD_DR_BASE_URL = process.env.SPIKE_BASE_URL;
process.env.DD_DR_AUTH_TOKEN = process.env.SPIKE_TOKEN;
const angle: Angle = { label: "Genetics", query: "GWAS risk loci in age-related macular degeneration", rationale: "genetic target prior" };
const t0 = Date.now();
const r = await research("age-related macular degeneration", [angle], {
  fetchBudget: 2, maxVerifyClaims: 2,
  onEvent: (p, m) => console.log(`  [${p}] ${m}`),
});
console.log("=== REPORT ===");
console.log("findings:", r.findings?.length, "| sources:", r.sources?.length, "| confirmed:", r.stats?.confirmed, "| refs:", r.references?.length, "| spent:", r.budget?.spent_tokens, "tok |", ((Date.now()-t0)/1000).toFixed(1)+"s");
console.log("summary:", (r.summary ?? "").slice(0, 120));
console.log((r.findings?.length || r.stats?.sources) ? "✅ research GO — full pipeline ran" : "❌ FAIL");
