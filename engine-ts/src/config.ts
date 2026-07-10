// Phase-4b TS port of api.py's user-configurable settings (settings page). A small JSON store lets
// the UI override the model endpoint + deep-research knobs; it is applied by writing into
// process.env, so every reader (DD_DR_CONC, ANTHROPIC_*) picks it up. settings.json (chmod 600)
// holds the api key; GET /config returns it for the form to prefill, but only to a trusted origin
// (the same CSRF guard as writes). See docs/bun-migration-eval.md Phase 4 + the merged #27 design.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

/** User-level config location (≈ ~/.claude/settings.json), NOT the data dir — the LLM endpoint +
 * api key + run knobs are this deployment's creds, nothing project-shareable, so they live in the
 * user config home, persistent and out of any repo. DD_SETTINGS_FILE overrides; resolved each call
 * (not a module const) so tests can point it elsewhere. */
export function settingsPath(): string {
  if (process.env.DD_SETTINGS_FILE) return process.env.DD_SETTINGS_FILE;
  const cfgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(cfgHome, "dda", "settings.json");
}

// UI field -> the env var it drives.
const UI_ENV_MAP: Record<string, string> = {
  model: "ANTHROPIC_MODEL",
  base_url: "ANTHROPIC_BASE_URL",
  api_key: "ANTHROPIC_AUTH_TOKEN",
  concurrency: "DD_DR_CONC",
  max_claims: "DD_DR_MAX_CLAIMS",
};
// Launch-time env, captured ONCE before any override, so clearing a UI field reverts to the
// deployment default rather than deleting it.
const LAUNCH_ENV: Record<string, string | undefined> = {};
for (const env of Object.values(UI_ENV_MAP)) LAUNCH_ENV[env] = process.env[env];

export const NUM_BOUNDS: Record<string, [number, number]> = { concurrency: [1, 32], max_claims: [1, 80] };

export const ConfigUpdateSchema = z.object({
  model: z.string(),
  base_url: z.string(),
  api_key: z.string(),
  concurrency: z.number().int(),
  max_claims: z.number().int(),
});

/** Read the persisted settings. Used by the server entry (Phase 4c) to applySettings(loadSettings())
 * on startup, mirroring api.py's import-time apply. */
export function loadSettings(): Record<string, unknown> {
  try {
    const data = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function saveSettings(cfg: Record<string, unknown>): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true }); // dirname always returns an absolute dir or "." — no `|| "."` needed
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  try {
    chmodSync(tmp, 0o600); // chmod BEFORE rename so the key file is never briefly 0644
  } catch {
    /* best-effort */
  }
  renameSync(tmp, p);
}

/** Project the stored overrides onto process.env (empty field → launch-time fallback). */
export function applySettings(cfg: Record<string, unknown>): void {
  for (const [field, env] of Object.entries(UI_ENV_MAP)) {
    const val = cfg[field];
    const eff = val != null && val !== "" ? String(val) : LAUNCH_ENV[env];
    if (eff == null) delete process.env[env];
    else process.env[env] = eff;
  }
}

function isLoopbackOrPrivate(host: string): boolean {
  if (host === "localhost") return true;
  const fam = isIP(host);
  if (fam === 0) return false; // public hostname → untrusted
  if (fam === 4) {
    const p = host.split(".").map(Number);
    const a = p[0]!;
    const b = p[1]!;
    // 127/8 loopback · 10/8 · 172.16-31 · 192.168 · 169.254 link-local · 100.64/10 Tailscale CGNAT
    // (the web is reached over the tailnet IP, e.g. 100.123.x.x — its same-origin POSTs must be trusted)
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const h = host.toLowerCase(); // IPv6: loopback / ULA / link-local
  return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
}

/** CSRF guard: a write/key-read is trusted only from no-Origin (curl/same-origin), an allow-listed
 * origin (DD_ALLOWED_ORIGINS), or a loopback/private/link-local host. A public site is rejected. */
export function trustedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  const allow = (process.env.DD_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length) return allow.includes(origin);
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return isLoopbackOrPrivate(host);
}

/** The GET /config response: effective endpoint + knobs, with the key round-tripped for prefill. */
export function getConfig() {
  // only ANTHROPIC_AUTH_TOKEN (the env the UI manages via UI_ENV_MAP); no ANTHROPIC_API_KEY
  // fallback, so clearing the key in the UI can't leave a stale externally-set key showing/effective.
  const key = process.env.ANTHROPIC_AUTH_TOKEN || "";
  return {
    model: process.env.ANTHROPIC_MODEL ?? null,
    base_url: process.env.ANTHROPIC_BASE_URL ?? null,
    base_url_set: Boolean(process.env.ANTHROPIC_BASE_URL),
    api_key: key,
    api_key_set: Boolean(key),
    concurrency: parseInt(process.env.DD_DR_CONC ?? "6", 10),
    max_claims: parseInt(process.env.DD_DR_MAX_CLAIMS ?? "25", 10),
    real_available: Boolean(key), // the SDK is always present in engine-ts
  };
}
