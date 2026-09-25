import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { labels, memoLabels, memos } from "../db/schema";
import { listMemos } from "../lib/listMemos";
import { isUniqueConstraintError } from "../lib/dbErrors";
import {
  defaultDiaryTitle,
  isFutureDate,
  isValidDateString,
  todayInTokyo,
} from "../../lib/diaryDate";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// GET /api/diaries — 日記一覧（検索・ラベルフィルター・日付絞り込み）
route.get("/", async (c) => {
  const db = getDb(c.env);
  const result = await listMemos(db, {
    q: c.req.query("q") || undefined,
    labelId: c.req.query("label") || undefined,
    includeArchived: c.req.query("archived") === "1",
    diary: "only",
    entryDate: c.req.query("date") || undefined,
  });
  return c.json(result);
});

// POST /api/diaries — 日記作成
// entryDate 省略時はサーバーが Asia/Tokyo の今日を割り当てる（ADR 0010）。
// タイトル省略時は日付の既定タイトルを使う（日記では AI 自動生成を行わない）。
route.post("/", async (c) => {
  const db = getDb(c.env);

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

  const entryDate =
    (typeof body.entryDate === "string" ? body.entryDate.trim() : "") ||
    todayInTokyo();
  if (!isValidDateString(entryDate)) {
    return c.json({ error: "Invalid date" }, 400);
  }
  if (isFutureDate(entryDate)) {
    return c.json({ error: "Date is in the future" }, 400);
  }

  const existing = await db
    .select({ id: memos.id })
    .from(memos)
    .where(eq(memos.entryDate, entryDate))
    .get();
  if (existing) {
    return c.json({ error: "Diary already exists for this date" }, 409);
  }

  const title =
    (typeof body.title === "string" ? body.title.trim() : "") ||
    defaultDiaryTitle(entryDate);
  const now = new Date().toISOString();
  const id = uuid();

  // メモ行を先に作ってからラベル紐付けで失敗すると、日付を占有した
  // 空の日記が残ってしまう。先にラベルの存在を検証する。
  const uniqueLabelIds = body.labelIds ? [...new Set(body.labelIds)] : [];
  if (uniqueLabelIds.length > 0) {
    const knownLabels = await db
      .select({ id: labels.id })
      .from(labels)
      .where(inArray(labels.id, uniqueLabelIds))
      .all();
    if (knownLabels.length !== uniqueLabelIds.length) {
      return c.json({ error: "Unknown label" }, 400);
    }
  }

  try {
    await db.insert(memos).values({
      id,
      title,
      body: body.body,
      entryDate,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return c.json({ error: "Diary already exists for this date" }, 409);
    }
    throw err;
  }

  if (body.labelIds?.length) {
    try {
      await db.insert(memoLabels).values(
        body.labelIds.map((labelId) => ({ memoId: id, labelId }))
      );
    } catch (err) {
      // 検証後の同時削除などで失敗した場合は、日付を占有した日記を残さない
      await db.delete(memos).where(eq(memos.id, id));
      throw err;
    }
  }

  return c.json({ id, entryDate, title }, 201);
});

export { route as diariesRoute };