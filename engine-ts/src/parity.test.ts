// Tests for the cutover parity check — same shape → ok; a missing key or differing element shape → diffs.
import { expect, test } from "bun:test";

import { reportParity } from "./parity";

const FULL = {
  question: "Q",
  summary: "S",
  findings: [{ angle: "g", claim: "c", confidence: "high", sources: ["u"], evidence: "e" }],
  refuted: [{ claim: "x", vote: "1-2", source: "u" }],
  sources: [{ url: "u", quality: "primary", angle: "g", claimCount: 1 }],
  references: [{ n: 1, kind: "web", title: "T", url: "u" }],
  databaseFacts: [{ claim: "d", quote: "q", source: "u", doi: null, quality: "primary", status: "confirmed", raw: "" }],
  stats: { angles: 1, sources: 1, claims: 1, dupes: 0, budgetDropped: 0, databaseFacts: 1, verified: 1, confirmed: 1, killed: 0, agentCalls: 5, afterSynthesis: 1 },
  budget: { spent_tokens: 100, by_phase: {} },
};

test("reportParity: identical shape (different values) → ok", () => {
  const ts = JSON.parse(JSON.stringify(FULL));
  ts.summary = "a totally different LLM summary"; // content differs — must not matter
  ts.findings[0].claim = "different claim";
  expect(reportParity(FULL, ts)).toEqual({ ok: true, diffs: [] });
});

test("reportParity: a missing top-level key is flagged", () => {
  const ts = { ...FULL } as any;
  delete ts.summary;
  const r = reportParity(FULL, ts);
  expect(r.ok).toBe(false);
  expect(r.diffs.join(" ")).toContain("summary");
});

test("reportParity: a differing finding element key is flagged", () => {
  const ts = JSON.parse(JSON.stringify(FULL));
  delete ts.findings[0].angle; // TS findings dropped the angle field
  const r = reportParity(FULL, ts);
  expect(r.ok).toBe(false);
  expect(r.diffs.join(" ")).toContain("findings[]");
});

test("reportParity: differing stats keys are flagged", () => {
  const ts = JSON.parse(JSON.stringify(FULL));
  delete ts.stats.afterSynthesis;
  const r = reportParity(FULL, ts);
  expect(r.ok).toBe(false);
  expect(r.diffs.join(" ")).toContain("stats");
});

test("reportParity: a salvage report (omits some array fields) only compares shared fields", () => {
  const salvage = { question: "Q", summary: "No claims", findings: [], refuted: [], sources: [{ url: "u", quality: "primary" }], stats: { angles: 1, sources: 1, claims: 0, dupes: 0, budgetDropped: 0, databaseFacts: 0 }, budget: { spent_tokens: 10 } };
  const ts = JSON.parse(JSON.stringify(salvage));
  expect(reportParity(salvage, ts).ok).toBe(true);
});

test("reportParity: salvage vs full flags the missing top-level fields (a real divergence)", () => {
  // same campaign yielding a full report in one backend but a salvage in the other = parity FAILURE
  const salvage = { question: "Q", summary: "No claims", findings: [], refuted: [], sources: [{ url: "u", quality: "primary" }], stats: { angles: 1, sources: 1, claims: 0, dupes: 0, budgetDropped: 0, databaseFacts: 0 }, budget: { spent_tokens: 10 } };
  const r = reportParity(salvage, FULL);
  expect(r.ok).toBe(false);
  expect(r.diffs.join(" ")).toContain("references"); // only in full → flagged at top-level
});

test("reportParity: a differing budget key is flagged", () => {
  const ts = JSON.parse(JSON.stringify(FULL));
  delete ts.budget.by_phase; // TS budget dropped by_phase
  const r = reportParity(FULL, ts);
  expect(r.ok).toBe(false);
  expect(r.diffs.join(" ")).toContain("budget");
});
