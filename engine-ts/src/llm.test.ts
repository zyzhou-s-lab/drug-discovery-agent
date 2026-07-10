// Tests for the direct-Anthropic LLM helper config (no network).
import { afterEach, expect, test } from "bun:test";

import { defaultChat, makeJudgeClient, streamChatText } from "./llm";

const CREDS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"];
const saved: Record<string, string | undefined> = {};
for (const k of CREDS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of CREDS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("makeJudgeClient → null when no credential is configured", () => {
  for (const k of CREDS) delete process.env[k];
  expect(makeJudgeClient()).toBeNull();
});

test("makeJudgeClient uses ANTHROPIC_MODEL (config.ts single source); defaults when unset", () => {
  for (const k of CREDS) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = "k";
  expect(makeJudgeClient()?.model).toBe("claude-sonnet-4-5"); // default when ANTHROPIC_MODEL unset
  process.env.ANTHROPIC_MODEL = "mimo-x";
  expect(makeJudgeClient()?.model).toBe("mimo-x");
});

test("makeJudgeClient works with ANTHROPIC_AUTH_TOKEN alone (no api key)", () => {
  for (const k of CREDS) delete process.env[k];
  process.env.ANTHROPIC_AUTH_TOKEN = "tok";
  expect(makeJudgeClient()).not.toBeNull();
});

test("defaultChat degrades to a plain message when no credential is configured", async () => {
  for (const k of CREDS) delete process.env[k];
  let out = "";
  await defaultChat("sys", [{ role: "user", content: "hi" }], (t) => { out += t; });
  expect(out).toContain("未配置 LLM 密钥");
});

test("streamChatText propagates an API error (which defaultChat catches → degrades)", async () => {
  const jc = { model: "x", client: { messages: { stream: () => (async function* () { throw new Error("quota exceeded"); })() } } } as any;
  await expect(streamChatText(jc, "s", [{ role: "user", content: "hi" }], () => {})).rejects.toThrow("quota exceeded");
});
