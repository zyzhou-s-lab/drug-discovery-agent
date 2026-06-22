// Phase-4c server entry — apply persisted settings (mirroring api.py's import-time apply), then
// serve the Hono app on Bun. Run: bun src/server.ts  (PORT / DD_DB / DD_ARTIFACTS via env).
import { createApp } from "./app";
import { applySettings, loadSettings } from "./config";

applySettings(loadSettings());

const port = parseInt(process.env.PORT ?? "8099", 10);
console.log(`dd-engine-ts listening on :${port}`);

export default { port, fetch: createApp().fetch };
