import { describe, it, expect, vi, afterEach } from "vitest";
import { generateTitle, type OpenCodeGoBindings } from "../generateTitle";

const ENV: OpenCodeGoBindings = {
  OPENCODE_GO_API_KEY: "test-key",
  OPENCODE_GO_BASE_URL: "https://example.com/v1",
  OPENCODE_GO_MODEL: "test-model",
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
  ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generateTitle", () => {
  it("returns null when API key is missing", async () => {
    const res = await generateTitle("本文です", {
      ...ENV,
      OPENCODE_GO_API_KEY: "",
    });
    expect(res).toBeNull();
  });

  it("returns null when baseUrl is missing", async () => {
    const res = await generateTitle("本文です", {
      ...ENV,
      OPENCODE_GO_BASE_URL: undefined,
    });
    expect(res).toBeNull();
  });

  it("returns null when model is missing", async () => {
    const res = await generateTitle("本文です", {
      ...ENV,
      OPENCODE_GO_MODEL: undefined,
    });
    expect(res).toBeNull();
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
    mockFetchOnce({ ok: false, json: async () => ({}) } as Response);
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
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(opts.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
  });
});
