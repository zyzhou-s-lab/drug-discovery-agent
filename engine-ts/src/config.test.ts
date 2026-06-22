// Config endpoint tests via Hono app.request: wholesale save + key round-trip + CSRF origin guard
// + bounds/incomplete → 422. DD_SETTINGS_FILE points at a temp file (settingsPath is dynamic).
import { afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./app";

const J = (r: Response): Promise<any> => r.json() as Promise<any>;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "ddcfg-"));
  process.env.DD_SETTINGS_FILE = join(dir, "settings.json");
  app = createApp(undefined, join(dir, "art"));
});
afterEach(() => {
  delete process.env.DD_ALLOWED_ORIGINS;
});

const full = { model: "mimo-v2.5-pro", base_url: "https://api.mimo/anthropic", api_key: "sk-zzz", concurrency: 8, max_claims: 30 };
const post = (b: unknown, h: Record<string, string> = {}) =>
  app.request("/api/config", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });

test("POST wholesale save applies to env + GET round-trips the key", async () => {
  const r = await post(full);
  expect(r.status).toBe(200);
  const body = await J(r);
  expect(body.model).toBe("mimo-v2.5-pro");
  expect(body.api_key).toBe("sk-zzz");
  expect(body.api_key_set).toBe(true);
  expect(body.concurrency).toBe(8);
  expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-zzz");
  expect((await J(await app.request("/api/config"))).api_key).toBe("sk-zzz"); // GET (no origin) round-trip
});

test("GET /config: cross-origin read → 403, private-LAN / localhost → 200", async () => {
  expect((await app.request("/api/config", { headers: { origin: "https://evil.com" } })).status).toBe(403);
  expect((await app.request("/api/config", { headers: { origin: "http://10.0.0.5:5173" } })).status).toBe(200);
  expect((await app.request("/api/config", { headers: { origin: "http://localhost:5173" } })).status).toBe(200);
});

test("DD_ALLOWED_ORIGINS allow-list overrides the heuristic", async () => {
  process.env.DD_ALLOWED_ORIGINS = "https://my.app";
  expect((await app.request("/api/config", { headers: { origin: "https://my.app" } })).status).toBe(200);
  expect((await app.request("/api/config", { headers: { origin: "http://10.0.0.5:5173" } })).status).toBe(403); // not in the list
});

test("POST: incomplete body → 422, out-of-bounds → 422, cross-origin → 403", async () => {
  expect((await post({ model: "x" })).status).toBe(422); // incomplete
  expect((await post({ ...full, concurrency: 99 })).status).toBe(422); // out of bounds
  expect((await post(full, { origin: "https://evil.com" })).status).toBe(403); // cross-site write
});

test("POST clearing the key (empty string) removes the override", async () => {
  await post(full);
  expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-zzz");
  await post({ ...full, api_key: "" });
  expect(process.env.ANTHROPIC_AUTH_TOKEN).not.toBe("sk-zzz"); // reverted to the launch default
});
