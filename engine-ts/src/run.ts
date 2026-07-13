// Phase-4c run trigger — the background Search runner (api.py _run_search). Spawns research() as a
// fire-and-forget async task (the TS equivalent of the Python daemon thread), wrapping it in the
// eventsDir AsyncLocalStorage so emit() writes under the campaign, and writing search_status.json +
// report.json. Stop is cooperative (a shouldStop flag — no new agents; in-flight ones drain).
// research is injectable for offline tests. See docs/bun-migration-eval.md Phase 4.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { deriveAssets, writeCandidates, writeStepItem } from "./assets";
import { research as realResearch } from "./deep_research";
import { emit, emitStream, eventsDir } from "./events";
import { validateDisease as realValidate } from "./intake";
import { CircuitBreaker } from "./orchestrate";
import { presentReport as realPresent } from "./present";
import { scope as realScope } from "./scope";
import type { Index } from "./store";

export const SEARCH_STAGE = "deep-research";
export const OVERVIEW_STAGE = "disease-overview";

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
    // query/rationale are length-capped defensively (malicious/oversized input → bloated files/prompts).
    out.push({
      label: label || query.slice(0, 60),
      query: query.slice(0, 500),
      rationale: String(a?.rationale ?? "").slice(0, 1000),
    });
  }
  return out;
}

function writeJson(path: string, obj: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(obj), "utf-8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup — don't leave an orphan .tmp */
    }
    throw e;
  }
}

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export interface RunDeps {
  research?: ResearchFn;
  present?: typeof realPresent; // injectable narrative (defaults to presentReport); tests pass a no-op
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
  const base = join(artifactsRoot, campaign);
  const statusPath = join(base, "search_status.json");
  const reportPath = join(base, "report.json");
  const evDir = join(base, "events");

  // Heal a prior-lifetime orphan first: an on-disk 'running' with no live worker (checked BEFORE we
  // register) is a dead run — mark it stopped so its terminal state is recorded before this re-run.
  const prior = readJson(statusPath);
  if (prior?.state === "running" && !registry.has(campaign)) {
    writeJson(statusPath, { state: "stopped", note: "orphan cleared on restart", run: prior.run });
  }

  const entry: RunEntry = { stopped: false };
  registry.set(campaign, entry);

  // restart hygiene: a re-search starts clean — clear the prior run's report + this stage's event
  // log (verbatim from api.py _run_search), so old and new agent cards never mix.
  rmSync(reportPath, { force: true });
  rmSync(join(evDir, `${SEARCH_STAGE}.jsonl`), { force: true });

  // run id (api.py: int(time.time()*1000)) — the frontend resets its event view per (re)start.
  // isRunning() blocks a same-campaign concurrent start, so a same-ms collision can't happen.
  const runId = Date.now();
  writeJson(statusPath, { state: "running", angles: angles.length, run: runId });

  const breaker = new CircuitBreaker(); // auto-pause if the provider is sustainedly rate-limited
  try {
    const report = await eventsDir.run(evDir, () =>
      research(disease, angles, {
        breaker,
        shouldStop: () => entry.stopped,
        onProgress: (phase, done, total) => emit(SEARCH_STAGE, phase, "progress", { done, total }),
        onEvent: (phase, msg) => emit(SEARCH_STAGE, phase, "log", { msg }),
        // one expandable step card per agent (its thinking / tool calls / outcome) — api.py _run_search
        onAgent: (label, msg) => emitStream(SEARCH_STAGE, label, msg, { skipText: true, withOutcome: true }),
        // per-sub-agent record under deepresearch/{step}/ — the single, crash-safe source of truth
        // (search/fetch/verify/synthesize). assets/ are derived from this after the run
        // (deriveAssets). A throw here is surfaced via ev (→ the event stream) and continues — never
        // failing the run, but no longer silently swallowed.
        persistStep: (step, key, payload) => writeStepItem(artifactsRoot, campaign, step, key, payload),
      }),
    );
    writeJson(reportPath, report);
    // nomination → candidates.json (the ranked target list — the tool's target-discovery output).
    // efo/mondo id is best-effort scraped from an Open Targets source URL in the run's evidence.
    try {
      const efoId = (JSON.stringify(report.databaseFacts ?? []).match(/(?:MONDO|EFO)[_:]\d+/) ?? [""])[0].replace(":", "_");
      writeCandidates(report.candidates ?? [], artifactsRoot, campaign, { efoId, sortBy: "score" });
    } catch (e) {
      console.warn(`candidate write failed for ${campaign}:`, e);
    }
    // Derive the compute-facing assets/ contract by reducing the deepresearch/ record (the single
    // source of truth) — so assets/ can't drift from it and is rebuildable. The bibliography
    // (report.references) is threaded in (a cross-source, network-enriched projection not held in any
    // one step file). Best-effort — never fail the run on an asset write.
    try {
      deriveAssets(artifactsRoot, campaign, report.references ?? []);
    } catch (e) {
      console.warn(`asset derivation failed for ${campaign}:`, e);
    }
    // auto-pause takes precedence over "done": a tripped breaker means the report is a degraded
    // salvage (the provider was rate-limited), so surface "paused" + the reason, not a false "done".
    const final = entry.stopped ? "stopped" : breaker.tripped ? "paused" : "done";
    const status: Record<string, unknown> = { state: final, stats: report.stats, run: runId };
    if (breaker.tripped) {
      status.reason = breaker.reason;
      emit(SEARCH_STAGE, "synthesize", "log", { msg: `自动暂停:provider 限流/配额耗尽(${breaker.reason})` });
    }
    writeJson(statusPath, status);
    emit(SEARCH_STAGE, "synthesize", "result", { num_turns: report.stats?.agentCalls });
    // presentation (best-effort, AFTER the report is live so the tab shows immediately): turn the
    // structured English report into a polished Chinese Markdown narrative; fills in on next poll.
    try {
      const present = deps.present ?? realPresent;
      const nar = await present(report, disease, angles);
      if (nar) {
        report.narrative = nar;
        writeJson(reportPath, report);
      }
    } catch (e) {
      console.warn(`narrative failed for ${campaign}:`, e);
    }
  } catch (e) {
    writeJson(statusPath, { state: "error", error: String(e instanceof Error ? e.message : e), run: runId });
  } finally {
    registry.delete(campaign);
  }
}

