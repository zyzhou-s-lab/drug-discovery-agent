// Terminal runner for a full deep-research campaign — no HTTP / web needed. Prints progress to stdout
// and writes the SAME artifacts the server does (report.json + deepresearch/ + search_status.json), so
// the web app can render the milestone read-only and the campaign shows up in the list. Lets the
// business chain be iterated from the terminal without the front-back dev loop. Usage:
//   bun src/cli.ts "<disease>"
// Knobs (env): DD_DR_MAX_ANGLES / DD_DR_MAX_FETCH / DD_DR_MAX_CLAIMS / DD_DR_CONC (as in research()).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { deriveAssets, writeStepItem } from "./assets";
import { applySettings, loadSettings } from "./config";
import { research } from "./deep_research";
import { CircuitBreaker } from "./orchestrate";
import { presentReport } from "./present";
import { normalizeAngles } from "./run";
import { scope as realScope } from "./scope";
import { Index } from "./store";

applySettings(loadSettings());

const disease = process.argv.slice(2).join(" ").trim();
if (!disease) {
  console.error('usage: bun src/cli.ts "<disease>"');
  process.exit(1);
}

const DD_HOME = join(homedir(), ".dda");
const ART = process.env.DD_ARTIFACTS ?? join(DD_HOME, "artifacts");
const DB = process.env.DD_DB ?? join(DD_HOME, "state.sqlite");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
// fall back to "run" when the disease has no ASCII (e.g. a Chinese name) so the campaign id / URL path
// is never a bare "-cli-…"; the real disease name still lives in the report + index.
const campaign = `${slug(disease) || "run"}-cli-${Date.now().toString(36)}`;
const base = join(ART, campaign);
mkdirSync(base, { recursive: true });

const writeJson = (path: string, obj: unknown) => {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj), "utf-8");
  renameSync(tmp, path);
};
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const bar = (done: number, total: number, w = 20) => {
  const n = total > 0 ? Math.round((done / total) * w) : 0;
  return `[${"█".repeat(Math.min(n, w))}${"·".repeat(Math.max(0, w - n))}] ${done}/${total}`;
};

console.log(`\n🔬 deep-research  ·  ${disease}`);
console.log(`   campaign: ${campaign}\n`);

// ── ① scope ──
console.log("① scope — decomposing into research angles…");
const sc = await realScope(disease);
if (!sc || !Array.isArray(sc.angles) || sc.angles.length === 0) {
  console.error("✗ scope produced no angles — aborting (check LLM creds / provider).");
  writeJson(join(base, "search_status.json"), { state: "error", error: "scope failed" });
  process.exit(1);
}
const question = String(sc.question ?? disease);
let angles = normalizeAngles(sc.angles);
const maxA = parseInt(process.env.DD_DR_MAX_ANGLES || "0", 10);
if (maxA > 0) angles = angles.slice(0, maxA);
writeStepItem(ART, campaign, "01_scope", "scope", { campaign, step: "01_scope", key: "scope", question, count: angles.length, angles });
angles.forEach((a, i) => console.log(`   ${i + 1}. ${a.label}`));
try {
  new Index(DB, ART).recordCampaign(campaign, question); // so the web lists it
} catch (e) {
  console.warn(`   (index record skipped: ${e instanceof Error ? e.message : e})`);
}

// ── ② research (search → fetch → verify → synthesize) ──
console.log(`\n② research — ${angles.length} angles · search → fetch → verify → synthesize…\n`);
const breaker = new CircuitBreaker();
const progSeen = new Map<string, number>();
const report = await research(question, angles, {
  breaker,
  onProgress: (phase, done, total) => {
    const pct = total > 0 ? done / total : 0;
    if (done === total || pct - (progSeen.get(phase) ?? -1) >= 0.2) {
      progSeen.set(phase, pct);
      console.log(`   ${phase.padEnd(11)} ${bar(done, total)}  ${el()}`);
    }
  },
  onEvent: (_phase, msg) => console.log(`   ▸ ${msg}`),
  persistStep: (step, key, payload) => writeStepItem(ART, campaign, step, key, payload),
});

writeJson(join(base, "report.json"), report);
try {
  deriveAssets(ART, campaign, report.references ?? []);
} catch (e) {
  console.warn(`   assets: ${e instanceof Error ? e.message : e}`);
}
const state = breaker.tripped ? "paused" : "done";
writeJson(join(base, "search_status.json"), { state, stats: report.stats, run: Date.now(), ...(breaker.tripped ? { reason: breaker.reason } : {}) });

// ── ③ present (best-effort narrative) ──
console.log("\n③ present — polishing narrative…");
try {
  const nar = await presentReport(report, question, angles);
  if (nar) {
    report.narrative = nar;
    writeJson(join(base, "report.json"), report);
    console.log(`   ✓ narrative generated (${nar.length} chars)`);
  } else {
    console.log("   (narrative empty — the report renders via the structured fallback)");
  }
} catch (e) {
  console.warn(`   narrative failed: ${e instanceof Error ? e.message : e}`);
}

// ── summary ──
const s: any = report.stats ?? {};
console.log(`\n${state === "paused" ? `⏸  PAUSED (${breaker.reason})` : "✅  DONE"}  ·  ${el()}`);
console.log(`   sources=${s.sources ?? "?"}  claims=${s.claims ?? "?"}  verified=${s.verified ?? "?"}  confirmed=${s.confirmed ?? "?"}  findings=${(report.findings ?? []).length}`);
console.log(`   report:  ${join(base, "report.json")}`);
console.log(`   view:    /c/${campaign}\n`);
