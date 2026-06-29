// Tests for the per-campaign asset layer (port of assets.py): overview projection envelopes,
// candidates, load round-trip, defaults, atomicity.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetsDir, deriveAssets, loadAsset, slugify, stepDir, writeAsset, writeCandidates, writeStepItem } from "./assets";

function setup() {
  return mkdtempSync(join(tmpdir(), "ddasset-"));
}
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

// helper: lay down a minimal deepresearch/ tree so deriveAssets has something to reduce
function seedDeepresearch(root: string, campaign: string) {
  writeStepItem(root, campaign, "01_scope", "scope", { question: "What drives AMD?", count: 1, angles: [{ label: "genetics" }] });
  writeStepItem(root, campaign, "03_fetch", "00_paper", {
    url: "https://a.com/p", title: "P", angle: "genetics", source_type: "paper", sourceQuality: "primary",
    claims: [{ claim: "C1", quote: "q1", source_type: "paper", sourceUrl: "https://a.com/p" }],
  });
  writeStepItem(root, campaign, "03_fetch", "01_db", {
    url: "https://ols/efo", title: "EFO", angle: "genetics", source_type: "database", sourceQuality: "primary",
    claims: [{ claim: "DBFACT", quote: "dq", source_type: "database", sourceUrl: "https://ols/efo", raw: "{...}" }],
  });
  writeStepItem(root, campaign, "04_verify", "01_C1", { claim: "C1", quote: "q1", source: "https://a.com/p", survives: true, vote: "3-0" });
  writeStepItem(root, campaign, "04_verify", "02_DBFACT", { claim: "DBFACT", quote: "dq", source: "https://ols/efo", survives: false, vote: "1-2" });
  writeStepItem(root, campaign, "05_synthesize", "00_genetics", { angle: "genetics", claim: "F", confidence: "high", sources: ["https://a.com/p"], evidence: "ev" });
  writeStepItem(root, campaign, "05_synthesize", "merge", { summary: "S", caveats: "", openQuestions: [] });
}

test("deriveAssets reduces deepresearch/ into the sources/database_facts/verified/findings contract", () => {
  const root = setup();
  seedDeepresearch(root, "camp");
  const refs = [{ n: 1, kind: "paper", doi: "10.1/x" }];
  deriveAssets(root, "camp", refs);

  const sources = read(join(assetsDir(root, "camp"), "sources.json"));
  expect(sources).toEqual({ campaign: "camp", stage: "disease-overview", question: "What drives AMD?", count: 2, sources: [{ url: "https://a.com/p", quality: "primary", angle: "genetics", claimCount: 1 }, { url: "https://ols/efo", quality: "primary", angle: "genetics", claimCount: 1 }], references: refs });

  const facts = read(join(assetsDir(root, "camp"), "database_facts.json"));
  expect(facts.count).toBe(1); // only the database-typed claim
  expect(facts.facts[0]).toMatchObject({ claim: "DBFACT", source: "https://ols/efo", status: "refuted", raw: "{...}" });

  const verified = read(join(assetsDir(root, "camp"), "verified.json"));
  expect(verified.confirmed).toEqual([{ claim: "C1", source: "https://a.com/p", quote: "q1", vote: "3-0" }]);
  expect(verified.refuted).toEqual([{ claim: "DBFACT", vote: "1-2", source: "https://ols/efo" }]);

  const findings = read(join(assetsDir(root, "camp"), "findings.json"));
  expect(findings.count).toBe(1); // merge.json excluded
  expect(findings.findings[0]).toMatchObject({ angle: "genetics", claim: "F", confidence: "high" });
});

test("deriveAssets on an empty/absent deepresearch/ yields empty (count 0) envelopes, not a throw", () => {
  const root = setup();
  deriveAssets(root, "camp", []);
  expect(read(join(assetsDir(root, "camp"), "sources.json"))).toMatchObject({ count: 0, sources: [], references: [] });
  expect(read(join(assetsDir(root, "camp"), "findings.json"))).toMatchObject({ count: 0, findings: [] });
});

test("loadAsset round-trips a written asset; null when absent", () => {
  const root = setup();
  writeAsset(root, "camp", "sources", { stage: "disease-overview", count: 1, sources: [{ url: "u" }] });
  expect(loadAsset(root, "camp", "sources.json")).toMatchObject({ count: 1 });
  expect(loadAsset(root, "camp", "nope.json")).toBeNull();
});

test("writeCandidates writes the nomination envelope", () => {
  const root = setup();
  const path = writeCandidates([{ symbol: "ABCA4", score: 0.9 }], root, "camp", { efoId: "EFO_1", sortBy: "score" });
  expect(read(path)).toEqual({ campaign: "camp", stage: "nomination", efo_id: "EFO_1", sort_by: "score", count: 1, candidates: [{ symbol: "ABCA4", score: 0.9 }] });
});

