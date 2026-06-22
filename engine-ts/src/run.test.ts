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

test("runSearch writes running → done + report + overview assets", async () => {
  const { art } = setup();
  const fakeResearch = async () => ({ question: "Q", findings: [{ claim: "c" }], sources: [{ url: "u", quality: "primary" }], databaseFacts: [{ claim: "d" }], stats: { confirmed: 1 } }) as any;
  await runSearch(art, "rs-done", "Alzheimer", ANGLES, { research: fakeResearch });
  expect(readJson(join(art, "rs-done", "search_status.json")).state).toBe("done");
  expect(readJson(join(art, "rs-done", "report.json")).findings[0].claim).toBe("c");
  // end-of-run sediments the compute-facing assets next to the report
  expect(readJson(join(art, "rs-done", "assets", "sources.json")).count).toBe(1);
  expect(readJson(join(art, "rs-done", "assets", "database_facts.json")).count).toBe(1);
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

test("report orphan self-heal: running with no live worker → stopped + persisted", async () => {
  const { app, art } = setup();
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  mkdirSync(join(art, "orph"), { recursive: true });
  const sp = join(art, "orph", "search_status.json");
  writeFileSync(sp, JSON.stringify({ state: "running", run: 1 })); // no live worker in registry
  const j = await J(await app.request("/api/campaigns/orph/report"));
  expect(j.status.state).toBe("stopped"); // healed on read
  expect(JSON.parse(readFileSync(sp, "utf-8")).state).toBe("stopped"); // and persisted to the file
});

test("stop + create-campaign reject path traversal (400)", async () => {
  const { app } = setup();
  expect((await app.request("/api/campaigns/" + encodeURIComponent("../x") + "/stop", { method: "POST" })).status).toBe(400);
  const r = await app.request("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: "../x", disease: "d" }) });
  expect(r.status).toBe(400);
});

test("runSearch heals a stale 'running' status then completes the re-run", async () => {
  const { art } = setup();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(art, "re-run"), { recursive: true });
  writeFileSync(join(art, "re-run", "search_status.json"), JSON.stringify({ state: "running", run: 1 })); // orphan
  const fake = async () => ({ question: "Q", findings: [], stats: {} }) as any;
  await runSearch(art, "re-run", "X", ANGLES, { research: fake });
  expect(readJson(join(art, "re-run", "search_status.json")).state).toBe("done"); // re-run took over cleanly
});

test("POST /research/scope rejects an over-long disease (400)", async () => {
  const fakeScope = async (d: string) => ({ question: d, angles: [], budget: {} });
  const { app } = setup({ scopeFn: fakeScope as any });
  const long = "x".repeat(2001);
  const r = await app.request("/api/research/scope", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ disease: long }) });
  expect(r.status).toBe(400);
});

test("POST /stop returns stopped:true while a run is live", async () => {
  const slow = async (_d: string, _a: unknown, o: any) => {
    while (!o.shouldStop()) await new Promise((r) => setTimeout(r, 5));
    return { question: "Q", findings: [], stats: {} } as any;
  };
  const { app } = setup({ researchFn: slow as any });
  await app.request("/api/campaigns/stp/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ angles: ANGLES, disease: "X" }) });
  await new Promise((r) => setTimeout(r, 10));
  expect((await J(await app.request("/api/campaigns/stp/stop", { method: "POST" }))).stopped).toBe(true);
  await new Promise((r) => setTimeout(r, 40)); // let it drain (registry clears)
});

test("POST /search truncates angles to DD_DR_MAX_ANGLES", async () => {
  const prev = process.env.DD_DR_MAX_ANGLES;
  process.env.DD_DR_MAX_ANGLES = "1";
  try {
    const fake = async () => ({ question: "Q", findings: [], stats: {} }) as any;
    const { app } = setup({ researchFn: fake as any });
    const j = await J(await app.request("/api/campaigns/maxa/search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ angles: [{ label: "a", query: "qa" }, { label: "b", query: "qb" }, { label: "c", query: "qc" }], disease: "X" }),
    }));
    expect(j.angles).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    if (prev === undefined) delete process.env.DD_DR_MAX_ANGLES; // restore even if the assert throws
    else process.env.DD_DR_MAX_ANGLES = prev;
  }
});

test("POST /search rejects an over-long disease (400)", async () => {
  const { app } = setup();
  const r = await app.request("/api/campaigns/dl/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ angles: ANGLES, disease: "x".repeat(2001) }),
  });
  expect(r.status).toBe(400);
});
