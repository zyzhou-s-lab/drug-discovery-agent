// Direct Anthropic Messages client for the non-agent LLM endpoints (side-chat / intake translate /
// report narrative) — distinct from the agent SDK (orchestrate.ts) used by the research pipeline.
// Config from DD_JUDGE_* falling back to ANTHROPIC_*, mirroring api.py campaign_chat.
import Anthropic from "@anthropic-ai/sdk";

export interface JudgeClient {
  client: Anthropic;
  model: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/** Build an Anthropic client from the judge/LLM env, or null if no credential is configured. */
export function makeJudgeClient(): JudgeClient | null {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.DD_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!authToken && !apiKey) return null;
  const baseURL = process.env.DD_JUDGE_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const opts: Record<string, unknown> = {};
  if (baseURL) opts.baseURL = baseURL;
  if (apiKey) opts.apiKey = apiKey;
  else if (authToken) opts.authToken = authToken;
  const model = process.env.DD_JUDGE_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  return { client: new Anthropic(opts), model };
}

/** Stream a chat completion's text deltas to onText (max_tokens 1024, like api.py). */
export async function streamChatText(
  jc: JudgeClient,
  system: string,
  messages: ChatMessage[],
  onText: (t: string) => void | Promise<void>,
): Promise<void> {
  // only user/assistant reach the API — an unknown role (e.g. a stray frontend value) would make the
  // SDK throw mid-stream; drop it rather than fail the whole turn.
  const clean = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const stream = jc.client.messages.stream({
    model: jc.model,
    max_tokens: 1024,
    system,
    messages: clean as Anthropic.MessageParam[],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") await onText(event.delta.text);
  }
}

/** Single-shot completion (non-streaming) → text, with backoff retry. Fires right after a 70+-agent
 * run that may have saturated the backend (429/overload), so retry a few times; "" on no credential
 * or final failure (never throws). Used for the report narrative (api.py _present_report). */
export async function completeText(
  system: string,
  user: string,
  opts: { maxTokens?: number; retries?: number; backoffMs?: (attempt: number) => number } = {},
): Promise<string> {
  const jc = makeJudgeClient();
  if (!jc) return "";
  const retries = opts.retries ?? 5;
  const backoff = opts.backoffMs ?? ((a) => 2 ** a * 3000); // 3,6,12,24s
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const msg = await jc.client.messages.create({
        model: jc.model,
        max_tokens: opts.maxTokens ?? 8192,
        system,
        messages: [{ role: "user", content: user }],
      });
      return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    } catch (e) {
      if (attempt < retries - 1) await new Promise((r) => setTimeout(r, backoff(attempt)));
      else console.error("[completeText] giving up after retries:", e instanceof Error ? e.message : String(e));
    }
  }
  return "";
}

/** Default chat sink used by the /chat endpoint: builds the client, streams, and degrades to a
 * plain message when there's no credential or the call errors (never throws — it's a stream body). */
export async function defaultChat(
  system: string,
  messages: ChatMessage[],
  onText: (t: string) => void | Promise<void>,
  logMeta?: Record<string, unknown>,
): Promise<void> {
  const jc = makeJudgeClient();
  if (!jc) {
    await onText("(后端未配置 LLM 密钥,无法回答。)");
    return;
  }
  try {
    await streamChatText(jc, system, messages, onText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[defaultChat]", { ...logMeta, error: msg }); // ops can correlate by campaign (network/quota/model)
    await onText(`(出错: ${msg})`);
  }
}
