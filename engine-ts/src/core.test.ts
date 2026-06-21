// Parity tests — 1:1 mirror of tests/test_deep_research.py (pure-logic). If these pass, the TS
// core matches the Python core byte-for-behavior. Run: bun test
import { expect, test } from "bun:test";
import { Budget, type Claim, dedupResults, normUrl, rankClaims, type SearchResult, type SeenEntry, survives } from "./core";

test("normUrl strips www / scheme / trailing slash", () => {
  expect(normUrl("https://www.Example.com/Foo/")).toBe("example.com/foo");
  expect(normUrl("http://example.com/Foo")).toBe("example.com/foo");
});

test("normUrl bad input falls back lowercase", () => {
  expect(normUrl("not a url")).toBe("not a url");
});

test("dedup drops duplicate urls", () => {
  const seen: Record<string, SeenEntry> = {};
  const dupes: unknown[] = [], dropped: unknown[] = [];
  const slots: [number] = [15];
  const res: SearchResult[] = [
    { url: "https://a.com/x", title: "A", relevance: "high" },
    { url: "https://www.a.com/x/", title: "A dup", relevance: "medium" },
  ];
  const novel = dedupResults(res, "g", seen, slots, dupes, dropped);
  expect(novel.length).toBe(1);
  expect(dupes.length).toBe(1);
  expect(slots[0]).toBe(14);
});

test("dedup respects fetch budget for non-high", () => {
  const seen: Record<string, SeenEntry> = {};
  const dupes: unknown[] = [], dropped: unknown[] = [];
  const slots: [number] = [0]; // no slots left
  const res: SearchResult[] = [
    { url: "https://a.com/1", title: "hi", relevance: "high" },
    { url: "https://b.com/2", title: "med", relevance: "medium" },
  ];
  const novel = dedupResults(res, "g", seen, slots, dupes, dropped);
  expect(novel.map((n) => n.url)).toEqual(["https://a.com/1"]); // high bypasses the gate
  expect(dropped.length).toBe(1); // medium dropped
  expect(slots[0]).toBe(-1);
});

test("dedup papers by doi", () => {
  const seen: Record<string, SeenEntry> = {};
  const dupes: unknown[] = [], dropped: unknown[] = [];
  const slots: [number] = [15];
  const res: SearchResult[] = [
    { doi: "10.1/AbC", title: "P", relevance: "high", source_type: "paper" },
    { doi: "10.1/abc", title: "P dup", relevance: "medium", source_type: "paper" },
    { url: "https://x.com/p", title: "web", relevance: "high", source_type: "web" },
  ];
  const novel = dedupResults(res, "g", seen, slots, dupes, dropped);
  expect(novel.length).toBe(2); // two papers collapse to one; web is separate
  expect(dupes.length).toBe(1);
});

test("dedup orders by relevance", () => {
  const seen: Record<string, SeenEntry> = {};
  const dupes: unknown[] = [], dropped: unknown[] = [];
  const slots: [number] = [15];
  const res: SearchResult[] = [
    { url: "https://a.com/low", title: "l", relevance: "low" },
    { url: "https://a.com/high", title: "h", relevance: "high" },
  ];
  const novel = dedupResults(res, "g", seen, slots, dupes, dropped);
  expect(novel[0]?.relevance).toBe("high");
});

test("rankClaims importance then quality", () => {
  const claims: Claim[] = [
    { claim: "c1", importance: "tangential", sourceQuality: "primary" },
    { claim: "c2", importance: "central", sourceQuality: "blog" },
    { claim: "c3", importance: "central", sourceQuality: "primary" },
  ];
  expect(rankClaims(claims).map((c) => c.claim)).toEqual(["c3", "c2", "c1"]);
});

test("rankClaims caps at the 80 ceiling", () => {
  const claims: Claim[] = Array.from({ length: 90 }, (_, i) => ({
    claim: `c${i}`, importance: "central", sourceQuality: "primary",
  }));
  expect(rankClaims(claims).length).toBe(80);
});

test("survives needs quorum and few refutes", () => {
  expect(survives([{ refuted: false }, { refuted: false }, { refuted: true }])).toBe(true);
  expect(survives([{ refuted: true }, { refuted: true }, { refuted: false }])).toBe(false);
});

test("survives too many abstentions fails", () => {
  expect(survives([{ refuted: false }, null, null])).toBe(false);
});

test("survives all abstain fails", () => {
  expect(survives([null, null, null])).toBe(false);
});

test("survives treats empty {} as an abstention (Python `if v` parity)", () => {
  expect(survives([{ refuted: false }, {}, {}])).toBe(false); // only 1 valid → no quorum
});

test("Budget accounts tokens + trips exhausted at cap", () => {
  const b = new Budget(100);
  b.add("search", { input_tokens: 30, output_tokens: 20 });
  b.add("fetch", { input_tokens: 40, output_tokens: 10 });
  expect(b.spent()).toBe(100);
  expect(b.exhausted()).toBe(true);
  expect(new Budget().exhausted()).toBe(false); // no cap → never exhausted
});

test("Budget on empty byPhase does not throw (sum-of-empty = 0)", () => {
  // reduce() has an initial value, so spent()/exhausted() are safe before any add()
  const b = new Budget(100);
  expect(b.spent()).toBe(0);
  expect(b.exhausted()).toBe(false);
});
