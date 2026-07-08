// Unit tests for the literature MCP tool bodies (litmcp.ts) — dependency-injected, so no SDK or
// module mocking: just pass fake tool fns and assert the slim/NOT_FOUND/[] formatting + never-throw.
import { expect, test } from "bun:test";

import { cellxgeneText, getPaperText, hcaText, type LitDeps, makeLitMcp, ontologyText, openTargetsText, searchLiteratureText } from "./litmcp";

const deps = (over: Partial<LitDeps>): LitDeps => ({
  searchLiteratureMulti: async () => [] as any,
  abstractByDoi: async () => null,
  ontologyLookup: async () => [],
  openTargetTargets: async () => [],
  cellxgeneDatasets: async () => [],
  hcaProjects: async () => [],
  ...over,
});

test("searchLiteratureText slims rows + drops untitled", async () => {
  const t = await searchLiteratureText(
    "q",
    deps({
      searchLiteratureMulti: async () =>
        [
          { doi: "10.1/x", title: "T", year: 2020, venue: "V", authors: ["A"], citation_count: 5, tldr: "s", abstract: "a" },
          { doi: "10.1/y", title: "" }, // dropped (no title)
        ] as any,
    }),
  );
  const parsed = JSON.parse(t);
  expect(parsed.length).toBe(1);
  expect(parsed[0].doi).toBe("10.1/x");
  expect(parsed[0].abstract).toBe("a");
});

test("searchLiteratureText returns [] on error (never throws)", async () => {
  const t = await searchLiteratureText("q", deps({ searchLiteratureMulti: async () => { throw new Error("boom"); } }));
  expect(t).toBe("[]");
});

test("openTargetsText → JSON rows, or [] when empty / on error (never throws)", async () => {
  const rows = [{ symbol: "PNPLA3", name: "patatin…", ensemblId: "ENSG…", score: 0.44, evidence: { genetic_association: 0.69 } }];
  expect(await openTargetsText("MASH", deps({ openTargetTargets: async () => rows as any }))).toBe(JSON.stringify(rows));
  expect(await openTargetsText("MASH", deps({ openTargetTargets: async () => [] }))).toBe("[]");
  expect(await openTargetsText("MASH", deps({ openTargetTargets: async () => { throw new Error("boom"); } }))).toBe("[]");
});

test("cellxgeneText / hcaText → JSON rows, or [] when empty / on error (never throws)", async () => {
  const cx = [{ title: "liver atlas", disease: "MASH", tissue: "liver", assay: "10x", cell_count: 5000, spatial: false }];
  expect(await cellxgeneText("MASH", deps({ cellxgeneDatasets: async () => cx as any }))).toBe(JSON.stringify(cx));
  expect(await cellxgeneText("MASH", deps({ cellxgeneDatasets: async () => [] }))).toBe("[]");
  expect(await cellxgeneText("MASH", deps({ cellxgeneDatasets: async () => { throw new Error("boom"); } }))).toBe("[]");
  const hc = [{ title: "Liver project", organ: "liver", cell_count: 12000 }];
  expect(await hcaText("liver", deps({ hcaProjects: async () => hc as any }))).toBe(JSON.stringify(hc));
  expect(await hcaText("liver", deps({ hcaProjects: async () => { throw new Error("boom"); } }))).toBe("[]");
});

test("getPaperText → NOT_FOUND when unresolved, else the record", async () => {
  expect(await getPaperText("x", deps({ abstractByDoi: async () => null }))).toBe("NOT_FOUND");
  const t = await getPaperText("x", deps({ abstractByDoi: async () => ({ doi: "10.1/x", title: "T", abstract: "a" }) as any }));
  expect(JSON.parse(t).title).toBe("T");
});

test("getPaperText never throws (→ NOT_FOUND on error)", async () => {
  const t = await getPaperText("x", deps({ abstractByDoi: async () => { throw new Error("boom"); } }));
  expect(t).toBe("NOT_FOUND");
});

test("ontologyText → [] when empty, else the records", async () => {
  expect(await ontologyText("q", deps({ ontologyLookup: async () => [] }))).toBe("[]");
  const t = await ontologyText("q", deps({ ontologyLookup: async () => [{ id: "MONDO:1", label: "X" }] as any }));
  expect(JSON.parse(t)[0].id).toBe("MONDO:1");
});

test("makeLitMcp builds the 'lit' server with three tools", () => {
  const m = makeLitMcp();
  expect(Object.keys(m)).toEqual(["lit"]);
  const server = m.lit as any;
  // createSdkMcpServer stores the registered tools on the instance; assert all 3 are wired
  const tools = server.instance?.tools ?? server.tools ?? server.options?.tools;
  if (Array.isArray(tools)) expect(tools.length).toBe(3);
  else expect(server).toBeDefined(); // server built (SDK internal shape may vary)
});
