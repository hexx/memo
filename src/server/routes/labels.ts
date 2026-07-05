import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { labels, memoLabels } from "../db/schema";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// GET /api/labels — ラベル一覧
route.get("/", async (c) => {
  const db = getDb({ DB: c.env.DB });
  const allLabels = await db.select().from(labels).all();
  return c.json(allLabels);
});

// POST /api/labels — ラベル作成
route.post("/", async (c) => {
  const db = getDb({ DB: c.env.DB });
  const { name } = await c.req.json<{ name: string }>();
  if (!name || !name.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  // 同名チェック
  const existing = await db
    .select()
    .from(labels)
    .where(eq(labels.name, name.trim()))
    .get();
  if (existing) return c.json({ error: "Label already exists" }, 409);

  const id = uuid();
  await db.insert(labels).values({ id, name: name.trim() });
  return c.json({ id, name: name.trim() }, 201);
});

// DELETE /api/labels/:id — ラベル削除
route.delete("/:id", async (c) => {
  const db = getDb({ DB: c.env.DB });
  const id = c.req.param("id");

  // 関連する memo_labels もカスケード削除（スキーマで定義済みだが明示的に）
  await db.delete(memoLabels).where(eq(memoLabels.labelId, id));
  const result = await db.delete(labels).where(eq(labels.id, id));
  if (result.changes === 0) return c.json({ error: "Not found" }, 404);

  return c.json({ ok: true });
});

export { route as labelsRoute };
