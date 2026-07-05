import { describe, it, expect, beforeEach } from "vitest";
import { importExportRoute } from "../import-export";
import { Hono } from "hono";
import { createTestDb, seedMemo, seedLabel, seedMemoLabel } from "../../../../tests/helpers";
import { setTestDb } from "../../db";

let db: ReturnType<typeof createTestDb>["db"];

function createApp() {
  const app = new Hono();
  app.route("/", importExportRoute);
  return app;
}

async function req(app: Hono, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method,
    headers: { ...headers, ...(body && !headers ? { "Content-Type": "application/json" } : {}) },
    body: body && !headers ? JSON.stringify(body) : body as BodyInit | undefined,
  });
}

describe("import-export", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    setTestDb(db);
  });

  // ── POST /import ───────────────────────────────────────

  describe("POST /import (JSON text)", () => {
    it("imports org text and creates a memo", async () => {
      const res = await req(createApp(), "POST", "/import", {
        text: "#+TITLE: My Note\n\n* TODO Task :work:",
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.title).toBe("My Note");
      expect(data.labelCount).toBe(1);
      expect(data.id).toBeTruthy();
    });

    it("extracts title from first heading when no #+TITLE:", async () => {
      const res = await req(createApp(), "POST", "/import", {
        text: "* Important todo :urgent:",
      });
      const data = await res.json();
      expect(data.title).toBe("Important todo");
      expect(data.labelCount).toBe(1);
    });

    it("falls back to first non-metadata line as title", async () => {
      const res = await req(createApp(), "POST", "/import", {
        text: "#+AUTHOR: test\n\nJust some text",
      });
      const data = await res.json();
      // First non-metadata, non-heading line becomes title
      expect(data.title).toBe("Just some text");
    });

    it("collects tags from all headings as labels", async () => {
      const res = await req(createApp(), "POST", "/import", {
        text: "* One :tag1:\n* Two :tag2:tag3:",
      });
      const data = await res.json();
      expect(data.labelCount).toBe(3);
    });

    it("preserves raw org text as body", async () => {
      const orgText = "* TODO Task :work:\n  - [ ] item 1\n  - [ ] item 2";
      const res = await req(createApp(), "POST", "/import", { text: orgText });
      const { id } = await res.json();

      // Use a different app with memos route to fetch
      const { memosRoute } = await import("../memos");
      const app2 = new Hono();
      app2.route("/", memosRoute);
      const getRes = await app2.request(`/${id}`);
      const memo = await getRes.json();
      expect(memo.body).toBe(orgText);
    });

    it("reuses existing labels", async () => {
      seedLabel(db, { name: "existing" });

      const res = await req(createApp(), "POST", "/import", {
        text: "* TODO Task :existing:newtag:",
      });
      const data = await res.json();
      // Both tags found: existing reused, newtag created
      expect(data.labelCount).toBe(2);
    });

    it("rejects empty text with 400", async () => {
      const res = await req(createApp(), "POST", "/import", { text: "" });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /memos/:id/export ─────────────────────────────

  describe("GET /memos/:id/export", () => {
    it("exports a memo as .org text", async () => {
      const memoId = seedMemo(db, {
        title: "Export Test",
        body: "* First heading\nContent here",
      });

      const res = await req(createApp(), "GET", `/memos/${memoId}/export`);
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain("#+TITLE: Export Test");
      expect(text).toContain("* First heading");
    });

    it("includes #+FILETAGS: when memo has labels", async () => {
      const memoId = seedMemo(db, { title: "Tagged", body: "* Foo" });
      const labelId = seedLabel(db, { name: "important" });
      seedMemoLabel(db, memoId, labelId);

      const res = await req(createApp(), "GET", `/memos/${memoId}/export`);
      const text = await res.text();
      expect(text).toContain("#+FILETAGS: :important");
    });

    it("replaces existing #+TITLE: in body", async () => {
      const memoId = seedMemo(db, {
        title: "New Title",
        body: "#+TITLE: Old Title\n* Content",
      });

      const res = await req(createApp(), "GET", `/memos/${memoId}/export`);
      const text = await res.text();
      expect(text).toContain("#+TITLE: New Title");
      expect(text).not.toContain("Old Title");
    });

    it("returns 404 when memo not found", async () => {
      const res = await req(createApp(), "GET", "/memos/nonexistent/export");
      expect(res.status).toBe(404);
    });

    it("sets Content-Disposition header with filename", async () => {
      const memoId = seedMemo(db, { title: "MyFile", body: "* ok" });
      const res = await req(createApp(), "GET", `/memos/${memoId}/export`);
      const disposition = res.headers.get("Content-Disposition");
      expect(disposition).toContain("filename=");
      expect(disposition).toContain("MyFile.org");
    });
  });
});
