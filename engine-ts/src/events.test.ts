// Parity tests for the event-log port (events.ts) — mirrors src/dd_agent/events.py behaviour.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetSeq, emit, eventsDir, readStageEvents } from "./events";

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
