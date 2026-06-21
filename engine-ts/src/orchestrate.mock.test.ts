// Offline unit tests for runAgent's core logic (submit capture, budget accounting, transient
// retry, prose-end salvage) by mocking the Agent SDK — so CI regresses these without a backend.
// The live end-to-end path is covered by scripts/phase3-runagent-smoke.ts.
import { expect, mock, test } from "bun:test";
import { z } from "zod";

// scenario drives the mocked `query`; the mock invokes the real submit handler (from the in-process
// MCP server runAgent builds) to simulate the agent calling submit_*.
const scenario: { mode: "submit" | "transient" | "nosubmit"; calls: number } = { mode: "submit", calls: 0 };

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
