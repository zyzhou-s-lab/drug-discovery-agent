// Phase-4a TS port of api.py's read model — the CQRS read API on Hono over the Index (store.ts) +
// the event log (events.ts). Read-only: health / pipeline / campaigns / campaign view / report /
// stage events. The run trigger + SSE stream + config are later 4b/4c slices. createApp takes an
// injectable Index so it tests against a temp DB. See docs/bun-migration-eval.md Phase 4.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { applySettings, ConfigUpdateSchema, getConfig, NUM_BOUNDS, saveSettings, trustedOrigin } from "./config";
import { readStageEvents } from "./events";
import { Index } from "./store";

const DB_PATH = process.env.DD_DB ?? "/tmp/dd/state.sqlite";
const ARTIFACTS = process.env.DD_ARTIFACTS ?? "/tmp/dd/artifacts";

export interface PipelineStage {
  name: string;
  scatter: boolean;
  angles: string[];
  max_attempts: number;
}

// master = the deep-research flow: a single disease-overview stage (pipeline.py PIPELINE).
export const PIPELINE: PipelineStage[] = [{ name: "disease-overview", scatter: false, angles: [], max_attempts: 1 }];

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Reject path-traversal in a URL segment used to build a filesystem path (campaign / stage):
 * a decoded `..`, `/` or `\` must never reach join(). A real campaign/stage id has none. */
function safeSegment(s: string): boolean {
  return s.length > 0 && !s.includes("..") && !s.includes("/") && !s.includes("\\");
}

/** Join recorded stage_state onto the canonical PIPELINE order (not-yet-started stages → queued). */
export function campaignView(idx: Index, campaign: string) {
  const recorded = new Map<string, { status: string; attempts: number }>();
  for (const r of idx.allStates(campaign)) recorded.set(r.stage, { status: r.status, attempts: r.attempts });
  const stages = PIPELINE.map((s) => {
    const rec = recorded.get(s.name) ?? { status: "queued", attempts: 0 };
    return {
      name: s.name, status: rec.status, attempts: rec.attempts,
      scatter: s.scatter, angles: s.angles, updated_at: idx.stageUpdatedAt(campaign, s.name),
    };
  });
  return { campaign, stages };
}

export function createApp(idx?: Index, artifactsRoot: string = ARTIFACTS, opts: { sseIntervalMs?: number; sseMaxLifetimeMs?: number } = {}): Hono {
  const index = idx ?? new Index(DB_PATH, ARTIFACTS);
  const sseIntervalMs = opts.sseIntervalMs ?? 1000;
  const sseMaxLifetimeMs = opts.sseMaxLifetimeMs ?? 300_000; // cap a connection (client auto-reconnects)
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true })); // don't leak internal db/artifacts paths

  app.get("/api/pipeline", (c) => c.json({ stages: PIPELINE }));

  // ── settings page (model endpoint + deep-research knobs), persisted in settings.json ──
  // GET returns the key for the form to prefill — gated by the same CSRF guard as writes.
  app.get("/api/config", (c) => {
    if (!trustedOrigin(c.req.header("origin"))) return c.json({ error: "cross-origin read blocked" }, 403);
    return c.json(getConfig());
  });
  // POST = wholesale overwrite: the body IS the complete settings (every field required → 422 on a
  // partial body); a blank field reverts that override to the launch default.
  app.post("/api/config", async (c) => {
    if (!trustedOrigin(c.req.header("origin"))) return c.json({ error: "cross-origin write blocked" }, 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = ConfigUpdateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "incomplete or invalid body" }, 422);
    for (const [field, [lo, hi]] of Object.entries(NUM_BOUNDS)) {
      const v = (parsed.data as Record<string, unknown>)[field] as number;
      if (!(lo <= v && v <= hi)) return c.json({ error: `${field} must be between ${lo} and ${hi}` }, 422);
    }
    saveSettings(parsed.data);
    applySettings(parsed.data);
    return c.json(getConfig());
  });

  app.get("/api/campaigns", (c) => c.json({ campaigns: index.listCampaigns() }));

  app.get("/api/campaigns/:campaign", (c) => c.json(campaignView(index, c.req.param("campaign"))));

  // Poll the Search phase: {campaign, status:{state}, report|null}. (Orphan self-heal lives with
  // the run registry — added in the run-trigger slice.)
  app.get("/api/campaigns/:campaign/report", (c) => {
    const campaign = c.req.param("campaign");
    if (!safeSegment(campaign)) return c.json({ error: "invalid campaign" }, 400);
    const base = join(artifactsRoot, campaign);
    const status = readJson(join(base, "search_status.json")) ?? { state: "none" };
    const report = readJson(join(base, "report.json"));
    return c.json({ campaign, status, report });
  });

  app.get("/api/campaigns/:campaign/stages/:stage/events", (c) => {
    const campaign = c.req.param("campaign");
    const stage = c.req.param("stage");
    if (!safeSegment(campaign) || !safeSegment(stage)) return c.json({ error: "invalid path" }, 400);
    return c.json({ events: readStageEvents(artifactsRoot, campaign, stage) });
  });

  // SSE: push a fresh campaign view whenever stage_state changes; close once every stage is
  // terminal (done/exhausted, no queued) and nothing changed for a couple of ticks.
  app.get("/api/campaigns/:campaign/events", (c) => {
    const campaign = c.req.param("campaign");
    if (!safeSegment(campaign)) return c.json({ error: "invalid campaign" }, 400);
    return streamSSE(c, async (stream) => {
      let last = "";
      let idle = 0;
      const start = Date.now();
      while (!stream.aborted && !stream.closed && Date.now() - start < sseMaxLifetimeMs) {
        const view = campaignView(index, campaign);
        const snapshot = JSON.stringify(view); // campaignView builds a deterministic key order
        if (snapshot !== last) {
          last = snapshot;
          idle = 0;
          await stream.writeSSE({ data: JSON.stringify(view) });
        } else {
          idle++;
        }
        const statuses = new Set(view.stages.map((s) => s.status));
        const terminal = [...statuses].every((s) => s === "done" || s === "exhausted") && !statuses.has("queued");
        if (terminal && idle >= 2) {
          await stream.writeSSE({ event: "done", data: "{}" });
          break;
        }
        await stream.sleep(sseIntervalMs);
      }
    });
  });

  return app;
}
