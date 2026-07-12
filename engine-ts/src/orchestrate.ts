// Phase-3 TS port of orchestrate.py run_agent — the one isolated forced-tool agent primitive
// (deep-research's `agent({schema})`). The forced structured output = an in-process MCP `submit_*`
// tool the prompt makes the only completion action; zod validates the args natively (replacing
// Python's _schema_errors). Multi-turn nudge uses the SDK's streaming-input mode. See
// docs/bun-migration-eval.md Phase 3 + deep-research-port-plan §4.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";

import { Budget } from "./core";

export { Budget };

export type OnMessage = (msg: unknown) => void;
export type ShouldStop = () => boolean;

// Verbatim from orchestrate.py: a substring of one of these in a result/error → retryable. The
// short markers (socket/connection/reset) can in theory false-match an unrelated message; kept as
// a faithful 1:1 of the Python list (same trade-off there) — tighten later if it bites.
const TRANSIENT = [
  "429", "too many requests", "overloaded", "rate limit", "rate_limit",
  "503", "502", "500", "socket", "connection", "timed out", "timeout", "reset",
];

// A sustained run of THESE (rate-limit / quota / out-of-balance) means the provider is unusable for
// the rest of the run — the circuit breaker trips and auto-pauses rather than grinding every agent
// to a failed call (the t2d incident: ~52 min of all-429 verify calls).
const RATELIMIT = ["429", "too many requests", "rate limit", "rate_limit", "quota", "usage limit", "402", "403", "permission_error", "insufficient", "out of balance"];

/** Trips after `threshold` CONSECUTIVE rate-limit/quota agent failures (any success resets). Fed by
 * runAgent; research checks `tripped` in its stop predicate so the run pauses instead of burning out. */
export class CircuitBreaker {
  private fails = 0;
  private readonly threshold: number;
  tripped = false;
  reason = "";
  constructor(threshold = parseInt(process.env.DD_DR_BREAKER || "8", 10)) {
    this.threshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 8; // a junk DD_DR_BREAKER must not disable protection
  }
  note(isError: boolean, msg = ""): void {
    if (!isError) {
      this.fails = 0;
      return;
    }
    if (RATELIMIT.some((m) => msg.toLowerCase().includes(m))) {
      this.fails++;
      if (this.fails >= this.threshold && !this.tripped) {
        this.tripped = true;
        this.reason = (msg.slice(0, 200) || "provider rate-limited").trim();
      }
    }
  }
}

/** A manually-driven async iterable of user messages — lets us push the initial prompt, then a
 * nudge after a turn ends (the SDK streaming-input multi-turn pattern). */
class InputStream {
  private queue: any[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    this.queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<any> {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      if (this.closed) return;
      await new Promise<void>((r) => (this.waiter = r));
    }
  }
}

/** Optional SOCKS proxy env override (DD_AGENT_PROXY_SOCKS). Model/endpoint/key come from the single
 * config.ts source (ANTHROPIC_MODEL/BASE_URL/AUTH_TOKEN) — no per-agent model override. */
function buildEnvOverride(): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  if (process.env.DD_AGENT_PROXY_SOCKS) {
    // The agent gets an HTTP proxy (http_proxy) pointing at the in-process HTTP→SOCKS5 bridge
    // (proxy_bridge.py); DD_AGENT_PROXY_SOCKS names the bridge's UPSTREAM socks (host:port). So the
    // agent speaks HTTP to the bridge, which tunnels to that SOCKS — not a SOCKS client misconfig.
    const purl = "http://127.0.0.1:" + (process.env.DD_AGENT_PROXY_PORT || "7899");
    const noParts = ["localhost", "127.0.0.1", "::1"];
    const base = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "";
    if (base) {
      try {
        const h = new URL(base).hostname;
        if (h) noParts.push(h);
      } catch { /* not a URL */ }
    }
    if (process.env.DD_AGENT_NO_PROXY) noParts.push(...process.env.DD_AGENT_NO_PROXY.split(",").map((p) => p.trim()).filter(Boolean));
    const noproxy = noParts.join(",");
    Object.assign(env, {
      http_proxy: purl, https_proxy: purl, HTTP_PROXY: purl, HTTPS_PROXY: purl, no_proxy: noproxy, NO_PROXY: noproxy,
    });
  }
  return Object.keys(env).length ? env : undefined;
}

export interface ToolResult {
  tool: string;
  content: unknown;
  is_error: boolean;
}

export interface RunAgentOpts {
  onMessage?: OnMessage;
  maxTurns?: number;
  shouldStop?: ShouldStop;
  systemPrompt?: string; // agent system prompt (e.g. the intake gate persona)
  allowedTools?: string[]; // whitelist — restrict the agent's tools (intake: only submit + search_disease)
  disallowedTools?: string[]; // blocklist (belt-and-suspenders alongside allowedTools)
  breaker?: CircuitBreaker; // fed this agent's outcome (success/rate-limit fail) for auto-pause
}

