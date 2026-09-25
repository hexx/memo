import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { generateTitle, type AIBindings } from "../lib/generateTitle";
import { listMemos } from "../lib/listMemos";
import { isUniqueConstraintError } from "../lib/dbErrors";
import { memos, memoLabels, labels } from "../db/schema";
import {
  defaultDiaryTitle,
  isFutureDate,
  isValidDateString,
} from "../../lib/diaryDate";

type Bindings = { DB: D1Database } & AIBindings;

const route = new Hono<{ Bindings: Bindings }>();

// /generate-title で受け付ける本文の最大文字数（それ以上は 413 で弾く）
const MAX_GENERATE_BODY_INPUT = 20000;

// タイトル解決: 指定があればそれを優先し、空の場合は本文から AI 生成を試みる。
// AI 生成も不可の場合は空文字を返し、呼び出し側で 400（Title is required）にする。
async function resolveTitle(
  providedTitle: unknown,
  memoBody: string,
  env: Bindings | undefined
): Promise<string> {
  const t = typeof providedTitle === "string" ? providedTitle.trim() : "";
  if (t) return t;
  const generated = await generateTitle(memoBody, env ?? {});
  return generated ?? "";
}

// POST /api/memos/generate-title — 本文からタイトルを AI 生成（プレビュー用）
route.post("/generate-title", async (c) => {
  let body: { body?: string };
  try {
    body = await c.req.json<{ body?: string }>();
  } catch {
    body = {};
  }
  const memoBody = typeof body.body === "string" ? body.body : "";
  // 過大なボディは LLM クレジットの枯渇・ワーカー資源の浪費を防ぐために弾く
  // （generateTitle 側でも 2000 字に切り詰めるが、入力段階で上限を設ける）
  if (memoBody.length > MAX_GENERATE_BODY_INPUT) {
    return c.json({ error: "Body too large" }, 413);
  }
  const title = await generateTitle(memoBody, c.env ?? {});
  return c.json({ title });
});

// GET /api/memos — メモ一覧（検索・ラベルフィルター・アーカイブ・日記の絞り込み）
// diary=0 で日記以外、diary=1 で日記のみ（ホームは diary=0、日記ビューは /api/diaries を使う）
route.get("/", async (c) => {
  const db = getDb(c.env);
  const diaryParam = c.req.query("diary");
  let diary: "only" | "exclude" | undefined;
  if (diaryParam === "1") diary = "only";
  else if (diaryParam === "0") diary = "exclude";

  const result = await listMemos(db, {
    q: c.req.query("q") || undefined,
    labelId: c.req.query("label") || undefined,
    includeArchived: c.req.query("archived") === "1",
    diary,
  });
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

// POST /api/memos — メモ作成（日記は POST /api/diaries を使う）
route.post("/", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json<{
    title?: string;
    body?: string;
    labelIds?: string[];
  }>();
  if (typeof body.body !== "string") {
    return c.json({ error: "Body is required" }, 400);
  }
  const title = await resolveTitle(body.title, body.body, c.env);
  if (!title) {
    return c.json({ error: "Title is required" }, 400);
  }
  const now = new Date().toISOString();
  const id = uuid();

  await db.insert(memos).values({
    id,
    title,
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
// 日記のときは entryDate で日付を変更できる（1 日 1 件のため重複は 409）。
// 日記以外に entryDate を指定すること（メモ→日記の変換）は受け付けない。
route.put("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  let body: {
    title?: string;
    body?: string;
    labelIds?: string[];
    entryDate?: string;
  };
  try {
    const parsed: unknown = await c.req.json();
    body = parsed && typeof parsed === "object" ? (parsed as typeof body) : {};
  } catch {
    body = {};
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

  // 日付の解決（日記のみ）
  let entryDate = existing.entryDate;
  if (body.entryDate !== undefined) {
    if (existing.entryDate === null) {
      return c.json({ error: "Not a diary" }, 400);
    }
    if (
      typeof body.entryDate !== "string" ||
      !isValidDateString(body.entryDate)
    ) {
      return c.json({ error: "Invalid date" }, 400);
    }
    if (isFutureDate(body.entryDate)) {
      return c.json({ error: "Date is in the future" }, 400);
    }
    if (body.entryDate !== existing.entryDate) {
      const duplicate = await db
        .select({ id: memos.id })
        .from(memos)
        .where(eq(memos.entryDate, body.entryDate))
        .get();
      if (duplicate && duplicate.id !== id) {
        return c.json({ error: "Diary already exists for this date" }, 409);
      }
    }
    entryDate = body.entryDate;
  }

  // タイトル解決。日記は AI 自動生成を使わず、日付の既定タイトルにフォールバックする。
  // 日付変更時、タイトルが旧既定値のまま（未編集）なら新日付へ追従させる。
  let title: string;
  if (existing.entryDate !== null) {
    const currentDate = existing.entryDate;
    const nextDate = entryDate ?? currentDate;
    if (body.title !== undefined) {
      const provided = typeof body.title === "string" ? body.title.trim() : "";
      title = provided || defaultDiaryTitle(nextDate);
    } else if (
      nextDate !== currentDate &&
      existing.title === defaultDiaryTitle(currentDate)
    ) {
      title = defaultDiaryTitle(nextDate);
    } else {
      title = existing.title;
    }
  } else {
    // title が省略された場合は既存タイトルを維持する（毎回の更新で AI 生成・
    // 意図せぬタイトル変更を防ぐ）。明示的に指定された場合のみ AI 生成を試みる。
    title =
      body.title !== undefined
        ? await resolveTitle(body.title, body.body, c.env)
        : existing.title;
    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }
  }

  try {
    await db
      .update(memos)
      .set({
        title,
        body: body.body,
        entryDate,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(memos.id, id));
  } catch (err) {
    // 事前チェックをすり抜けた同時更新は UNIQUE 違反を 409 に変換する
    if (isUniqueConstraintError(err)) {
      return c.json({ error: "Diary already exists for this date" }, 409);
    }
    throw err;
  }

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