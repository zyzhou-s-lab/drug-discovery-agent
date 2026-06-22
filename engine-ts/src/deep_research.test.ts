// Orchestration parity tests for research() — 1:1 of tests/test_deep_research.py's
// test_research_happy_path / test_research_no_claims_salvage. runAgent is injected (no SDK/network):
// a fake dispatches a canned result per submit_* name, exactly like the Python fake.
import { expect, test } from "bun:test";

import { bibliography, research, type RunAgentFn } from "./deep_research";

// full 8-arg signature so a real RunAgentFn drift (param order/count) breaks the test, not just types
function fakeRunAgent(responses: Record<string, unknown>): RunAgentFn {
  return async (_phase, _prompt, submitName, _schema, _extraMcp, _budget, _sem, _opts) => [(responses[submitName] as any) ?? null, []];
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

test("research synth-failure fallback (confirmed but no report → unmerged)", async () => {
  // confirmed claims exist, but synthesize never submits → research returns the unmerged confirmed list
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    // no submit_report → synthReport is null
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.findings).toEqual([]);
  expect(r.confirmed.length).toBe(1);
  expect(r.confirmed[0].claim).toBe("C1");
  expect(r.stats.afterSynthesis).toBe(0);
  expect(r.summary).toContain("Synthesis step was skipped");
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

test("bibliography double-key includes a confirmed source when doi/url keys diverge", async () => {
  // claim carries a doi but the source row only has a url (no doi) — the single-key (Python) match
  // would drop it; the doi+url double-key keeps it.
  const confirmed = [{ claim: "c", doi: "10.1/x", sourceUrl: "https://a.com/p" }];
  const allSources = [{ source_type: "web", url: "https://a.com/p", title: "P" }];
  const refs = await bibliography(confirmed, allSources);
  expect(refs.length).toBe(1);
  expect(refs[0]!.url).toBe("https://a.com/p");
});

test("research persists incremental assets in order (sources → database_facts + verified)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_report: { summary: "S", caveats: "none", findings: [{ angle: "g", claim: "C1", confidence: "high", sources: ["https://x.com/a"], evidence: "e" }] },
  });
  const calls: Array<{ name: string; payload: any }> = [];
  await research("Q", ANGLE, { runAgent: fake, lit: {}, persist: (name, payload) => calls.push({ name, payload }) });
  expect(calls.map((c) => c.name)).toEqual(["sources", "database_facts", "verified"]);
  const sources = calls.find((c) => c.name === "sources")!.payload;
  expect(sources.count).toBe(1);
  expect(sources.sources[0].url).toBe("https://x.com/a");
  const verified = calls.find((c) => c.name === "verified")!.payload;
  expect(verified.confirmed[0].claim).toBe("C1");
});

test("research persists sources even on the no-claims salvage path (verify checkpoint not reached)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "unreliable", claims: [] },
  });
  const calls: string[] = [];
  await research("Q", ANGLE, { runAgent: fake, lit: {}, persist: (name) => calls.push(name) });
  expect(calls).toEqual(["sources"]);
});

test("research never fails the run when persist throws — and surfaces it via onEvent", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "unreliable", claims: [] },
  });
  const events: Array<[string, string]> = [];
  const r = await research("Q", ANGLE, {
    runAgent: fake, lit: {},
    persist: () => { throw new Error("disk full"); },
    onEvent: (p, m) => events.push([p, m]),
  });
  expect(r.summary).toContain("No claims"); // run completed despite the persist error
  expect(events.some(([p, m]) => p === "persist" && m.includes("disk full"))).toBe(true); // not swallowed
});