/**
 * Run one forced-tool agent. Returns [result, toolResults]: `result` = the submitted args (or null
 * if the agent never called submit — prose-ended / errored / budget-exhausted → callers salvage);
 * `toolResults` = the MCP tool results the agent saw (verbatim structured data). `schema` is a zod
 * raw shape ({field: zodType}); the SDK validates submit args against it.
 */
export async function runAgent(
  phase: string,
  prompt: string,
  submitName: string,
  schema: z.ZodRawShape,
  extraMcp: Record<string, unknown>,
  budget: Budget,
  sem: Semaphore,
  opts: RunAgentOpts = {},
): Promise<[Record<string, unknown> | null, ToolResult[]]> {
  const { onMessage, maxTurns = 12, shouldStop, systemPrompt, allowedTools, disallowedTools, breaker } = opts;
  let lastErrMsg = ""; // most recent error text (any attempt)
  let rateLimitMsg = ""; // a rate-limit/quota error seen on ANY attempt — survives a later attempt's
  // different error so a 429-then-other-error call is still counted as rate-limited by the breaker
  if ((shouldStop && shouldStop()) || budget.exhausted()) return [null, []];

  const cap: { v: Record<string, unknown> | null } = { v: null };
  const submit = tool(submitName, "Submit the structured result. Call exactly once when done.", schema, async (args: any) => {
    cap.v = args;
    return { content: [{ type: "text", text: "recorded" }] };
  });
  // NB: callers must not use "submit" as an extraMcp key — it would shadow the forced-output server.
  const servers: Record<string, unknown> = { submit: createSdkMcpServer({ name: "submit", version: "1.0.0", tools: [submit] }), ...extraMcp };

  const envOver = buildEnvOverride();
  const options: any = {
    mcpServers: servers,
    // Headless automation agents only — these run our own fixed prompts on a sandboxed deep-research
    // run, never user-controlled tool calls, so bypassing the permission prompt is intentional.
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns,
    settingSources: [], // don't inherit host CLAUDE.md
  };
  if (systemPrompt) options.systemPrompt = systemPrompt;
  if (allowedTools) options.allowedTools = allowedTools;
  // When web-rooter (client-side MCP search) is wired into this agent, block the Anthropic
  // server-side WebSearch/WebFetch built-ins: on the Kimi gateway they're broken (400 / no real
  // web access), so leaving them available just burns turns + tokens. The agent uses
  // mcp__webrooter__web_search / _web_fetch instead. Only these two are forced off; everything
  // else (lit MCP tools, Bash, Read, submit) stays available.
  const effDisallow = "webrooter" in extraMcp ? [...(disallowedTools ?? []), "WebSearch", "WebFetch"] : disallowedTools;
  if (effDisallow) options.disallowedTools = effDisallow;
  const model = process.env.ANTHROPIC_MODEL; // single source: config.ts (settings page)
  if (model) options.model = model;
  if (envOver) options.env = { ...process.env, ...envOver };
  // WebFetch's "preflight" is a domain safety/blocklist check that calls back to claude.ai. On a
  // third-party Anthropic-compatible gateway (e.g. Kimi) that callback can't complete, so the
  // preflight aborts EVERY WebFetch before it fetches anything ("Unable to verify if domain X is safe
  // to fetch. This may be due to network restrictions or enterprise security policies blocking
  // claude.ai."). The host CAN reach those domains directly, so skipping the preflight lets WebFetch
  // do the real fetch. Inline `settings` applies even under settingSources:[] isolation. Opt out:
  // DD_SKIP_WEBFETCH_PREFLIGHT=0.
  if (process.env.DD_SKIP_WEBFETCH_PREFLIGHT !== "0") {
    const prev = typeof options.settings === "object" && options.settings ? options.settings : {};
    options.settings = { ...prev, skipWebFetchPreflight: true };
  }

  const maxNudges = parseInt(process.env.DD_DR_NUDGE || "2", 10);
  const nudge = `You did not call \`${submitName}\`. You MUST call \`${submitName}\` to return your answer — the tool input IS your answer, in the required schema. Call it now.`;
  const maxRetries = parseInt(process.env.DD_DR_RETRY || "2", 10);
  // Rate-limit (429 / 403 频限 / quota) gets its OWN, longer backoff + more attempts than a generic
  // transient error (5xx/socket): on a shared Anthropic-compatible gateway (e.g. Kimi) a frequency
  // limit is a ROLLING WINDOW that recovers in minutes, so the 1-4s transient backoff can't ride it
  // out — the run would trip the breaker mid-flight and abstain a swath of votes. Backing off tens of
  // seconds lets the agent wait the window out and SUCCEED; the breaker then only trips on a TRULY
  // sustained limit (all rate retries spent). Tunable via DD_DR_RATE_*.
  const rateRetries = parseInt(process.env.DD_DR_RATE_RETRY || "4", 10);
  const rateBackoffBase = parseInt(process.env.DD_DR_RATE_BACKOFF_MS || "15000", 10);
  const rateBackoffCap = parseInt(process.env.DD_DR_RATE_BACKOFF_CAP_MS || "60000", 10);
  const lastAttempt = Math.max(maxRetries, rateRetries); // loop far enough for the slower rate path

  const toolUses = new Map<string, string>();
  let toolResults: ToolResult[] = [];

  await sem.acquire();
  try {
    onMessage?.({ __dd_prompt__: prompt });
    for (let attempt = 0; attempt <= lastAttempt; attempt++) {
      let transient = false;
      let rateLimited = false; // this attempt hit a 429/403/quota (rolling-window) limit → long backoff
      toolUses.clear();
      toolResults = [];
      const input = new InputStream();
      input.push(prompt);
      let nudges = 0;
      try {
        const q = query({ prompt: input, options } as any);
        for await (const msg of q as AsyncIterable<any>) {
          onMessage?.(msg);
          if (msg.type === "assistant") {
            for (const b of msg.message?.content ?? []) if (b.type === "tool_use") toolUses.set(b.id, b.name);
          } else if (msg.type === "user" && Array.isArray(msg.message?.content)) {
            for (const b of msg.message.content) {
              if (b.type === "tool_result") {
                toolResults.push({ tool: toolUses.get(b.tool_use_id) ?? "", content: b.content, is_error: Boolean(b.is_error) });
              }
            }
          } else if (msg.type === "result") {
            budget.add(phase, msg.usage, msg.total_cost_usd ?? 0);
            if (msg.is_error) {
              lastErrMsg = String(msg.result ?? "");
              const low = lastErrMsg.toLowerCase();
              if (TRANSIENT.some((m) => low.includes(m))) transient = true;
              if (RATELIMIT.some((m) => low.includes(m))) { rateLimitMsg = lastErrMsg; rateLimited = true; }
            }
            // turn boundary: submitted → done; else nudge (bounded) or close
            if (cap.v != null) { input.close(); break; }
            if (nudges < maxNudges && !(shouldStop && shouldStop()) && !budget.exhausted()) { nudges++; input.push(nudge); }
            else { input.close(); }
          }
        }
      } catch (err) {
        // Classify rather than blanket-retry (Python's bare `except` masked bugs): a transient
        // marker (429/5xx/socket) is retried; anything else is logged and NOT retried — it falls
        // through to return [null, []] (the salvage path), so a programming bug fails fast & visibly
        // instead of looping maxRetries times in silence. Not rethrown (would crash the run vs salvage).
        const m = String(err instanceof Error ? err.message : err).toLowerCase();
        lastErrMsg = m;
        if (RATELIMIT.some((x) => m.includes(x))) { rateLimitMsg = m; rateLimited = true; }
        transient = TRANSIENT.some((x) => m.includes(x));
        if (!transient) console.warn(`[runAgent ${phase}] non-transient error: ${m.slice(0, 200)}`);
      }
      if (cap.v != null) return [cap.v, toolResults];
      const stop = (shouldStop && shouldStop()) || budget.exhausted();
      // rate-limit takes precedence (429 is in BOTH lists): long escalating backoff, more attempts —
      // ride out the gateway's rolling frequency window so the agent succeeds instead of abstaining.
      if (rateLimited && attempt < rateRetries && !stop) {
        const wait = Math.min(rateBackoffBase * 2 ** attempt, rateBackoffCap) + Math.random() * Math.min(rateBackoffBase, 2000);
        console.warn(`[runAgent ${phase}] rate-limited (attempt ${attempt + 1}/${rateRetries + 1}) — backing off ${Math.round(wait / 1000)}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      // generic transient (5xx/socket): short backoff, few attempts
      if (transient && attempt < maxRetries && !stop) {
        await new Promise((r) => setTimeout(r, (2 ** attempt) * 1000 + Math.random() * 1000));
        continue;
      }
      break;
    }
  } finally {
    sem.release();
  }
  // one outcome per agent call: success resets the streak; a failure that hit a rate-limit on ANY
  // attempt counts (rateLimitMsg, not just the last attempt's error).
  breaker?.note(cap.v == null, rateLimitMsg || lastErrMsg);
  return [cap.v, toolResults];
}

/** Minimal async semaphore (asyncio.Semaphore equivalent) — bounds concurrent agents. */
export class Semaphore {
  private permits: number;
  private waiters: (() => void)[] = [];
  constructor(permits: number) {
    this.permits = permits;
  }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release(): void {
    const w = this.waiters.shift();
    if (w) w();
    else this.permits++;
  }
}
