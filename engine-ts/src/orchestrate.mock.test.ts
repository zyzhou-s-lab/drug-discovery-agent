// Offline unit tests for runAgent's core logic (submit capture, budget accounting, transient
// retry, prose-end salvage) by mocking the Agent SDK — so CI regresses these without a backend.
// The live end-to-end path is covered by scripts/phase3-runagent-smoke.ts.
import { afterEach, beforeAll, expect, mock, test } from "bun:test";
import { z } from "zod";

// scenario drives the mocked `query`; the mock invokes the real submit handler (from the in-process
// MCP server runAgent builds) to simulate the agent calling submit_*.
const scenario: { mode: "submit" | "transient" | "nontransient" | "nosubmit" | "nudge"; calls: number } = { mode: "submit", calls: 0 };

// restore the knobs the tests poke so they don't leak across tests/files
const ORIG: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["DD_DR_RETRY", "DD_DR_NUDGE"]) ORIG[k] = process.env[k];
});
afterEach(() => {
  for (const k of ["DD_DR_RETRY", "DD_DR_NUDGE"]) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _d: string, _s: unknown, handler: any) => ({ name, handler }),
  createSdkMcpServer: (o: any) => ({ name: o.name, tools: o.tools }),
  query: (params: any) => {
    scenario.calls++;
    return (async function* () {
      const submitHandler = params.options.mcpServers.submit.tools[0].handler;
      if (scenario.mode === "submit") {
        await submitHandler({ answer: "Paris", confidence: "high" });
        yield { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "submit_result" }] } };
        yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "recorded", is_error: false }] } };
        yield { type: "result", is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0 };
      } else if (scenario.mode === "transient") {
        throw new Error("HTTP 429 too many requests");
      } else if (scenario.mode === "nontransient") {
        throw new TypeError("bad input"); // no transient marker → must not retry
      } else if (scenario.mode === "nudge") {
        // turn 1 ends WITHOUT a submit → runAgent pushes a nudge into the input stream; the mock
        // reads it and submits on turn 2 (exercises the multi-turn nudge path).
        const it = params.prompt[Symbol.asyncIterator]();
        await it.next(); // the initial prompt
        yield { type: "result", is_error: false, usage: { input_tokens: 2, output_tokens: 1 }, total_cost_usd: 0 };
        const nudged = await it.next(); // the nudge runAgent pushed after the empty turn
        if (!nudged.done) {
          await submitHandler({ answer: "Paris", confidence: "high" });
          yield { type: "result", is_error: false, usage: { input_tokens: 2, output_tokens: 1 }, total_cost_usd: 0 };
        }
      } else {
        yield { type: "result", is_error: false, usage: { input_tokens: 3, output_tokens: 1 }, total_cost_usd: 0 };
      }
    })();
  },
}));

const { runAgent, Budget, Semaphore } = await import("./orchestrate");
const schema = { answer: z.string(), confidence: z.enum(["high", "medium", "low"]) };

test("runAgent returns the submitted args + accounts budget + captures tool results", async () => {
  scenario.mode = "submit";
  scenario.calls = 0;
  const b = new Budget();
  const [res, tools] = await runAgent("test", "p", "submit_result", schema, {}, b, new Semaphore(1), { maxTurns: 4 });
  expect(res).toEqual({ answer: "Paris", confidence: "high" });
  expect(tools.length).toBe(1);
  expect(tools[0]!.tool).toBe("submit_result");
  expect(b.spent()).toBe(15);
  expect(scenario.calls).toBe(1);
});

test("runAgent retries transient errors then salvages to [null, []]", async () => {
  scenario.mode = "transient";
  scenario.calls = 0;
  process.env.DD_DR_RETRY = "2";
  const [res, tools] = await runAgent("test", "p", "submit_result", schema, {}, new Budget(), new Semaphore(1), {});
  expect(res).toBe(null);
  expect(tools).toEqual([]);
  expect(scenario.calls).toBe(3); // initial + 2 retries
});

test("runAgent does NOT retry a non-transient error (logs + salvages once)", async () => {
  scenario.mode = "nontransient";
  scenario.calls = 0;
  process.env.DD_DR_RETRY = "2"; // retries allowed, but a non-transient error must not use them
  const [res] = await runAgent("test", "p", "submit_result", schema, {}, new Budget(), new Semaphore(1), {});
  expect(res).toBe(null);
  expect(scenario.calls).toBe(1); // initial attempt only — no retry
});

test("runAgent nudges a prose-ended turn, then captures the submit on retry-in-session", async () => {
  scenario.mode = "nudge";
  scenario.calls = 0;
  process.env.DD_DR_NUDGE = "2";
  const b = new Budget();
  const [res] = await runAgent("test", "p", "submit_result", schema, {}, b, new Semaphore(1), {});
  expect(res).toEqual({ answer: "Paris", confidence: "high" }); // submitted after the nudge
  expect(b.spent()).toBe(6); // two turns accounted (3 tokens each)
});

test("runAgent that never submits (prose-ended) salvages to [null, []]", async () => {
  scenario.mode = "nosubmit";
  scenario.calls = 0;
  process.env.DD_DR_RETRY = "0";
  const [res] = await runAgent("test", "p", "submit_result", schema, {}, new Budget(), new Semaphore(1), {});
  expect(res).toBe(null);
});

test("runAgent early-returns [null, []] when budget is already exhausted", async () => {
  const b = new Budget(10);
  b.add("x", { input_tokens: 6, output_tokens: 6 }); // spent 12 >= 10
  scenario.calls = 0;
  const [res] = await runAgent("test", "p", "submit_result", schema, {}, b, new Semaphore(1), {});
  expect(res).toBe(null);
  expect(scenario.calls).toBe(0); // never started the SDK
});
