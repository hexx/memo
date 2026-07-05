import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { labels } from "../db/schema";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// GET /api/labels — ラベル一覧
route.get("/", async (c) => {
  const db = getDb(c.env);
  const allLabels = await db.select().from(labels).all();
  return c.json(allLabels);
});

// POST /api/labels — ラベル作成
route.post("/", async (c) => {
  const db = getDb(c.env);
  const { name } = await c.req.json<{ name: string }>();
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return c.json({ error: "Name is required" }, 400);
  }

  // 同名チェック
  const existing = await db
    .select()
    .from(labels)
    .where(eq(labels.name, trimmedName))
    .get();
  if (existing) return c.json({ error: "Label already exists" }, 409);

  const id = uuid();
  try {
    await db.insert(labels).values({ id, name: trimmedName });
  } catch {
    // 競合が発生した場合は409を返す
    return c.json({ error: "Label already exists" }, 409);
  }
  return c.json({ id, name: trimmedName }, 201);
});

// DELETE /api/labels/:id — ラベル削除
route.delete("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  // カスケード削除に任せる（スキーマで onDelete: "cascade" 定義済み）
  const result = await db.delete(labels).where(eq(labels.id, id));
  if (result.changes === 0) return c.json({ error: "Not found" }, 404);

  return c.json({ ok: true });
});

export { route as labelsRoute };
