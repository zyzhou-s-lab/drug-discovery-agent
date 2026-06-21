// Parity tests for the Index port (store.ts) — mirrors the behaviour of src/dd_agent/index.py.
// Offline: a temp sqlite + artifact dir per test. Same schema/SQL as Python → parity by construction.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Index } from "./store";

let dir: string;
let idx: Index;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ddstore-"));
  idx = new Index(join(dir, "state.sqlite"), join(dir, "artifacts"));
});
afterEach(() => idx.close());

test("recordAttempt increments attempts + sets in_progress", () => {
  expect(idx.status("c", "s")).toBe(null);
  expect(idx.attempts("c", "s")).toBe(0);
  idx.recordAttempt("c", "s");
  expect(idx.status("c", "s")).toBe("in_progress");
  expect(idx.attempts("c", "s")).toBe(1);
  idx.recordAttempt("c", "s");
  expect(idx.attempts("c", "s")).toBe(2);
});

test("markDone stores status + output + verdict", () => {
  idx.recordAttempt("c", "s");
  idx.markDone("c", "s", { a: 1 }, { converged: true });
  expect(idx.isDone("c", "s")).toBe(true);
  expect(idx.output("c", "s")).toEqual({ a: 1 });
  expect(idx.verdict("c", "s")).toEqual({ converged: true });
});

test("markExhausted with reason → output {rejected}", () => {
  idx.recordAttempt("c", "s");
  idx.markExhausted("c", "s", "not a disease");
  expect(idx.status("c", "s")).toBe("exhausted");
  expect(idx.output("c", "s")).toEqual({ rejected: "not a disease" });
});

test("allStates ordered by insertion (rowid)", () => {
  idx.recordAttempt("c", "a");
  idx.recordAttempt("c", "b");
  expect(idx.allStates("c").map((r) => r.stage)).toEqual(["a", "b"]);
});

test("campaign record / exists / rename / aggregate / delete", () => {
  idx.recordCampaign("c", "Alzheimer");
  expect(idx.campaignExists("c")).toBe(true);
  idx.renameCampaign("c", "My run");
  let row = idx.listCampaigns()[0]!;
  expect(row.disease).toBe("Alzheimer"); // rename keeps disease
  expect(row.title).toBe("My run");

  idx.recordAttempt("c", "s");
  idx.markDone("c", "s", {}, {});
  row = idx.listCampaigns()[0]!;
  expect(row.stages).toBe(1);
  expect(row.done).toBe(1);

  idx.deleteCampaign("c");
  expect(idx.campaignExists("c")).toBe(false);
  expect(idx.allStates("c")).toEqual([]);
});

test("listCampaigns includes orphan runs (stage_state but no campaigns row)", () => {
  idx.recordAttempt("orphan", "s");
  const found = idx.listCampaigns().find((r) => r.campaign === "orphan");
  expect(found?.disease).toBe(null);
  expect(found?.stages).toBe(1);
});

test("writeArtifact is content-addressed + atomic", () => {
  const p = idx.writeArtifact("c", "report", '{"x":1}');
  expect(existsSync(p)).toBe(true);
  expect(p).toContain(join("c", "01_discovery"));
  expect(idx.writeArtifact("c", "report", '{"x":1}')).toBe(p); // same content → same hash → same path
});

test("job idempotency hook upserts jobid", () => {
  expect(idx.getJob("c", "k")).toBe(null);
  idx.putJob("c", "k", "job-123");
  expect(idx.getJob("c", "k")).toBe("job-123");
  idx.putJob("c", "k", "job-456");
  expect(idx.getJob("c", "k")).toBe("job-456");
});
