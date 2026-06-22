// Phase-4c run trigger — the background Search runner (api.py _run_search). Spawns research() as a
// fire-and-forget async task (the TS equivalent of the Python daemon thread), wrapping it in the
// eventsDir AsyncLocalStorage so emit() writes under the campaign, and writing search_status.json +
// report.json. Stop is cooperative (a shouldStop flag — no new agents; in-flight ones drain).
// research is injectable for offline tests. See docs/bun-migration-eval.md Phase 4.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { research as realResearch } from "./deep_research";
import { emit, eventsDir } from "./events";

export const SEARCH_STAGE = "deep-research";

type ResearchFn = typeof realResearch;

interface RunEntry {
  stopped: boolean;
}
const registry = new Map<string, RunEntry>();

/** True iff a background search is live for this campaign (drives the 409 + orphan self-heal). */
export function isRunning(campaign: string): boolean {
  return registry.has(campaign);
}

/** Cooperative stop: set the shouldStop flag so research() starts no new agents. Returns whether
 * one was running. */
export function signalStop(campaign: string): boolean {
  const entry = registry.get(campaign);
  if (!entry) return false;
  entry.stopped = true;
  return true;
}

export interface Angle {
  label: string;
  query: string;
  rationale?: string;
}

/** Normalize raw angle objects (custom angles may carry only a label). Drops empties. */
export function normalizeAngles(raw: unknown): Angle[] {
  if (!Array.isArray(raw)) return [];
  const out: Angle[] = [];
  for (const a of raw) {
    const label = String(a?.label ?? "").trim();
    const query = String(a?.query ?? "").trim() || label;
    if (!query) continue;
    // label falls back to the query head (verbatim from api.py); a label-only custom angle is fine.
    out.push({ label: label || query.slice(0, 60), query, rationale: String(a?.rationale ?? "") });
  }
  return out;
}

function writeJson(path: string, obj: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 0), "utf-8");
  renameSync(tmp, path);
}

export interface RunDeps {
  research?: ResearchFn;
}

/** Run the Search phase in the background. Awaitable (tests await it); the HTTP endpoint
 * fire-and-forgets it. Writes search_status.json (running → done/stopped/error) + report.json. */
export async function runSearch(
  artifactsRoot: string,
  campaign: string,
  disease: string,
  angles: Angle[],
  deps: RunDeps = {},
): Promise<void> {
  const research = deps.research ?? realResearch;
  const entry: RunEntry = { stopped: false };
  registry.set(campaign, entry);

  const base = join(artifactsRoot, campaign);
  const statusPath = join(base, "search_status.json");
  const reportPath = join(base, "report.json");
  const evDir = join(base, "events");
  // restart hygiene: clear the prior run's report + this stage's event log
  rmSync(reportPath, { force: true });
  rmSync(join(evDir, `${SEARCH_STAGE}.jsonl`), { force: true });

  // run id (api.py: int(time.time()*1000)) — the frontend resets its event view per (re)start.
  // isRunning() blocks a same-campaign concurrent start, so a same-ms collision can't happen.
  const runId = Date.now();
  writeJson(statusPath, { state: "running", angles: angles.length, run: runId });

  try {
    const report = await eventsDir.run(evDir, () =>
      research(disease, angles, {
        shouldStop: () => entry.stopped,
        onProgress: (phase, done, total) => emit(SEARCH_STAGE, phase, "progress", { done, total }),
        onEvent: (phase, msg) => emit(SEARCH_STAGE, phase, "log", { msg }),
      }),
    );
    writeJson(reportPath, report);
    const final = entry.stopped ? "stopped" : "done";
    writeJson(statusPath, { state: final, stats: report.stats, run: runId });
    emit(SEARCH_STAGE, "synthesize", "result", { num_turns: report.stats?.agentCalls });
  } catch (e) {
    writeJson(statusPath, { state: "error", error: String(e instanceof Error ? e.message : e), run: runId });
  } finally {
    registry.delete(campaign);
  }
}
