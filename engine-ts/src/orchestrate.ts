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
const RATELIMIT = ["429", "too many requests", "rate limit", "rate_limit", "quota", "usage limit", "402", "insufficient", "balance"];

/** Trips after `threshold` CONSECUTIVE rate-limit/quota agent failures (any success resets). Fed by
 * runAgent; research checks `tripped` in its stop predicate so the run pauses instead of burning out. */
export class CircuitBreaker {
  private fails = 0;
  tripped = false;
  reason = "";
  constructor(private readonly threshold = parseInt(process.env.DD_DR_BREAKER || "8", 10)) {}
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

/** Per-agent model/proxy env overrides (DD_DR_MODEL / DD_AGENT_PROXY_SOCKS), like run_agent. */
function buildEnvOverride(): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const drModel = process.env.DD_DR_MODEL;
  if (drModel) {
    env.ANTHROPIC_MODEL = drModel;
    if (process.env.DD_DR_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.DD_DR_BASE_URL;
    if (process.env.DD_DR_AUTH_TOKEN) env.ANTHROPIC_AUTH_TOKEN = process.env.DD_DR_AUTH_TOKEN;
  }
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
  model?: string; // overrides DD_DR_MODEL (e.g. intake's DD_INTAKE_MODEL)
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
  const { onMessage, maxTurns = 12, shouldStop, systemPrompt, model: modelOpt, allowedTools, disallowedTools, breaker } = opts;
  let lastErrMsg = ""; // most recent error text (for the circuit breaker's rate-limit classification)
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
  if (disallowedTools) options.disallowedTools = disallowedTools;
  const model = modelOpt ?? process.env.DD_DR_MODEL; // opts.model (e.g. intake) wins over DD_DR_MODEL
  if (model) options.model = model;
  if (envOver) options.env = { ...process.env, ...envOver };

  const maxNudges = parseInt(process.env.DD_DR_NUDGE || "2", 10);
  const nudge = `You did not call \`${submitName}\`. You MUST call \`${submitName}\` to return your answer — the tool input IS your answer, in the required schema. Call it now.`;
  const maxRetries = parseInt(process.env.DD_DR_RETRY || "2", 10);

  const toolUses = new Map<string, string>();
  let toolResults: ToolResult[] = [];

  await sem.acquire();
  try {
    onMessage?.({ __dd_prompt__: prompt });
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let transient = false;
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
              if (TRANSIENT.some((m) => lastErrMsg.toLowerCase().includes(m))) transient = true;
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
        transient = TRANSIENT.some((x) => m.includes(x));
        if (!transient) console.warn(`[runAgent ${phase}] non-transient error: ${m.slice(0, 200)}`);
      }
      if (cap.v != null) return [cap.v, toolResults];
      if (attempt < maxRetries && transient && !(shouldStop && shouldStop()) && !budget.exhausted()) {
        await new Promise((r) => setTimeout(r, (2 ** attempt) * 1000 + Math.random() * 1000));
        continue;
      }
      break;
    }
  } finally {
    sem.release();
  }
  breaker?.note(cap.v == null, lastErrMsg); // one outcome per agent call: success resets, rate-limit fail counts
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
