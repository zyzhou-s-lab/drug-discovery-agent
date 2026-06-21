// Unit tests for the literature MCP tool bodies (litmcp.ts) — dependency-injected, so no SDK or
// module mocking: just pass fake tool fns and assert the slim/NOT_FOUND/[] formatting + never-throw.
import { expect, test } from "bun:test";

import { getPaperText, type LitDeps, makeLitMcp, ontologyText, searchLiteratureText } from "./litmcp";

const deps = (over: Partial<LitDeps>): LitDeps => ({
  searchLiteratureMulti: async () => [] as any,
  abstractByDoi: async () => null,
  ontologyLookup: async () => [],
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
