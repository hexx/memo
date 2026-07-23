import { describe, it, expect, vi, afterEach } from "vitest";
import { generateTitle, type AIBindings } from "../generateTitle";

const ENV: AIBindings = {
  AI_API_KEY: "test-key",
  AI_BASE_URL: "https://example.com/v1",
  AI_MODEL: "test-model",
};

function mockFetchOnce(result: Partial<Response> | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const okResponse = (content: string): Response =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

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
    const fn = mockFetchOnce(okResponse("テストタイトル"));
    const res = await generateTitle("本文です", {
      ...ENV,
      AI_MODEL: undefined,
    });
    expect(res).toBe("テストタイトル");
    const calls = fn.mock.calls as unknown as [string, RequestInit][];
    const [, opts] = calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("returns null when body is empty", async () => {
    const res = await generateTitle("   ", ENV);
    expect(res).toBeNull();
  });

  it("returns the generated title and strips surrounding quotes", async () => {
    mockFetchOnce(okResponse('"買い物リストの下書き"'));
    const res = await generateTitle("牛乳を買う\n卵を買う", ENV);
    expect(res).toBe("買い物リストの下書き");
  });

  it("returns null when the response is not ok", async () => {
    mockFetchOnce(new Response("error", { status: 400 }));
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
    const fn = mockFetchOnce(okResponse("テストタイトル"));
    await generateTitle("本文", ENV);
    expect(fn).toHaveBeenCalledTimes(1);
    const calls = fn.mock.calls as unknown as [string, RequestInit][];
    const [url, opts] = calls[0];
    expect(url).toContain("/chat/completions");
    expect(url.startsWith("https://example.com/v1")).toBe(true);
    const headers = new Headers(opts.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
  });
});
