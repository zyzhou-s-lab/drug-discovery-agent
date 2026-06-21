// zod replaces orchestrate._schema_errors — these mirror tests/test_deep_research.py
// test_schema_errors (required / enum / type) via .safeParse, plus the data-model defaults.
import { expect, test } from "bun:test";
import { SearchSchema, TargetCandidateSchema, VerdictSubmitSchema } from "./schemas";

test("verdict schema: valid, bad enum, missing required", () => {
  expect(VerdictSubmitSchema.safeParse({ refuted: false, evidence: "e", confidence: "high" }).success).toBe(true);
  expect(VerdictSubmitSchema.safeParse({ refuted: false, evidence: "e", confidence: "bad" }).success).toBe(false);
  expect(VerdictSubmitSchema.safeParse({ evidence: "e", confidence: "high" }).success).toBe(false); // refuted required
  expect(VerdictSubmitSchema.safeParse({ refuted: "yes", evidence: "e", confidence: "high" }).success).toBe(false); // wrong type
});

test("search schema: required fields, enum, maxItems cap", () => {
  expect(SearchSchema.safeParse({ results: [] }).success).toBe(true);
  expect(SearchSchema.safeParse({ results: [{ title: "t", relevance: "high", source_type: "web" }] }).success).toBe(true);
  expect(SearchSchema.safeParse({ results: [{ title: "t", relevance: "high", source_type: "bad" }] }).success).toBe(false);
  expect(SearchSchema.safeParse({ results: [{ relevance: "high", source_type: "web" }] }).success).toBe(false); // title required
  const tooMany = { results: Array.from({ length: 9 }, () => ({ title: "t", relevance: "high", source_type: "web" })) };
  expect(SearchSchema.safeParse(tooMany).success).toBe(false); // maxItems 8
});

test("TargetCandidate applies pydantic-equivalent defaults", () => {
  const c = TargetCandidateSchema.parse({ symbol: "CFH" });
  expect(c.name).toBe(null);
  expect(c.modality).toBe(null);
  expect(c.evidence).toEqual([]);
  expect(c.scores).toEqual({});
  expect(c.rationale).toBe("");
});
