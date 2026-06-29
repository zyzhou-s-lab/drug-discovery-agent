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

test("research happy path: per-angle map-reduce (one finding per angle + merged overview)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_finding: { claim: "C1 merged", confidence: "high", sources: ["https://x.com/a"], evidence: "ev" }, // MAP
    submit_merge: { summary: "S", caveats: "none", openQuestions: ["q1"] }, // REDUCE
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.stats.confirmed).toBe(1);
  expect(r.stats.afterSynthesis).toBe(1); // one angle → exactly one finding
  expect(r.findings.length).toBe(1);
  expect(r.findings[0].angle).toBe("g"); // angle injected by the map, not the agent
  expect(r.findings[0].claim).toBe("C1 merged");
  expect(r.summary).toBe("S"); // from the merge step
  expect(r.openQuestions).toEqual(["q1"]);
  expect(r.references.length).toBe(1);
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

test("research map/reduce missing (no submit_finding / submit_merge) → default finding per angle + fallback summary", async () => {
  // confirmed claims exist, but neither the per-angle map nor the merge submits → each angle still
  // yields a default low-confidence finding (never null), and the summary falls back.
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    // no submit_finding, no submit_merge
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.findings.length).toBe(1); // still one finding per angle (default)
  expect(r.findings[0].angle).toBe("g");
  expect(r.findings[0].confidence).toBe("low");
  expect(r.stats.afterSynthesis).toBe(1);
  expect(r.summary).toContain("Synthesized"); // merge missing → fallback summary
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

test("research records each sub-agent under deepresearch/ steps, in workflow order", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_finding: { claim: "C1", confidence: "high", sources: ["https://x.com/a"], evidence: "ev" },
    submit_merge: { summary: "S", caveats: "none", openQuestions: [] },
  });
  const calls: Array<{ step: string; key: string; payload: any }> = [];
  await research("Q", ANGLE, { runAgent: fake, lit: {}, persistStep: (step, key, payload) => calls.push({ step, key, payload }) });
  // one source + one claim + one angle → search, fetch, verify, the angle map, then the merge
  expect(calls.map((c) => c.step)).toEqual(["02_search", "03_fetch", "04_verify", "05_synthesize", "05_synthesize"]);
  expect(calls.find((c) => c.step === "02_search")!.payload.results[0].url).toBe("https://x.com/a");
  const verify = calls.find((c) => c.step === "04_verify")!.payload;
  expect(verify.survives).toBe(true);
  expect(verify.vote).toBe("1-0");
  expect(calls.find((c) => c.step === "05_synthesize" && c.key !== "merge")!.payload.angle).toBe("g");
  expect(calls.some((c) => c.step === "05_synthesize" && c.key === "merge")).toBe(true);
});

test("05_synthesize keys carry the angle-order prefix even when a later angle finishes first", async () => {
  const ANGLES2 = [{ label: "a1", query: "q1" }, { label: "a2", query: "q2" }];
  // a1's map is slow, so a2 completes (and persists) FIRST — but the NN_ key prefix is by angle index
  const fake: RunAgentFn = async (_phase, prompt, submitName) => {
    if (submitName === "submit_finding") {
      const isA1 = prompt.includes("a1");
      if (isA1) await new Promise((r) => setTimeout(r, 25));
      return [{ claim: "F-" + (isA1 ? "a1" : "a2"), confidence: "high", sources: [], evidence: "e" }, []];
    }
    const canned: Record<string, any> = {
      submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
      submit_claims: { sourceQuality: "primary", claims: [{ claim: "C", quote: "q", importance: "central" }] },
      submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
      submit_merge: { summary: "S", caveats: "", openQuestions: [] },
    };
    return [canned[submitName] ?? null, []];
  };
  const keys: string[] = [];
  const r = await research("Q", ANGLES2, { runAgent: fake, lit: {}, persistStep: (step, key) => { if (step === "05_synthesize" && key !== "merge") keys.push(key); } });
  expect(r.findings.map((f: any) => f.angle)).toEqual(["a1", "a2"]); // report order
  expect([...keys].sort()).toEqual(["00_a1", "01_a2"]); // lexical sort of keys = angle order, NOT completion order
});

test("research records search + fetch even on the no-claims salvage path (verify not reached)", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "unreliable", claims: [] },
  });
  const steps: string[] = [];
  await research("Q", ANGLE, { runAgent: fake, lit: {}, persistStep: (step) => steps.push(step) });
  expect(steps).toEqual(["02_search", "03_fetch"]);
});

test("research never fails the run when persistStep throws — and surfaces it via onEvent", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "unreliable", claims: [] },
  });
  const events: Array<[string, string]> = [];
  const r = await research("Q", ANGLE, {
    runAgent: fake, lit: {},
    persistStep: () => { throw new Error("disk full"); },
    onEvent: (p, m) => events.push([p, m]),
  });
  expect(r.summary).toContain("No claims"); // run completed despite the persist error
  expect(events.some(([p, m]) => p === "persist" && m.includes("disk full"))).toBe(true); // not swallowed
});

test("research map-reduce: N angles → N findings (one per angle, in angle order)", async () => {
  const ANGLES2 = [{ label: "genetics", query: "g" }, { label: "biomarkers", query: "b" }];
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_finding: { claim: "F", confidence: "high", sources: ["https://x.com/a"], evidence: "ev" },
    submit_merge: { summary: "S", caveats: "", openQuestions: [] },
  });
  const r = await research("Q", ANGLES2, { runAgent: fake, lit: {} });
  expect(r.findings.length).toBe(2);
  expect(r.findings.map((f: any) => f.angle)).toEqual(["genetics", "biomarkers"]); // angle order preserved
  expect(r.stats.afterSynthesis).toBe(2);
});

test("research map: caller's scope angle label always wins over an agent-hallucinated angle", async () => {
  const fake = fakeRunAgent({
    submit_results: { results: [{ url: "https://x.com/a", title: "A", relevance: "high" }] },
    submit_claims: { sourceQuality: "primary", claims: [{ claim: "C1", quote: "q", importance: "central" }] },
    submit_verdict: { refuted: false, evidence: "e", confidence: "high" },
    submit_finding: { angle: "HALLUCINATED", claim: "C1", confidence: "high", sources: [], evidence: "ev" }, // agent injects a wrong angle
    submit_merge: { summary: "S", caveats: "", openQuestions: [] },
  });
  const r = await research("Q", ANGLE, { runAgent: fake, lit: {} });
  expect(r.findings[0].angle).toBe("g"); // the scope label "g", NOT "HALLUCINATED"
});
