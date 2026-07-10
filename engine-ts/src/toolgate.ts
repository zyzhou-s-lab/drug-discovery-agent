// Per-tool enable/disable gate for the settings page. Disabled tool names (bare — unique across our
// servers) persist to ~/.config/dda/disabled-tools.json and are applied at pipeline-build time
// (makeLitMcp filters them out), so a toggle takes effect on the NEXT run — same "下次运行生效" model
// as the config settings. Core tools (search_disease) are never gated here (intake depends on them).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function gatePath(): string {
  if (process.env.DD_TOOLGATE_FILE) return process.env.DD_TOOLGATE_FILE;
  const cfgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(cfgHome, "dda", "disabled-tools.json");
}

export function getDisabledTools(): Set<string> {
  try {
    const arr = JSON.parse(readFileSync(gatePath(), "utf-8"));
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set(); // no file yet → nothing disabled
  }
}

/** Toggle one tool; persists the new disabled set and returns it. */
export function setToolEnabled(tool: string, enabled: boolean): string[] {
  const s = getDisabledTools();
  if (enabled) s.delete(tool);
  else s.add(tool);
  const arr = [...s];
  const p = gatePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(arr, null, 2));
  return arr;
}
