// Unit test for scope() — mock the SDK so the agent "submits" angles; assert scope returns the
// {question, angles, budget} shape. The live decomposition is covered by scripts/phase3b-scope-smoke.ts.
import { expect, mock, test } from "bun:test";

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _d: string, _s: unknown, handler: any) => ({ name, handler }),
  createSdkMcpServer: (o: any) => ({ name: o.name, tools: o.tools }),
  query: (params: any) =>
    (async function* () {
      const submit = params.options.mcpServers.submit.tools[0].handler;
      await submit({ question: "AMD", angles: [{ label: "genetics", query: "GWAS in AMD", rationale: "target prior" }] });
      yield { type: "result", is_error: false, usage: { input_tokens: 40, output_tokens: 20 }, total_cost_usd: 0 };
    })(),
}));

const { scope } = await import("./scope");

test("scope returns the submitted angles + budget report", async () => {
  const out = await scope("age-related macular degeneration");
  expect(out?.question).toBe("AMD");
  expect((out?.angles as any[]).length).toBe(1);
  expect((out?.angles as any[])[0].label).toBe("genetics");
  expect((out?.budget as any).spent_tokens).toBe(60);
});
