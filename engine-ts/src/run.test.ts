// Run-trigger tests: runSearch (status/report writes, error + cooperative-stop paths) and the
// scope/campaigns/search/stop endpoints. research/scope are injected — no SDK/network.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, type AppOpts } from "./app";
import { isRunning, OVERVIEW_STAGE, runPipeline, runSearch, signalStop } from "./run";
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

test("runSearch writes running → done + report; derives assets from deepresearch/", async () => {
  const { art } = setup();
  // research records its sub-agents under deepresearch/; deriveAssets reduces them into assets/
  const fakeResearch = async (_d: string, _a: unknown, o: any) => {
    o.persistStep?.("03_fetch", "00_db", { url: "u", angle: "g", source_type: "database", sourceQuality: "primary", claims: [{ claim: "d", quote: "q", source_type: "database", sourceUrl: "u" }] });
    return ({ question: "Q", findings: [{ claim: "c" }], references: [], stats: { confirmed: 1 } }) as any;
  };
  await runSearch(art, "rs-done", "Alzheimer", ANGLES, { research: fakeResearch });
  expect(readJson(join(art, "rs-done", "search_status.json")).state).toBe("done");
  expect(readJson(join(art, "rs-done", "report.json")).findings[0].claim).toBe("c");
  // end-of-run derives the compute-facing assets from the deepresearch/ source of truth
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

test("POST /campaigns records the campaign + fires the disease-overview pipeline", async () => {
  let fired: any = null;
  const { app, idx } = setup({ pipelineFn: (async (_i: any, _a: any, campaign: string, disease: string, o: any) => { fired = { campaign, disease, o }; }) as any });
  const j = await J(await app.request("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: "ep-camp", disease: "AMD", skip_intake: true }) }));
  expect(idx.campaignExists("ep-camp")).toBe(true);
  expect(j.started).toBe(true);
  expect(fired).toMatchObject({ campaign: "ep-camp", disease: "AMD", o: { real: true, skipIntake: true } });
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

test("runSearch wires persistStep → deepresearch/ files land via writeStepItem", async () => {
  const { art } = setup();
  const fakeResearch = async (_d: string, _a: unknown, o: any) => {
    o.persistStep?.("04_verify", "01_a-claim", { claim: "a claim", survives: true, vote: "3-0" });
    return { question: "Q", findings: [], references: [], stats: {} } as any;
  };
  await runSearch(art, "rs-step", "X", ANGLES, { research: fakeResearch });
  const v = readJson(join(art, "rs-step", "deepresearch", "04_verify", "01-a-claim.json"));
  expect(v.campaign).toBe("rs-step"); // writeStepItem stamped the campaign
  expect(v.step).toBe("04_verify");
  expect(v.survives).toBe(true);
  // and assets/ are derived from that record at end of run
  expect(readJson(join(art, "rs-step", "assets", "verified.json")).confirmed[0].claim).toBe("a claim");
});

// ── Phase-3c: disease-overview pipeline (scope) + narrative ──
test("runPipeline runs scope → records the disease-overview output (angles)", async () => {
  const { idx, art } = setup();
  const fakeScope = (async () => ({ question: "Q", angles: [{ label: "genetics", query: "g" }, { label: "expression", query: "e" }], budget: {} })) as any;
  await runPipeline(idx, art, "pl1", "AMD", { skipIntake: true, scope: fakeScope });
  const out = idx.output("pl1", OVERVIEW_STAGE) as any;
  expect(idx.status("pl1", OVERVIEW_STAGE)).toBe("done");
  expect(out.data.kind).toBe("scope");
  expect(out.data.angles.length).toBe(2);
  expect(out.summary).toContain("2 个研究角度");
});

test("runPipeline: intake rejection records a rejected output (no scope)", async () => {
  const { idx, art } = setup();
  let scoped = false;
  await runPipeline(idx, art, "pl2", "asdfqwer", {
    intake: (async () => ({ accepted: false, normalized_en: "", efo_id: "", reason: "not a disease" })) as any,
    scope: (async () => { scoped = true; return null; }) as any,
  });
  const out = idx.output("pl2", OVERVIEW_STAGE) as any;
  expect(out.data.kind).toBe("rejected");
  expect(out.summary).toContain("intake rejected");
  expect(scoped).toBe(false);
});

test("runSearch writes the narrative from the injected present fn", async () => {
  const { art } = setup();
  const fakeResearch = async () => ({ question: "Q", findings: [{ claim: "c" }], stats: {} }) as any;
  await runSearch(art, "nar1", "AMD", ANGLES, { research: fakeResearch, present: (async () => "## 执行摘要\n叙述正文") as any });
  expect(readJson(join(art, "nar1", "report.json")).narrative).toContain("叙述正文");
});

test("runPipeline: scope throwing → records a 'pipeline failed' output (no crash)", async () => {
  const { idx, art } = setup();
  await runPipeline(idx, art, "plerr", "AMD", { skipIntake: true, scope: (async () => { throw new Error("scope boom"); }) as any });
  const out = idx.output("plerr", OVERVIEW_STAGE) as any;
  expect(idx.status("plerr", OVERVIEW_STAGE)).toBe("done");
  expect(out.summary).toContain("pipeline failed");
});

test("runSearch auto-pauses (status 'paused') when the circuit breaker trips", async () => {
  const { art } = setup();
  const tripping = (async (_d: string, _a: unknown, o: any) => {
    for (let i = 0; i < 10; i++) o.breaker?.note(true, "API Error: 429 rate limit"); // simulate sustained 429
    return { question: "Q", findings: [], stats: {} } as any;
  });
  await runSearch(art, "paused1", "X", ANGLES, { research: tripping as any });
  const s = readJson(join(art, "paused1", "search_status.json"));
  expect(s.state).toBe("paused");
  expect(s.reason).toContain("429");
});
