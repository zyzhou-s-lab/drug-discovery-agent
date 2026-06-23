// Parity tests for the event-log port (events.ts) — mirrors src/dd_agent/events.py behaviour.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetSeq, emit, emitStream, eventsDir, readStageEvents } from "./events";

test("emit + readStageEvents round-trip, sorted by seq", () => {
  _resetSeq();
  const root = mkdtempSync(join(tmpdir(), "ddev-"));
  const dir = join(root, "camp", "events");
  eventsDir.run(dir, () => {
    emit("deep-research", "search", "progress", { done: 0, total: 6 });
    emit("deep-research", "fetch", "progress", { done: 1, total: 3 });
  });
  const evs = readStageEvents(root, "camp", "deep-research");
  expect(evs.length).toBe(2);
  expect(evs[0]!.seq).toBe(1);
  expect(evs[0]!.label).toBe("search");
  expect(evs[1]!.total).toBe(3);
});

test("emit without an eventsDir bound is a no-op", () => {
  _resetSeq();
  emit("s", "l", "t", {}); // no ALS store → returns silently, no throw
  const root = mkdtempSync(join(tmpdir(), "ddev2-"));
  expect(readStageEvents(root, "nope", "s")).toEqual([]); // missing path → []
});

test("cap truncates oversized fields", () => {
  _resetSeq();
  const root = mkdtempSync(join(tmpdir(), "ddev3-"));
  const dir = join(root, "c", "events");
  const big = "x".repeat(7000);
  eventsDir.run(dir, () => emit("s", "l", "text", { text: big }));
  const text = readStageEvents(root, "c", "s")[0]!.text as string;
  expect(text.length).toBeLessThan(7000);
  expect(text).toContain("+1000 chars");
});

test("emitStream maps SDK messages → step events (skipText drops prose; withOutcome keeps result)", () => {
  _resetSeq();
  const art = mkdtempSync(join(tmpdir(), "ddstream-"));
  eventsDir.run(join(art, "c1", "events"), () => {
    emitStream("deep-research", "L", { __dd_prompt__: "P" });
    emitStream("deep-research", "L", { type: "assistant", message: { content: [{ type: "thinking", thinking: "T" }, { type: "text", text: "chatty" }, { type: "tool_use", id: "t1", name: "WebSearch", input: { q: "x" } }] } }, { skipText: true });
    emitStream("deep-research", "L", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "R", is_error: false }] } });
    emitStream("deep-research", "L", { type: "result", session_id: "s1", is_error: false, total_cost_usd: 0.01, num_turns: 3, usage: { input_tokens: 10, output_tokens: 5 }, result: "OUT" }, { withOutcome: true });
  });
  const evs = readStageEvents(art, "c1", "deep-research") as any[];
  expect(evs.map((e) => e.type)).toEqual(["session_start", "thinking", "tool_use", "tool_result", "result"]); // text dropped
  expect(evs.find((e) => e.type === "tool_use").name).toBe("WebSearch");
  const res = evs.find((e) => e.type === "result");
  expect(res.tokens).toBe(15);
  expect(res.result).toBe("OUT");
});

test("emitStream withOutcome=false drops result text; never throws on junk", () => {
  _resetSeq();
  const art = mkdtempSync(join(tmpdir(), "ddstream2-"));
  eventsDir.run(join(art, "c1", "events"), () => {
    emitStream("deep-research", "L", { type: "result", usage: {}, result: "X" }); // default withOutcome=false
    emitStream("deep-research", "L", null); // junk → no throw, no event
    emitStream("deep-research", "L", { type: "weird" });
  });
  const evs = readStageEvents(art, "c1", "deep-research") as any[];
  expect(evs.length).toBe(1);
  expect(evs[0].result).toBe(null);
});
