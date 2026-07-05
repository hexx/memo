import { describe, it, expect, beforeEach } from "vitest";
import { memosRoute } from "../memos";
import { Hono } from "hono";
import { createTestDb, seedMemo, seedLabel, seedMemoLabel } from "../../../../tests/helpers";
import { setTestDb } from "../../db";

let db: ReturnType<typeof createTestDb>["db"];

function createApp() {
  const app = new Hono();
  app.route("/", memosRoute);
  return app;
}

async function req(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("memos", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    setTestDb(db);
  });

  // ── GET / ──────────────────────────────────────────────

  describe("GET /", () => {
    it("returns empty array when no memos exist", async () => {
      const res = await req(createApp(), "GET", "/");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("excludes archived memos by default", async () => {
      seedMemo(db, { title: "Visible" });
      seedMemo(db, { title: "Hidden", isArchived: 1 });
      seedMemo(db, { title: "Also Visible" });
      const res = await req(createApp(), "GET", "/");
      const data = await res.json();
      expect(data).toHaveLength(2);
    });

    it("includes archived when archived=1", async () => {
      seedMemo(db, { title: "Visible" });
      seedMemo(db, { title: "Hidden", isArchived: 1 });
      const res = await req(createApp(), "GET", "/?archived=1");
      expect(await res.json()).toHaveLength(2);
    });

    it("filters by title search", async () => {
      seedMemo(db, { title: "Shopping List", body: "milk" });
      seedMemo(db, { title: "Work Notes", body: "meeting" });
      const res = await req(createApp(), "GET", "/?q=meeting");
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe("Work Notes");
    });

    it("filters by label", async () => {
      const memoId1 = seedMemo(db, { title: "Memo A" });
      seedMemo(db, { title: "Memo B" });
      const labelId = seedLabel(db, { name: "work" });
      seedMemoLabel(db, memoId1, labelId);
      const res = await req(createApp(), "GET", `/?label=${labelId}`);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(memoId1);
    });

    it("sorts pinned memos first", async () => {
      seedMemo(db, { title: "Pinned", isPinned: 1 });
      seedMemo(db, { title: "Unpinned" });
      const res = await req(createApp(), "GET", "/");
      const data = await res.json();
      expect(data[0].title).toBe("Pinned");
    });

    it("attaches labels to each memo", async () => {
      const memoId = seedMemo(db, { title: "Labelled" });
      const labelId = seedLabel(db, { name: "important" });
      seedMemoLabel(db, memoId, labelId);
      const res = await req(createApp(), "GET", "/");
      const data = await res.json();
      expect(data[0].labels).toHaveLength(1);
      expect(data[0].labels[0].name).toBe("important");
    });
  });

  // ── GET /:id ──────────────────────────────────────────

  describe("GET /:id", () => {
    it("returns a memo with labels", async () => {
      const memoId = seedMemo(db, { title: "Detail", body: "Hello" });
      const labelId = seedLabel(db, { name: "urgent" });
      seedMemoLabel(db, memoId, labelId);
      const res = await req(createApp(), "GET", `/${memoId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.title).toBe("Detail");
      expect(data.labels[0].name).toBe("urgent");
    });

    it("returns 404 when not found", async () => {
      const res = await req(createApp(), "GET", "/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ── POST / ─────────────────────────────────────────────

  describe("POST /", () => {
    it("creates a memo and returns id", async () => {
      const res = await req(createApp(), "POST", "/", {
        title: "New Note",
        body: "Content",
      });
      expect(res.status).toBe(201);
      const { id } = await res.json();
      expect(id).toBeTruthy();
      // Verify persistence
      const getRes = await req(createApp(), "GET", `/${id}`);
      const memo = await getRes.json();
      expect(memo.title).toBe("New Note");
    });

    it("attaches labels if labelIds provided", async () => {
      const labelId = seedLabel(db, { name: "work" });
      const res = await req(createApp(), "POST", "/", {
        title: "Labelled",
        body: "Body",
        labelIds: [labelId],
      });
      const { id } = await res.json();
      const getRes = await req(createApp(), "GET", `/${id}`);
      const memo = await getRes.json();
      expect(memo.labels).toHaveLength(1);
    });

    it("rejects empty title with 400", async () => {
      const res = await req(createApp(), "POST", "/", {
        title: "",
        body: "Content",
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing body with 400", async () => {
      const res = await req(createApp(), "POST", "/", {
        title: "No Body",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── PUT /:id ───────────────────────────────────────────

  describe("PUT /:id", () => {
    it("updates title and body", async () => {
      const id = seedMemo(db, { title: "Old", body: "Old" });
      const res = await req(createApp(), "PUT", `/${id}`, {
        title: "New",
        body: "New",
      });
      expect(res.status).toBe(200);
      const getRes = await req(createApp(), "GET", `/${id}`);
      const memo = await getRes.json();
      expect(memo.title).toBe("New");
    });

    it("replaces labels when labelIds provided", async () => {
      const memoId = seedMemo(db, { title: "Switch", body: "B" });
      const labelA = seedLabel(db, { name: "a" });
      const labelB = seedLabel(db, { name: "b" });
      seedMemoLabel(db, memoId, labelA);
      await req(createApp(), "PUT", `/${memoId}`, {
        title: "Switch",
        body: "B",
        labelIds: [labelB],
      });
      const getRes = await req(createApp(), "GET", `/${memoId}`);
      const memo = await getRes.json();
      expect(memo.labels).toHaveLength(1);
      expect(memo.labels[0].name).toBe("b");
    });

    it("returns 404 when not found", async () => {
      const res = await req(createApp(), "PUT", "/nonexistent", {
        title: "T",
        body: "B",
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /:id ────────────────────────────────────────

  describe("DELETE /:id", () => {
    it("deletes a memo", async () => {
      const id = seedMemo(db);
      const res = await req(createApp(), "DELETE", `/${id}`);
      expect(res.status).toBe(200);
      const getRes = await req(createApp(), "GET", `/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 when not found", async () => {
      const res = await req(createApp(), "DELETE", "/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /:id/pin ─────────────────────────────────────

  describe("PATCH /:id/pin", () => {
    it("toggles pin status", async () => {
      const id = seedMemo(db, { isPinned: 0 });
      const app = createApp();

      const r1 = await req(app, "PATCH", `/${id}/pin`);
      expect(await r1.json()).toEqual({ isPinned: true });

      const r2 = await req(app, "PATCH", `/${id}/pin`);
      expect(await r2.json()).toEqual({ isPinned: false });
    });

    it("returns 404 when not found", async () => {
      const res = await req(createApp(), "PATCH", "/nonexistent/pin");
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /:id/archive ─────────────────────────────────

  describe("PATCH /:id/archive", () => {
    it("toggles archive status", async () => {
      const id = seedMemo(db);
      const app = createApp();
      expect((await req(app, "PATCH", `/${id}/archive`).then(r => r.json())).isArchived).toBe(true);
      expect((await req(app, "PATCH", `/${id}/archive`).then(r => r.json())).isArchived).toBe(false);
    });
  });
});
