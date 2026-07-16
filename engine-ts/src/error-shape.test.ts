// BUG-R1 regression (found via the api-design audit).
//
// The two backends diverged on error-body shape: Python/FastAPI returns {detail: "..."},
// this engine returned {error: "..."}. But the web client (web/src/api/dda.ts:35) reads
// `.detail`, so EVERY backend error message silently vanished in the UI when running on this
// engine — which has been the default backend since 2026-06-24. Classic "change one backend,
// break the frontend" regression that a typecheck can never catch.
//
// Contract locked here: every JSON error response must carry a non-empty `detail` string
// (the field the web client reads). If a new route emits {error} without {detail}, this fails.

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { Index } from "./store";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "dderr-"));
  const art = join(dir, "art");
  const idx = new Index(join(dir, "s.sqlite"), art);
  return createApp(idx, art);
}

// Representative error routes (all hit the c.json({error}, status) paths).
const cases: Array<[string, number]> = [
  ["/api/campaigns/" + encodeURIComponent("../etc") + "/report", 400], // safeSegment guard
  ["/api/campaigns/" + encodeURIComponent("../etc") + "/events", 400], // SSE guard
  ["/api/campaigns/c1/stages/" + encodeURIComponent("../../passwd") + "/events", 400],
];

test("BUG-R1: JSON error responses expose `detail` (the field the web client reads)", async () => {
  const app = setup();
  for (const [path, status] of cases) {
    const r = await app.request(path);
    expect(r.status).toBe(status);
    const body = (await r.json()) as { detail?: unknown };
    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).length).toBeGreaterThan(0);
  }
});
