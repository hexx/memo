import { describe, it, expect, beforeEach } from "vitest";
import { labelsRoute } from "../labels";
import { Hono } from "hono";
import { createTestDb, seedLabel, seedMemo, seedMemoLabel } from "../../../../tests/helpers";
import { setTestDb } from "../../db";

let db: ReturnType<typeof createTestDb>["db"];

function createApp() {
  const app = new Hono();
  app.route("/", labelsRoute);
  return app;
}

async function req(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("labels", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    setTestDb(db);
  });

  // ── GET / ──────────────────────────────────────────────

  describe("GET /", () => {
    it("returns empty array when no labels exist", async () => {
      const res = await req(createApp(), "GET", "/");
      expect(await res.json()).toEqual([]);
    });

    it("returns all labels", async () => {
      seedLabel(db, { name: "work" });
      seedLabel(db, { name: "personal" });
      const res = await req(createApp(), "GET", "/");
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.map((l: { name: string }) => l.name).sort()).toEqual(["personal", "work"]);
    });
  });

  // ── POST / ─────────────────────────────────────────────

  describe("POST /", () => {
    it("creates a label and returns it", async () => {
      const res = await req(createApp(), "POST", "/", { name: "urgent" });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe("urgent");
      expect(data.id).toBeTruthy();
    });

    it("trims whitespace from name", async () => {
      const res = await req(createApp(), "POST", "/", { name: "  spaced  " });
      const data = await res.json();
      expect(data.name).toBe("spaced");
    });

    it("rejects empty name with 400", async () => {
      const res = await req(createApp(), "POST", "/", { name: "" });
      expect(res.status).toBe(400);
    });

    it("rejects whitespace-only name with 400", async () => {
      const res = await req(createApp(), "POST", "/", { name: "   " });
      expect(res.status).toBe(400);
    });

    it("rejects duplicate name with 409", async () => {
      seedLabel(db, { name: "work" });
      const res = await req(createApp(), "POST", "/", { name: "work" });
      expect(res.status).toBe(409);
    });
  });

  // ── DELETE /:id ────────────────────────────────────────

  describe("DELETE /:id", () => {
    it("deletes a label", async () => {
      const id = seedLabel(db, { name: "old" });
      const res = await req(createApp(), "DELETE", `/${id}`);
      expect(res.status).toBe(200);
      // Verify gone
      const getRes = await req(createApp(), "GET", "/");
      const data = await getRes.json();
      expect(data).toHaveLength(0);
    });

    it("cascades to memo_labels but not memos", async () => {
      const labelId = seedLabel(db, { name: "important" });
      const memoId = seedMemo(db, { title: "Keep me" });
      seedMemoLabel(db, memoId, labelId);

      await req(createApp(), "DELETE", `/${labelId}`);

      // Memo still exists
      const app2 = createApp();
      const { memosRoute } = await import("../memos");
      app2.route("/", memosRoute);
      const getRes = await app2.request(`/${memoId}`);
      expect(getRes.status).toBe(200);
    });

    it("returns 404 when not found", async () => {
      const res = await req(createApp(), "DELETE", "/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
