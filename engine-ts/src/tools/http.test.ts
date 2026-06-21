// HTTP error-path coverage (mock fetch): every fetch entry point surfaces a non-2xx response the
// same way Python's urlopen does (raise → clear error, or → "" for the best-effort helpers).
import { afterEach, expect, test } from "bun:test";

import { gql } from "./opentargets";
import { fetchText, searchLiteratureMulti } from "./paperfetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockStatus(status: number) {
  globalThis.fetch = (async () => new Response("<html>err</html>", { status })) as unknown as typeof fetch;
}

test("gql throws a clear HTTP error on non-2xx (not a JSON SyntaxError)", async () => {
  mockStatus(500);
  await expect(gql("query{}", {})).rejects.toThrow("OpenTargets HTTP 500");
});

test("searchLiteratureMulti throws with both sources' errors on non-2xx", async () => {
  mockStatus(503);
  await expect(searchLiteratureMulti("q")).rejects.toThrow("both OpenAlex and Semantic Scholar");
});

test("fetchText returns '' on non-2xx (not the error-page text)", async () => {
  mockStatus(404);
  expect(await fetchText("https://example.com/x")).toBe("");
});

test("fetchText returns '' for a non-http url without fetching", async () => {
  expect(await fetchText("ftp://nope")).toBe("");
});
