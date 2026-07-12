// Web-Rooter integration — a client-side (MCP, stdio) web search/fetch server that replaces the
// dead Anthropic server-side WebSearch/WebFetch on the Kimi gateway. It runs as a Python subprocess
// (baojiachen0214/web-rooter) whose browser + HTTP egress is routed through a SOCKS proxy (the akko
// overseas exit) so it reaches Google / PubMed / etc. from behind the GFW. Config is env-driven so
// deployment-specific paths live in the systemd unit, not the repo:
//   DD_WEBROOTER_PY        python interpreter of the web-rooter venv          (required to enable)
//   DD_WEBROOTER_MAIN      path to web-rooter main.py                          (required to enable)
//   DD_WEBROOTER_PROXY     socks5://host:port overseas exit   (default socks5://127.0.0.1:1080)
//   DD_WEBROOTER_BROWSERS  PLAYWRIGHT_BROWSERS_PATH            (default ~/.cache/ms-playwright)
//   DD_WEBROOTER_TIMEOUT_MS per-call MCP timeout (browser search is slow)     (default 120000)
// When DD_WEBROOTER_PY/MAIN are unset, webRooterMcp() is a no-op and the WEB_SEARCH/WEB_FETCH
// constants fall back to the built-in WebSearch/WebFetch names — degraded, but no worse than the
// current broken state (and orchestrate.ts only blocks the built-ins when web-rooter is present).

export const WEBROOTER_ENABLED = Boolean(process.env.DD_WEBROOTER_PY && process.env.DD_WEBROOTER_MAIN);

// Only WebSearch is dead on the Kimi gateway (400 Invalid request). When web-rooter is wired in the
// agent sees mcp__webrooter__web_search; the model resolves the short name, matching how the lit MCP
// tools (search_literature, get_paper, …) are referenced in the same prompts.
export const WEB_SEARCH = WEBROOTER_ENABLED ? "web_search" : "WebSearch";
// WebFetch is NOT dead: with skipWebFetchPreflight (orchestrate.ts) it fetches fine on Kimi (verified
// against PubMed) and is faster than web-rooter's akko-browser fetch, so page READING stays on the
// native built-in — always "WebFetch", regardless of web-rooter. web-rooter's own web_fetch is still
// registered and available as a fallback, just not the tool the prompts steer to.
export const WEB_FETCH = "WebFetch";

/** stdio MCP server config for the SDK (mcpServers["webrooter"]), or {} when not configured. */
export function webRooterMcp(): Record<string, unknown> {
  const command = process.env.DD_WEBROOTER_PY;
  const main = process.env.DD_WEBROOTER_MAIN;
  if (!command || !main) return {};

  // inherit the parent env (PATH/HOME/…) as strings, then force the web-rooter-specific overrides
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.WEBROOTER_PROXY = process.env.DD_WEBROOTER_PROXY ?? "socks5://127.0.0.1:1080";
  env.PLAYWRIGHT_BROWSERS_PATH = process.env.DD_WEBROOTER_BROWSERS ?? `${process.env.HOME}/.cache/ms-playwright`;
  env.PYTHONUNBUFFERED = "1";
  env.PYTHONIOENCODING = "utf-8";

  return {
    webrooter: {
      type: "stdio",
      command,
      args: [main, "--mcp"],
      env,
      timeout: parseInt(process.env.DD_WEBROOTER_TIMEOUT_MS ?? "120000", 10),
    },
  };
}
