// Contract guard for the frontend <-> backend settings payload.
//
// Why this exists: the POST /api/config body (`ConfigUpdate`) is defined in THREE
// hand-synced places — engine-ts (Zod), the Python engine (pydantic), and the web
// client (`web/src/types/dda.ts`). When they drift, a knob the UI sends is silently
// ignored by the backend — exactly the "核验条数 was a no-op" regression (commit a794e2b).
//
// This test fails loudly the moment the web `ConfigUpdate` field set diverges from the
// backend `ConfigUpdateSchema` field set, so the no-op can never ship unnoticed.
//
// When you INTENTIONALLY add/remove a config knob: update BOTH sides (web ConfigUpdate +
// engine-ts ConfigUpdateSchema, and the pydantic ConfigUpdate) — then this test goes green.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ConfigUpdateSchema } from "./config";

const WEB_TYPES = new URL("../../web/src/types/dda.ts", import.meta.url).pathname;

function webInterfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`interface ${name} not found in ${WEB_TYPES}`);
  const bodyStart = source.indexOf("{", start) + 1;
  const bodyEnd = source.indexOf("}", bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => l.match(/^([A-Za-z0-9_]+)\??\s*:/)?.[1])
    .filter((f): f is string => Boolean(f));
}

describe("config contract: web ConfigUpdate <-> engine-ts ConfigUpdateSchema", () => {
  test("field sets are identical (no silently-ignored settings)", () => {
    const backend = Object.keys(ConfigUpdateSchema.shape).sort();
    const web = webInterfaceFields(readFileSync(WEB_TYPES, "utf8"), "ConfigUpdate").sort();

    const sentButIgnored = web.filter((f) => !backend.includes(f)); // UI sends, backend drops -> no-op bug
    const acceptedButUnsent = backend.filter((f) => !web.includes(f)); // backend expects, UI never sends -> 422

    expect(
      { sentButIgnored, acceptedButUnsent },
      `Config contract drift.\n` +
        `  web ConfigUpdate: [${web.join(", ")}]\n` +
        `  backend schema  : [${backend.join(", ")}]\n` +
        `  UI sends but backend ignores (no-op knob): [${sentButIgnored.join(", ")}]\n` +
        `  backend expects but UI never sends (422):  [${acceptedButUnsent.join(", ")}]\n` +
        `  -> update web/src/types/dda.ts, engine-ts/src/config.ts, and src/dd_agent/api.py together.`,
    ).toEqual({ sentButIgnored: [], acceptedButUnsent: [] });
  });
});
