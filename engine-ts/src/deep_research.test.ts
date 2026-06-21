// Orchestration parity tests for research() — 1:1 of tests/test_deep_research.py's
// test_research_happy_path / test_research_no_claims_salvage. runAgent is injected (no SDK/network):
// a fake dispatches a canned result per submit_* name, exactly like the Python fake.
import { expect, test } from "bun:test";

import { research, type RunAgentFn } from "./deep_research";

function fakeRunAgent(responses: Record<string, unknown>): RunAgentFn {
  return async (_phase, _prompt, submitName) => [(responses[submitName] as any) ?? null, []];
}

const ANGLE = [{ label: "g", query: "q", rationale: "r" }];

test("research happy path returns a report (confirmed → synthesized finding)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_report: { summary: "S", caveats: "none", findings: [{ angle: "g", claim: "C1", confidence: "high", sources: ["https://x.com/a"], evidence: "e" }] },
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.stats.confirmed).toBe(1);
  expect(r.stats.afterSynthesis).toBe(1);
  expect(r.findings[0].claim).toBe("C1");
  expect(r.references.length).toBe(1); // the one confirmed-backing source
});

test("research no-claims salvage (empty extract → No claims summary)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "unreliable", claims: [] },
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.findings).toEqual([]);
  expect(r.stats.claims).toBe(0);
  expect(r.summary).toContain("No claims");
});

test("research all-refuted salvage (claims killed → inconclusive)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: true, evidence: "wrong", confidence: "high" }, // every vote refutes
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.findings).toEqual([]);
  expect(r.stats.confirmed).toBe(0);
  expect(r.refuted.length).toBe(1);
  expect(r.summary).toContain("refuted");
});
