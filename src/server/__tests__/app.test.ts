import { describe, it, expect, beforeEach } from "vitest";
import app from "../app";
import { createTestDb, seedMemo } from "../../../tests/helpers";
import { setTestDb } from "../db";

// 実 app（マウント・onError・CORS）を app.request() で直接叩く。
// 個別ルートの実装は routes/__tests__ 側で測っているため、
// ここでは「マウント契約・エラー契約・CORS」のみを検証する。

let db: ReturnType<typeof createTestDb>["db"];

beforeEach(() => {
  const testDb = createTestDb();
  db = testDb.db;
  setTestDb(db);
});

describe("マウント契約", () => {
  it("GET /api/health は 200 で {ok:true} を返す", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /api/memos が memosRoute に到達する", async () => {
    seedMemo(db, { title: "Hello" });
    const res = await app.request("/api/memos");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
  });

  it("GET /api/labels が labelsRoute に到達する", async () => {
    const res = await app.request("/api/labels");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/import が importExportRoute に到達する", async () => {
    const res = await app.request("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "#+TITLE: T\n* hello" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("T");
  });

  it("GET /api/memos/:id/export が importExportRoute に到達する", async () => {
    const id = seedMemo(db, { title: "Export Me", body: "body" });
    const res = await app.request(`/api/memos/${id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toContain("#+TITLE: Export Me");
  });

  it("未知の /api/xxx は 404", async () => {
    const res = await app.request("/api/unknown-endpoint");
    expect(res.status).toBe(404);
  });
});

describe("onError 契約", () => {
  it("DB バインディング無しでの API 呼び出しは 500＋汎用メッセージを返し、詳細を漏洩しない", async () => {
    // testDb を解除し、env.DB も渡さない → getDb が throw する
    setTestDb(null as never);
    const res = await app.request("/api/memos");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ error: "Internal server error" }));
    // 内部エラーの詳細（getDb の例外メッセージ等）が漏れていないこと
    expect(body).not.toContain("D1 database binding");
  });
});

describe("CORS", () => {
  it("レスポンスに Access-Control-Allow-Origin が付与される", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
