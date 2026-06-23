// Read-API tests via Hono's app.request against a temp Index + artifact dir. No network.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./app";
import { emit, eventsDir } from "./events";
import { Index } from "./store";

const J = (r: Response): Promise<any> => r.json() as Promise<any>;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ddapi-"));
  const art = join(dir, "art");
  const idx = new Index(join(dir, "s.sqlite"), art);
  return { idx, art, app: createApp(idx, art) };
}

test("GET /api/health → {ok} only (no internal paths leaked)", async () => {
  const { app } = setup();
  const r = await app.request("/api/health");
  expect(r.status).toBe(200);
  const j = await J(r);
  expect(j.ok).toBe(true);
  expect(j.db).toBeUndefined();
  expect(j.artifacts).toBeUndefined();
});

test("path-traversal in campaign/stage is rejected (400)", async () => {
  const { app } = setup();
  expect((await app.request("/api/campaigns/" + encodeURIComponent("../etc") + "/report")).status).toBe(400);
  expect((await app.request("/api/campaigns/c1/stages/" + encodeURIComponent("../../passwd") + "/events")).status).toBe(400);
  expect((await app.request("/api/campaigns/" + encodeURIComponent("../etc") + "/events")).status).toBe(400); // SSE too
});

test("GET /api/pipeline lists the disease-overview stage", async () => {
  const { app } = setup();
  const j = await J(await app.request("/api/pipeline"));
  expect(j.stages[0].name).toBe("disease-overview");
  expect(j.stages[0].max_attempts).toBe(1);
});

test("GET /api/campaigns + detail reflect the Index", async () => {
  const { app, idx } = setup();
  idx.recordCampaign("c1", "Alzheimer");
  idx.recordAttempt("c1", "disease-overview");
  idx.markDone("c1", "disease-overview", {}, {});

  const list = await J(await app.request("/api/campaigns"));
  expect(list.campaigns[0].campaign).toBe("c1");
  expect(list.campaigns[0].disease).toBe("Alzheimer");

  const view = await J(await app.request("/api/campaigns/c1"));
  expect(view.stages[0].name).toBe("disease-overview");
  expect(view.stages[0].status).toBe("done");
});

test("GET /api/campaigns/:c — unknown campaign → all stages queued", async () => {
  const { app } = setup();
  const view = await J(await app.request("/api/campaigns/nope"));
  expect(view.stages[0].status).toBe("queued");
  expect(view.stages[0].attempts).toBe(0);
});

test("GET /api/campaigns/:c/report reads status + report files", async () => {
  const { app, art } = setup();
  mkdirSync(join(art, "c1"), { recursive: true });
  writeFileSync(join(art, "c1", "search_status.json"), JSON.stringify({ state: "done" }));
  writeFileSync(join(art, "c1", "report.json"), JSON.stringify({ summary: "S", findings: [] }));
  const j = await J(await app.request("/api/campaigns/c1/report"));
  expect(j.status.state).toBe("done");
  expect(j.report.summary).toBe("S");
});

test("GET /api/campaigns/:c/report — no files → state none, report null", async () => {
  const { app } = setup();
  const j = await J(await app.request("/api/campaigns/c1/report"));
  expect(j.status.state).toBe("none");
  expect(j.report).toBe(null);
});

test("GET stage events returns the JSONL log", async () => {
  const { app, art } = setup();
  eventsDir.run(join(art, "c1", "events"), () => emit("disease-overview", "scope", "progress", { done: 1, total: 6 }));
  const j = await J(await app.request("/api/campaigns/c1/stages/disease-overview/events"));
  expect(j.events.length).toBe(1);
  expect(j.events[0].label).toBe("scope");
  expect(j.events[0].total).toBe(6);
});

test("SSE event stream pushes a view then closes 'done' when terminal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ddsse-"));
  const art = join(dir, "art");
  const idx = new Index(join(dir, "s.sqlite"), art);
  idx.recordAttempt("c1", "disease-overview");
  idx.markDone("c1", "disease-overview", {}, {}); // all stages terminal → stream closes
  const app = createApp(idx, art, { sseIntervalMs: 5 });
  const text = await (await app.request("/api/campaigns/c1/events")).text();
  expect(text).toContain("data:");
  expect(text).toContain("event: done");
}, 5000);

