// Tests for the direct-Anthropic LLM helper config (no network).
import { afterEach, expect, test } from "bun:test";

import { makeJudgeClient } from "./llm";

const CREDS = ["ANTHROPIC_AUTH_TOKEN", "DD_JUDGE_API_KEY", "ANTHROPIC_API_KEY", "DD_JUDGE_MODEL", "ANTHROPIC_MODEL", "DD_JUDGE_BASE_URL", "ANTHROPIC_BASE_URL"];
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

test("makeJudgeClient picks DD_JUDGE_* over ANTHROPIC_*; defaults the model", () => {
  for (const k of CREDS) delete process.env[k];
  process.env.DD_JUDGE_API_KEY = "k";
  expect(makeJudgeClient()?.model).toBe("claude-sonnet-4-5"); // default
  process.env.DD_JUDGE_MODEL = "mimo-x";
  expect(makeJudgeClient()?.model).toBe("mimo-x");
});
