import { describe, it, expect, vi, afterEach } from "vitest";
import { generateTitle, type AIBindings } from "../generateTitle";

const ENV: AIBindings = {
  AI_API_KEY: "test-key",
  AI_BASE_URL: "https://example.com/v1",
  AI_MODEL: "test-model",
};

type ChatRequestBody = {
  model?: string;
  messages?: { role: string; content: string }[];
  [key: string]: unknown;
};

// pi-ai（内部の openai SDK）は常にストリーミングで要求するため、
// 成功応答は SSE（text/event-stream）で返す必要がある。
function sseResponse(content: string, model = "test-model"): Response {
  const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model };
  const delta = {
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  };
  const stop = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  const body = `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(stop)}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function mockFetchOnce(result: Response | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// リクエストボディをキャプチャしつつ成功応答を返す fetch スタブ。
function mockFetchCapture(captured: { body?: ChatRequestBody; url?: string; headers?: Headers }) {
  const fn = vi.fn(async (url: string, opts: RequestInit) => {
    captured.url = url;
    captured.headers = new Headers(opts.headers as HeadersInit);
    captured.body = JSON.parse(opts.body as string) as ChatRequestBody;
    return sseResponse("テストタイトル");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generateTitle", () => {
  it("returns null when API key is missing", async () => {
    const res = await generateTitle("本文です", {
      ...ENV,
      AI_API_KEY: "",
    });
    expect(res).toBeNull();
  });

  it("returns null when baseUrl is missing", async () => {
    const res = await generateTitle("本文です", {
      ...ENV,
      AI_BASE_URL: undefined,
    });
    expect(res).toBeNull();
  });

  it("uses the default model when AI_MODEL is unset", async () => {
    const captured: { body?: ChatRequestBody } = {};
    mockFetchCapture(captured);
    const res = await generateTitle("本文です", {
      ...ENV,
      AI_MODEL: undefined,
    });
    expect(res).toBe("テストタイトル");
    expect(captured.body?.model).toBe("deepseek-v4-flash");
  });

  it("returns null when body is empty", async () => {
    const res = await generateTitle("   ", ENV);
    expect(res).toBeNull();
  });

  it("returns the generated title and strips surrounding quotes", async () => {
    mockFetchOnce(sseResponse('"買い物リストの下書き"'));
    const res = await generateTitle("牛乳を買う\n卵を買う", ENV);
    expect(res).toBe("買い物リストの下書き");
  });

  it("returns null when the model returns empty content", async () => {
    mockFetchOnce(sseResponse(""));
    const res = await generateTitle("本文", ENV);
    expect(res).toBeNull();
  });

  it("returns null when the response is an auth error (401)", async () => {
    mockFetchOnce(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const res = await generateTitle("本文", ENV);
    expect(res).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetchOnce(new Error("network down"));
    const res = await generateTitle("本文", ENV);
    expect(res).toBeNull();
  });

  it("returns null when the request times out (AbortError)", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockFetchOnce(abort);
    const res = await generateTitle("本文", ENV);
    expect(res).toBeNull();
  });

  it("calls <BASE_URL>/chat/completions with bearer auth and model", async () => {
    const captured: { body?: ChatRequestBody; url?: string; headers?: Headers } = {};
    const fn = mockFetchCapture(captured);
    await generateTitle("本文", ENV);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captured.url).toContain("/chat/completions");
    expect(captured.url?.startsWith("https://example.com/v1")).toBe(true);
    expect(captured.headers?.get("authorization")).toBe("Bearer test-key");
    expect(captured.body?.model).toBe("test-model");
    expect(captured.body?.messages).toHaveLength(2);
  });

  it("sends the system prompt as a system role message (not developer)", async () => {
    const captured: { body?: ChatRequestBody } = {};
    mockFetchCapture(captured);
    await generateTitle("本文", ENV);
    const messages = captured.body?.messages ?? [];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("/no_think");
    expect(messages.some((m) => m.role === "developer")).toBe(false);
  });

  it("does not send the store field for opencode.ai endpoints (compat auto-detection)", async () => {
    const captured: { body?: ChatRequestBody } = {};
    mockFetchCapture(captured);
    const res = await generateTitle("本文です", {
      AI_API_KEY: "test-key",
      AI_BASE_URL: "https://opencode.ai/zen/go/v1",
      AI_MODEL: "deepseek-v4-flash",
    });
    expect(res).toBe("テストタイトル");
    expect(captured.body).toBeDefined();
    // DeepSeek は store フィールドを拒否する。opencode.ai 経路では自動検出で送出されないこと。
    expect(captured.body).not.toHaveProperty("store");
  });
});
