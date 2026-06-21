// Phase-2 TS port of the per-stage JSONL event log (src/dd_agent/events.py). emit() appends one
// JSON line per event to {artifacts}/{campaign}/events/{stage}.jsonl; readStageEvents() reads them
// back sorted by seq. The Python ContextVar (events_dir_var) → AsyncLocalStorage; the module-global
// seq counter needs no lock (single-threaded event loop). See docs/bun-migration-eval.md Phase 2.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Run a callback with the events dir bound, like the Python run thread setting events_dir_var. */
export const eventsDir = new AsyncLocalStorage<string>();

let _seq = 0;
function nextSeq(): number {
  return ++_seq;
}

const MAX_FIELD = 6000; // cap large tool inputs / results so the log stays renderable

/** JSON-serializable, size-capped copy of a field (truncate huge strings/dicts). */
function cap(value: unknown): unknown {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > MAX_FIELD) return s.slice(0, MAX_FIELD) + `… (+${s.length - MAX_FIELD} chars)`;
  return value;
}

export function emit(stage: string, label: string, type: string, fields: Record<string, unknown> = {}): void {
  const d = eventsDir.getStore();
  if (!d) return;
  mkdirSync(d, { recursive: true });
  const rec: Record<string, unknown> = { seq: nextSeq(), ts: Date.now() / 1000, stage, label, type };
  for (const [k, v] of Object.entries(fields)) rec[k] = cap(v);
  appendFileSync(join(d, `${stage}.jsonl`), JSON.stringify(rec) + "\n", "utf-8");
}

export function readStageEvents(artifactsRoot: string, campaign: string, stage: string): Record<string, unknown>[] {
  const path = join(artifactsRoot, campaign, "events", `${stage}.jsonl`);
  if (!existsSync(path)) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip malformed lines, like the Python except: pass
    }
  }
  out.sort((a, b) => ((a.seq as number) ?? 0) - ((b.seq as number) ?? 0));
  return out;
}

/** Test/seam helper: reset the module seq counter so tests are deterministic. */
export function _resetSeq(): void {
  _seq = 0;
}
