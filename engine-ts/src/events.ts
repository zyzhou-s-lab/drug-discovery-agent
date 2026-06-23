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

/** Map one Agent SDK stream message (or runAgent's `{__dd_prompt__}` sentinel) to step-card events
 * via emit(), mirroring worker.py _emit_stream. `skipText` drops chatty assistant prose; `withOutcome`
 * includes ResultMessage.result as the card's Outcome (on for search agents, off for scope). Never
 * throws — telemetry must not break the run. */
export function emitStream(stage: string, label: string, msg: any, opts: { skipText?: boolean; withOutcome?: boolean } = {}): void {
  try {
    if (msg && typeof msg === "object" && "__dd_prompt__" in msg) {
      emit(stage, label, "session_start", { prompt: String(msg.__dd_prompt__) });
      return;
    }
    const t = msg?.type;
    if (t === "assistant") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "thinking") emit(stage, label, "thinking", { text: b.thinking });
        else if (b.type === "text") {
          if (!opts.skipText && b.text && String(b.text).trim()) emit(stage, label, "text", { text: b.text });
        } else if (b.type === "tool_use") emit(stage, label, "tool_use", { tool_id: b.id, name: b.name, input: b.input });
      }
    } else if (t === "user" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === "tool_result") emit(stage, label, "tool_result", { tool_id: b.tool_use_id, content: b.content, is_error: Boolean(b.is_error) });
      }
    } else if (t === "result") {
      const u = msg.usage ?? {};
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
      emit(stage, label, "result", {
        session_id: msg.session_id ?? null,
        is_error: Boolean(msg.is_error),
        cost: msg.total_cost_usd ?? null,
        num_turns: msg.num_turns ?? null,
        result: opts.withOutcome ? (msg.result ?? null) : null,
        tokens,
      });
    }
  } catch {
    /* telemetry must never break the run */
  }
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
