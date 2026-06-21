// Read-API tests via Hono's app.request against a temp Index + artifact dir. No network.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("GET /api/health", async () => {
  const { app } = setup();
  const r = await app.request("/api/health");
  expect(r.status).toBe(200);
  expect((await J(r)).ok).toBe(true);
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