test("writes are atomic — no orphan .tmp left in the assets dir", () => {
  const root = setup();
  writeAsset(root, "camp", "sources", { stage: "disease-overview", count: 1, sources: [{ url: "u" }] });
  const files = readdirSync(assetsDir(root, "camp"));
  expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  expect(existsSync(join(assetsDir(root, "camp"), "sources.json"))).toBe(true);
});

test("loadAsset returns null for a present-but-corrupt asset", () => {
  const root = setup();
  const dir = assetsDir(root, "camp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sources.json"), "{ not json", "utf-8");
  expect(loadAsset(root, "camp", "sources.json")).toBeNull();
});

test("writeCandidates deep-clones — a later mutation can't pollute the written asset", () => {
  const root = setup();
  const cand = { symbol: "ABCA4", evidence: ["a"] };
  const path = writeCandidates([cand], root, "camp");
  cand.evidence.push("b"); // mutate AFTER write
  expect(read(path).candidates[0].evidence).toEqual(["a"]); // asset unaffected
});

test("writeCandidates throws cleanly on a non-serializable candidate — no partial asset written", () => {
  const root = setup();
  const circular: any = {};
  circular.self = circular; // JSON.stringify will throw on this
  expect(() => writeCandidates([circular], root, "camp")).toThrow();
  // the throw happens during the pre-write clone, before any file is touched → no corrupt/partial asset
  expect(existsSync(join(assetsDir(root, "camp"), "candidates.json"))).toBe(false);
});

test("writeAsset writes a campaign-stamped envelope to {name}.json", () => {
  const root = setup();
  const p = writeAsset(root, "camp", "verified", { stage: "deep-research", count: 2, confirmed: [{ claim: "c" }] });
  expect(p.endsWith("verified.json")).toBe(true);
  expect(read(p)).toEqual({ campaign: "camp", stage: "deep-research", count: 2, confirmed: [{ claim: "c" }] });
  expect(loadAsset(root, "camp", "verified.json").count).toBe(2);
});

test("writeAsset deep-clones + throws cleanly on a non-serializable payload", () => {
  const root = setup();
  // later mutation can't pollute the written asset
  const payload: any = { stage: "s", facts: [{ a: 1 }] };
  const p = writeAsset(root, "camp", "database_facts", payload);
  payload.facts.push({ b: 2 });
  expect(read(p).facts).toEqual([{ a: 1 }]);
  // a circular payload throws (caught upstream by doPersist) — no partial asset
  const circular: any = { stage: "s" };
  circular.self = circular;
  expect(() => writeAsset(root, "camp", "verified", circular)).toThrow();
  expect(existsSync(join(assetsDir(root, "camp"), "verified.json"))).toBe(false);
});

test("loadAsset accepts a name with or without .json (consistent with writeAsset)", () => {
  const root = setup();
  writeAsset(root, "camp", "findings", { stage: "deep-research", count: 1, findings: [{ angle: "g" }] });
  expect(loadAsset(root, "camp", "findings").count).toBe(1);        // no extension
  expect(loadAsset(root, "camp", "findings.json").count).toBe(1);   // full name — both resolve
});

test("slugify lowercases, dashes non-alnum, trims, caps; empty → 'item'", () => {
  expect(slugify("00_Genetic Architecture & Heritability")).toBe("00-genetic-architecture-heritability");
  expect(slugify("  --Hello!!--  ")).toBe("hello");
  expect(slugify("！！！")).toBe("item"); // all non-alnum → fallback
  expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(64);
});

test("writeStepItem writes deepresearch/{step}/{slug}.json with a self-describing envelope", () => {
  const root = setup();
  const p = writeStepItem(root, "camp", "02_search", "00_Genetic Architecture", { angle: "Genetic Architecture", count: 3, results: [{ url: "u" }] });
  expect(p).toBe(join(stepDir(root, "camp", "02_search"), "00-genetic-architecture.json"));
  const env = read(p);
  expect(env.campaign).toBe("camp");
  expect(env.step).toBe("02_search");
  expect(env.key).toBe("00_Genetic Architecture"); // raw key preserved in the envelope
  expect(env.count).toBe(3);
  expect(env.results[0].url).toBe("u");
});

test("writeStepItem is atomic (no orphan .tmp) and idempotent (re-run overwrites its own file)", () => {
  const root = setup();
  writeStepItem(root, "camp", "04_verify", "01_claim", { survives: true });
  const p2 = writeStepItem(root, "camp", "04_verify", "01_claim", { survives: false });
  const files = readdirSync(stepDir(root, "camp", "04_verify"));
  expect(files).toEqual(["01-claim.json"]);          // single file, no .tmp left behind
  expect(read(p2).survives).toBe(false);             // overwritten in place
});

test("writeStepItem throws cleanly on a non-serializable payload — no partial file", () => {
  const root = setup();
  const circular: any = {}; circular.self = circular;
  expect(() => writeStepItem(root, "camp", "03_fetch", "x", circular)).toThrow();
  expect(existsSync(stepDir(root, "camp", "03_fetch"))).toBe(false);
});
