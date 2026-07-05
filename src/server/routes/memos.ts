import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq, like, and, or, desc, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { memos, memoLabels, labels } from "../db/schema";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// GET /api/memos — メモ一覧（検索・ラベルフィルター・アーカイブ含む）
route.get("/", async (c) => {
  const db = getDb(c.env);
  const query = c.req.query("q") || "";
  const labelId = c.req.query("label");
  const includeArchived = c.req.query("archived") === "1";

  const conditions = [];
  if (!includeArchived) {
    conditions.push(eq(memos.isArchived, 0));
  }
  if (query) {
    conditions.push(
      or(like(memos.title, `%${query}%`), like(memos.body, `%${query}%`))
    );
  }

  let memoRows;
  if (labelId) {
    memoRows = await db
      .select({
        id: memos.id,
        title: memos.title,
        body: memos.body,
        isPinned: memos.isPinned,
        isArchived: memos.isArchived,
        createdAt: memos.createdAt,
        updatedAt: memos.updatedAt,
      })
      .from(memos)
      .innerJoin(memoLabels, eq(memos.id, memoLabels.memoId))
      .where(and(eq(memoLabels.labelId, labelId), ...conditions))
      .orderBy(desc(memos.isPinned), desc(memos.updatedAt))
      .all();
  } else {
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    memoRows = await db
      .select()
      .from(memos)
      .where(whereClause)
      .orderBy(desc(memos.isPinned), desc(memos.updatedAt))
      .all();
  }

  // 各メモのラベルを取得
  const memoIds = memoRows.map((m) => m.id);
  const allMemoLabels =
    memoIds.length > 0
      ? await db
          .select({
            memoId: memoLabels.memoId,
            labelId: labels.id,
            labelName: labels.name,
          })
          .from(memoLabels)
          .innerJoin(labels, eq(memoLabels.labelId, labels.id))
          .where(inArray(memoLabels.memoId, memoIds))
          .all()
      : [];

  const labelMap = new Map<string, { id: string; name: string }[]>();
  for (const ml of allMemoLabels) {
    if (!labelMap.has(ml.memoId)) labelMap.set(ml.memoId, []);
    labelMap.get(ml.memoId)?.push({ id: ml.labelId, name: ml.labelName });
  }

  const result = memoRows.map((m) => ({
    ...m,
    labels: labelMap.get(m.id) || [],
  }));

  return c.json(result);
});

// GET /api/memos/:id — メモ詳細
route.get("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  const memo = await db.select().from(memos).where(eq(memos.id, id)).get();
  if (!memo) return c.json({ error: "Not found" }, 404);

  const memoLabelRows = await db
    .select({
      id: labels.id,
      name: labels.name,
    })
    .from(memoLabels)
    .innerJoin(labels, eq(memoLabels.labelId, labels.id))
    .where(eq(memoLabels.memoId, id))
    .all();

  return c.json({ ...memo, labels: memoLabelRows });
});

// POST /api/memos — メモ作成
route.post("/", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json<{
    title: string;
    body: string;
    labelIds?: string[];
  }>();
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return c.json({ error: "Title is required" }, 400);
  }
  if (typeof body.body !== "string") {
    return c.json({ error: "Body is required" }, 400);
  }
  const now = new Date().toISOString();
  const id = uuid();

  await db.insert(memos).values({
    id,
    title: body.title.trim(),
    body: body.body,
    createdAt: now,
    updatedAt: now,
  });

  if (body.labelIds?.length) {
    const values = body.labelIds.map((labelId) => ({
      memoId: id,
      labelId,
    }));
    await db.insert(memoLabels).values(values);
  }

  return c.json({ id }, 201);
});

// PUT /api/memos/:id — メモ更新
route.put("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const body = await c.req.json<{
    title: string;
    body: string;
    labelIds?: string[];
  }>();
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return c.json({ error: "Title is required" }, 400);
  }
  if (typeof body.body !== "string") {
    return c.json({ error: "Body is required" }, 400);
  }

  const existing = await db
    .select()
    .from(memos)
    .where(eq(memos.id, id))
    .get();
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db
    .update(memos)
    .set({
      title: body.title.trim(),
      body: body.body,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memos.id, id));

  if (body.labelIds !== undefined) {
    await db.delete(memoLabels).where(eq(memoLabels.memoId, id));
    if (body.labelIds.length) {
      const values = body.labelIds.map((labelId) => ({
        memoId: id,
        labelId,
      }));
      await db.insert(memoLabels).values(values);
    }
  }

  return c.json({ ok: true });
});

// DELETE /api/memos/:id — メモ削除
route.delete("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  const result = await db.delete(memos).where(eq(memos.id, id));
  if (result.changes === 0) return c.json({ error: "Not found" }, 404);

  return c.json({ ok: true });
});

// PATCH /api/memos/:id/pin — ピン留めトグル
route.patch("/:id/pin", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  const memo = await db.select().from(memos).where(eq(memos.id, id)).get();
  if (!memo) return c.json({ error: "Not found" }, 404);

  await db
    .update(memos)
    .set({ isPinned: memo.isPinned ? 0 : 1, updatedAt: new Date().toISOString() })
    .where(eq(memos.id, id));

  return c.json({ isPinned: !memo.isPinned });
});

// PATCH /api/memos/:id/archive — アーカイブトグル
route.patch("/:id/archive", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  const memo = await db.select().from(memos).where(eq(memos.id, id)).get();
  if (!memo) return c.json({ error: "Not found" }, 404);

  await db
    .update(memos)
    .set({
      isArchived: memo.isArchived ? 0 : 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memos.id, id));

  return c.json({ isArchived: !memo.isArchived });
});

export { route as memosRoute };
