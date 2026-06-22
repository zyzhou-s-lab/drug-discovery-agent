// Tests for the per-campaign asset layer (port of assets.py): overview projection envelopes,
// candidates, load round-trip, defaults, atomicity.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetsDir, loadAsset, writeCandidates, writeOverviewAssets } from "./assets";

function setup() {
  return mkdtempSync(join(tmpdir(), "ddasset-"));
}
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

test("writeOverviewAssets writes sources + database_facts envelopes", () => {
  const root = setup();
  const report = {
    question: "What drives AMD?",
    sources: [{ url: "u", quality: "primary" }],
    references: [{ n: 1, kind: "web", url: "u" }],
    databaseFacts: [{ claim: "c", quote: "q", source: "u", status: "confirmed" }],
  };
  const [srcPath, dbPath] = writeOverviewAssets(report, root, "camp");
  const src = read(srcPath!);
  expect(src).toEqual({ campaign: "camp", stage: "disease-overview", question: "What drives AMD?", count: 1, sources: report.sources, references: report.references });
  const db = read(dbPath!);
  expect(db).toEqual({ campaign: "camp", stage: "disease-overview", question: "What drives AMD?", count: 1, facts: report.databaseFacts });
});

test("writeOverviewAssets defaults missing fields to empty arrays", () => {
  const root = setup();
  const [srcPath, dbPath] = writeOverviewAssets({ question: "Q" }, root, "camp");
  expect(read(srcPath!)).toMatchObject({ count: 0, sources: [], references: [] });
  expect(read(dbPath!)).toMatchObject({ count: 0, facts: [] });
});

test("loadAsset round-trips a written asset; null when absent", () => {
  const root = setup();
  writeOverviewAssets({ question: "Q", sources: [{ url: "u" }] }, root, "camp");
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
  writeOverviewAssets({ question: "Q", sources: [{ url: "u" }] }, root, "camp");
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
