import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { memosRoute } from "../memos";
import { Hono } from "hono";
import { createTestDb, seedMemo } from "../../../../tests/helpers";
import { setTestDb } from "../../db";

const ENV = {
  OPENCODE_GO_API_KEY: "test-key",
  OPENCODE_GO_BASE_URL: "https://example.com/v1",
  OPENCODE_GO_MODEL: "test-model",
};

let db: ReturnType<typeof createTestDb>["db"];

function createApp() {
  const app = new Hono();
  app.route("/", memosRoute);
  return app;
}

function mockFetchOnce(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }) as Response)
  );
}

async function req(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
  env?: unknown
) {
  return app.request(
    path,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
    env as any
  );
}

describe("memos auto-title", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    setTestDb(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST / with empty title uses the AI-generated title", async () => {
    mockFetchOnce("AI生成タイトル");
    const res = await req(
      createApp(),
      "POST",
      "/",
      { title: "", body: "本文です" },
      ENV
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const getRes = await req(createApp(), "GET", `/${id}`, undefined, ENV);
    const memo = await getRes.json();
    expect(memo.title).toBe("AI生成タイトル");
  });

  it("POST / with empty title falls back to 400 when AI is unavailable", async () => {
    // 環境変数なし → generateTitle が null を返し、手動入力フローへフォールバック
    const res = await req(createApp(), "POST", "/", {
      title: "",
      body: "本文です",
    });
    expect(res.status).toBe(400);
  });

  it("POST /generate-title returns the generated title", async () => {
    mockFetchOnce("生成されたタイトル");
    const res = await req(
      createApp(),
      "POST",
      "/generate-title",
      { body: "本文" },
      ENV
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("生成されたタイトル");
  });

  it("POST /generate-title returns { title: null } when AI is unavailable", async () => {
    const res = await req(createApp(), "POST", "/generate-title", {
      body: "本文",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeNull();
  });

  it("PUT /:id without title keeps the existing title (no AI call)", async () => {
    const id = seedMemo(db, { title: "Original Title", body: "old" });
    const res = await req(createApp(), "PUT", `/${id}`, { body: "updated body" });
    expect(res.status).toBe(200);
    const getRes = await req(createApp(), "GET", `/${id}`);
    const memo = await getRes.json();
    expect(memo.title).toBe("Original Title");
    expect(memo.body).toBe("updated body");
  });
});
