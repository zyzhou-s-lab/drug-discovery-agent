// Narrative tests: digest building (angle grouping + citation mapping) + presentReport with an
// injected completion fn (no network).
import { expect, test } from "bun:test";

import { buildDigest, presentReport } from "./present";

const REPORT = {
  summary: "总结",
  findings: [
    { angle: "genetics", confidence: "high", claim: "C1", evidence: "E1", sources: ["https://doi.org/10.1/x"] },
    { angle: "expression", confidence: "low", claim: "C2", evidence: "", sources: [] },
  ],
  references: [{ n: 1, doi: "10.1/x", url: "" }],
  refuted: [{ claim: "R1", vote: "1-2" }],
  caveats: "局限内容",
  openQuestions: ["Q1"],
};

test("buildDigest groups by angle, maps citations, includes refuted/caveats/openQuestions", () => {
  const d = buildDigest(REPORT);
  expect(d).toContain("## 执行摘要\n总结");
  expect(d).toContain("## 研究角度: genetics");
  expect(d).toContain("C1<sup>1</sup>"); // DOI substring → ref #1
  expect(d).toContain("详细证据: E1");
  expect(d).toContain("## 研究角度: expression");
  expect(d).toContain("被对抗式核验否决");
  expect(d).toContain("## 局限\n局限内容");
  expect(d).toContain("## 开放问题");
});

test("buildDigest positional angle fallback when findings lack an angle field", () => {
  const d = buildDigest({ summary: "s", findings: [{ confidence: "high", claim: "C", sources: [] }], references: [] }, [{ label: "A1" }]);
  expect(d).toContain("## 研究角度: A1");
});

test("presentReport: no findings → '' (no LLM call)", async () => {
  let called = false;
  const out = await presentReport({ findings: [] }, "AMD", [], { complete: async () => { called = true; return "X"; } });
  expect(out).toBe("");
  expect(called).toBe(false);
});

test("presentReport: feeds disease + digest to the injected completion", async () => {
  let captured = "";
  const out = await presentReport(REPORT, "AMD", undefined, { complete: async (_s, u) => { captured = u; return "叙述"; } });
  expect(out).toBe("叙述");
  expect(captured).toContain("研究对象:AMD");
  expect(captured).toContain("## 执行摘要");
});

test("presentReport: a complete fn returning '' yields '' (not undefined)", async () => {
  expect(await presentReport(REPORT, "AMD", undefined, { complete: async () => "" })).toBe("");
});

test("buildDigest caps the digest at 60k chars", () => {
  const huge = { summary: "s", findings: [{ confidence: "high", claim: "C", sources: [] }], references: [], caveats: "x".repeat(80000) };
  expect(buildDigest(huge).length).toBe(60000);
});