test("SSE keeps polling a non-terminal campaign, then closes at the lifetime cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ddsse2-"));
  const art = join(dir, "art");
  const idx = new Index(join(dir, "s.sqlite"), art);
  idx.recordAttempt("c1", "disease-overview"); // in_progress → never terminal
  const app = createApp(idx, art, { sseIntervalMs: 5, sseMaxLifetimeMs: 60 });
  const text = await (await app.request("/api/campaigns/c1/events")).text();
  expect(text).toContain("data:"); // pushed the running view
  expect(text).not.toContain("event: done"); // never terminal → closed by the lifetime cap, not 'done'
}, 5000);

// ── Phase-1 port: read/CRUD endpoints (stage detail / references / rename / delete / files) ──
test("PATCH /api/campaigns/:c renames (trimmed); 404 unknown, 400 empty title", async () => {
  const { app, idx } = setup();
  idx.recordCampaign("c1", "AMD");
  const patch = (c: string, body: unknown) =>
    app.request(`/api/campaigns/${c}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await J(await patch("c1", { title: "  My Run  " }))).title).toBe("My Run");
  expect((await patch("nope", { title: "X" })).status).toBe(404); // don't UPSERT a phantom
  expect((await patch("c1", { title: "  " })).status).toBe(400); // empty title rejected
});

test("DELETE /api/campaigns/:c removes record + artifact dir; rejects traversal", async () => {
  const { app, idx, art } = setup();
  idx.recordCampaign("c1", "AMD");
  mkdirSync(join(art, "c1"), { recursive: true });
  writeFileSync(join(art, "c1", "report.json"), "{}");
  const j = await J(await app.request("/api/campaigns/c1", { method: "DELETE" }));
  expect(j.deleted).toBe(true);
  expect(idx.campaignExists("c1")).toBe(false);
  expect(existsSync(join(art, "c1"))).toBe(false);
  expect((await app.request("/api/campaigns/" + encodeURIComponent("../x"), { method: "DELETE" })).status).toBe(400);
});

test("GET /api/campaigns/:c/stages/:s → detail; unknown stage 404", async () => {
  const { app, idx } = setup();
  idx.recordCampaign("c1", "AMD");
  const j = await J(await app.request("/api/campaigns/c1/stages/disease-overview"));
  expect(j.stage).toBe("disease-overview");
  expect(j.status).toBe("queued"); // nothing recorded yet
  expect(j.attempts).toBe(0);
  expect((await app.request("/api/campaigns/c1/stages/nope")).status).toBe(404);
});

test("GET /api/campaigns/:c/references → empty when no literature evidence", async () => {
  const { app, idx } = setup();
  idx.recordCampaign("c1", "AMD");
  const j = await J(await app.request("/api/campaigns/c1/references"));
  expect(j.count).toBe(0);
  expect(j.references).toEqual([]);
  expect(j.unresolved).toEqual([]);
});

test("GET /files lists artifacts (sorted); /files/raw reads + guards traversal", async () => {
  const { app, art } = setup();
  mkdirSync(join(art, "c1", "events"), { recursive: true });
  writeFileSync(join(art, "c1", "report.json"), '{"x":1}');
  writeFileSync(join(art, "c1", "events", "deep-research.jsonl"), "line\n");
  writeFileSync(join(art, "secret.txt"), "outside"); // a real file OUTSIDE the campaign dir
  const list = await J(await app.request("/api/campaigns/c1/files"));
  expect(list.files.map((f: any) => f.path)).toEqual(["events/deep-research.jsonl", "report.json"]); // sorted
  expect((await J(await app.request("/api/campaigns/c1/files/raw?path=report.json"))).content).toBe('{"x":1}');
  expect((await app.request("/api/campaigns/c1/files/raw?path=" + encodeURIComponent("../secret.txt"))).status).toBe(400); // escapes root → guard
  expect((await app.request("/api/campaigns/c1/files/raw?path=nope.json")).status).toBe(404); // absent → 404
});

test("PATCH / stage-detail / references reject path traversal (400)", async () => {
  const { app } = setup();
  const bad = encodeURIComponent("../x");
  expect((await app.request(`/api/campaigns/${bad}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
  expect((await app.request(`/api/campaigns/${bad}/stages/disease-overview`)).status).toBe(400);
  expect((await app.request(`/api/campaigns/${bad}/references`)).status).toBe(400);
});
