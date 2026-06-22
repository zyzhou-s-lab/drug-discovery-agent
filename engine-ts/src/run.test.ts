// Run-trigger tests: runSearch (status/report writes, error + cooperative-stop paths) and the
// scope/campaigns/search/stop endpoints. research/scope are injected — no SDK/network.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, type AppOpts } from "./app";
import { isRunning, runSearch, signalStop } from "./run";
import { Index } from "./store";

function setup(opts: AppOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ddrun-"));
  const art = join(dir, "art");
  const idx = new Index(join(dir, "s.sqlite"), art);
  return { idx, art, app: createApp(idx, art, opts) };
}
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const J = (r: Response): Promise<any> => r.json() as Promise<any>;
const ANGLES = [{ label: "g", query: "q" }];

test("runSearch writes running → done + report", async () => {
  const { art } = setup();
  const fakeResearch = async () => ({ question: "Q", findings: [{ claim: "c" }], stats: { confirmed: 1 } }) as any;
  await runSearch(art, "rs-done", "Alzheimer", ANGLES, { research: fakeResearch });
  expect(readJson(join(art, "rs-done", "search_status.json")).state).toBe("done");
  expect(readJson(join(art, "rs-done", "report.json")).findings[0].claim).toBe("c");
  expect(isRunning("rs-done")).toBe(false);
});

test("runSearch error path → state error", async () => {
  const { art } = setup();
  const boom = async () => {
    throw new Error("kaboom");
  };
  await runSearch(art, "rs-err", "X", ANGLES, { research: boom });
  expect(readJson(join(art, "rs-err", "search_status.json")).state).toBe("error");
});

test("runSearch honors cooperative stop → state stopped", async () => {
  const { art } = setup();
  let started = false;
  const slow = async (_d: string, _a: unknown, o: any) => {
    started = true;
    while (!o.shouldStop()) await new Promise((r) => setTimeout(r, 5));
    return { question: "Q", findings: [], stats: {} } as any;
  };
  const p = runSearch(art, "rs-stop", "X", ANGLES, { research: slow });
  while (!started) await new Promise((r) => setTimeout(r, 2));
  expect(signalStop("rs-stop")).toBe(true);
  await p;
  expect(readJson(join(art, "rs-stop", "search_status.json")).state).toBe("stopped");
});

test("POST /research/scope returns angles (injected scope), 400 on empty", async () => {
  const fakeScope = async (d: string) => ({ question: d, angles: [{ label: "genetics", query: "GWAS" }], budget: {} });
  const { app } = setup({ scopeFn: fakeScope as any });
  const r = await app.request("/api/research/scope", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ disease: "AMD" }) });
  expect((await J(r)).angles[0].label).toBe("genetics");
  expect((await app.request("/api/research/scope", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
});

test("POST /campaigns records the campaign", async () => {
  const { app, idx } = setup();
  await app.request("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: "ep-camp", disease: "AMD" }) });
  expect(idx.campaignExists("ep-camp")).toBe(true);
});

test("POST /search: 400 no-angles, 200 started, 409 already-running", async () => {
  const fakeResearch = async () => {
    await new Promise((r) => setTimeout(r, 50));
    return { question: "Q", findings: [], stats: {} } as any;
  };
  const { app } = setup({ researchFn: fakeResearch as any });
  const post = (b: unknown) => app.request("/api/campaigns/ep-search/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  expect((await post({ angles: [] })).status).toBe(400);
  expect((await J(await post({ angles: ANGLES, disease: "X" }))).started).toBe(true);
  expect((await post({ angles: ANGLES })).status).toBe(409); // already running
  await new Promise((r) => setTimeout(r, 80)); // let the background run finish (registry clears)
});

test("POST /stop → stopped=false when nothing running", async () => {
  const { app } = setup();
  expect((await J(await app.request("/api/campaigns/nope/stop", { method: "POST" }))).stopped).toBe(false);
});
