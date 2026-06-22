// Phase-5 cutover validation CLI: structural parity of two deep-research reports (Python vs TS for
// the same campaign). LLM content varies, so this compares SHAPE only. Run:
//   bun scripts/report-parity.ts <python-report.json> <ts-report.json>
import { readFileSync } from "node:fs";

import { reportParity } from "../src/parity";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: bun scripts/report-parity.ts <a.json> <b.json>");
  process.exit(2);
}

function load(label: string, path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // deliberately do NOT echo the error message — a JSON SyntaxError can quote the file's bytes,
    // which may include secrets if the wrong file is passed.
    console.error(`failed to read or parse ${label} (${path}) — unreadable or not valid JSON`);
    process.exit(2);
  }
}

const a = load("A", aPath);
const b = load("B", bPath);
const { ok, diffs } = reportParity(a, b);

if (ok) {
  console.log("✅ PARITY — the two reports have the same shape");
} else {
  console.log("❌ shape diffs (A=" + aPath + " B=" + bPath + "):");
  for (const d of diffs) console.log("  - " + d);
  process.exit(1);
}