export interface PipelineDeps {
  scope?: typeof realScope;
  intake?: typeof realValidate;
}

/** Run the disease-overview pipeline (scope) for a new campaign — api.py _run_pipeline. Optional
 * intake gate (skipped when the dialog already pre-checked), then scope → record the stage output
 * (angles) in the Index + step events. Fire-and-forget; awaitable for tests. */
export async function runPipeline(
  idx: Index,
  artifactsRoot: string,
  campaign: string,
  disease: string,
  opts: { real?: boolean; skipIntake?: boolean; focus?: string } & PipelineDeps = {},
): Promise<void> {
  const scope = opts.scope ?? realScope;
  const validate = opts.intake ?? realValidate;
  const evDir = join(artifactsRoot, campaign, "events");
  // single-shot gate breaker: threshold 1, so ONE quota/rate-limit failure (403/429/quota) in intake
  // or scope trips it — the run then records a clear "paused" state instead of a misleading empty/done.
  const breaker = new CircuitBreaker(1);
  const markPaused = () => {
    const reason = breaker.reason || "provider rate-limited";
    eventsDir.run(evDir, () => emit(OVERVIEW_STAGE, "scope", "log", { msg: `自动暂停:provider 限流/配额耗尽(${reason})` }));
    idx.markDone(campaign, OVERVIEW_STAGE, { stage: OVERVIEW_STAGE, summary: `provider 限流/配额耗尽,已暂停: ${reason}`, data: { kind: "paused", reason } }, {});
  };

  // intake gate (real runs without a prior /intake/check) — a rejection records & returns
  if (opts.real !== false && !opts.skipIntake) {
    let intake: { accepted: boolean; reason: string } | null = null;
    try {
      intake = await validate(disease, { breaker });
    } catch {
      intake = null; // an intake error shouldn't block the run
    }
    if (breaker.tripped) {
      idx.recordAttempt(campaign, OVERVIEW_STAGE);
      markPaused(); // provider quota/rate-limit during intake → paused, not a false "not a disease"
      return;
    }
    if (intake && !intake.accepted) {
      idx.recordAttempt(campaign, OVERVIEW_STAGE);
      eventsDir.run(evDir, () => emit(OVERVIEW_STAGE, "scope", "log", { msg: `intake 拒绝: ${intake.reason}` })); // surface in the step stream
      idx.markDone(campaign, OVERVIEW_STAGE, { stage: OVERVIEW_STAGE, summary: `intake rejected: ${intake.reason}`, data: { kind: "rejected", reason: intake.reason } }, {});
      return;
    }
  }

  idx.recordAttempt(campaign, OVERVIEW_STAGE);
  try {
    const res = await eventsDir.run(evDir, async () => {
      emit(OVERVIEW_STAGE, "scope", "session_start", { prompt: `deep-research scope: ${disease}` });
      return scope(disease, { focus: opts.focus, onMessage: (m) => emitStream(OVERVIEW_STAGE, "scope", m, { skipText: true }), breaker });
    });
    if (breaker.tripped) {
      markPaused(); // provider quota/rate-limit during scope → paused, not a false "0 angles / done"
      return;
    }
    const angles = ((res as any)?.angles as any[]) ?? [];
    const output = angles.length
      ? { stage: OVERVIEW_STAGE, summary: `Deep-research scope: ${angles.length} 个研究角度`, candidates: [], open_questions: ["scope-only 研究计划;完整检索简报(search→verify→synth)待 M2"], data: { kind: "scope", question: (res as any)?.question ?? disease, focus: opts.focus || undefined, angles, budget: (res as any)?.budget } }
      : { stage: OVERVIEW_STAGE, summary: "[deep-research scope] 未能拆解出研究角度", candidates: [], open_questions: ["scope returned no angles"] };
    idx.markDone(campaign, OVERVIEW_STAGE, output, {});
    // single scope agent → deepresearch/01_scope/scope.json (best-effort; never fails the run)
    try {
      writeStepItem(artifactsRoot, campaign, "01_scope", "scope", {
        question: (res as any)?.question ?? disease, focus: opts.focus || undefined, count: angles.length, angles,
      });
    } catch (e) {
      eventsDir.run(evDir, () => emit(OVERVIEW_STAGE, "scope", "log", { msg: `01_scope 落盘失败: ${e instanceof Error ? e.message : String(e)}` }));
    }
  } catch (e) {
    idx.markDone(campaign, OVERVIEW_STAGE, { stage: OVERVIEW_STAGE, summary: `pipeline failed: ${e instanceof Error ? e.message : String(e)}` }, {});
  }
}
