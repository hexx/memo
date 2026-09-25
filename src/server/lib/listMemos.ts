import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import { getDb } from "../db";
import { labels, memoLabels, memos } from "../db/schema";

type Db = ReturnType<typeof getDb>;

export interface ListMemosOptions {
  q?: string;
  labelId?: string;
  includeArchived?: boolean;
  /** "only": 日記のみ / "exclude": 日記以外 / 未指定: すべて */
  diary?: "only" | "exclude";
  /** 日記の日付で絞り込む（YYYY-MM-DD） */
  entryDate?: string;
}

export interface MemoListItem {
  id: string;
  title: string;
  body: string;
  entryDate: string | null;
  isPinned: number;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
  labels: { id: string; name: string }[];
}

type MemoRow = Omit<MemoListItem, "labels">;

const memoColumns = {
  id: memos.id,
  title: memos.title,
  body: memos.body,
  entryDate: memos.entryDate,
  isPinned: memos.isPinned,
  isArchived: memos.isArchived,
  createdAt: memos.createdAt,
  updatedAt: memos.updatedAt,
};

// メモ一覧の共通クエリ。memos（ホーム / アーカイブ）と diaries（日記ビュー）で共有する。
export async function listMemos(
  db: Db,
  options: ListMemosOptions = {}
): Promise<MemoListItem[]> {
  const conditions: SQL[] = [];
  if (!options.includeArchived) conditions.push(eq(memos.isArchived, 0));
  if (options.diary === "only") conditions.push(isNotNull(memos.entryDate));
  if (options.diary === "exclude") conditions.push(isNull(memos.entryDate));
  if (options.entryDate) {
    conditions.push(eq(memos.entryDate, options.entryDate));
  }
  if (options.q) {
    const search = or(
      like(memos.title, `%${options.q}%`),
      like(memos.body, `%${options.q}%`)
    );
    if (search) conditions.push(search);
  }

  // 日記は日付降順（ピン留めを扱わない）。通常メモはピン留め優先＋更新降順。
  const orderBy =
    options.diary === "only"
      ? [desc(memos.entryDate), desc(memos.updatedAt)]
      : [desc(memos.isPinned), desc(memos.updatedAt)];

  let memoRows: MemoRow[];
  if (options.labelId) {
    memoRows = await db
      .select(memoColumns)
      .from(memos)
      .innerJoin(memoLabels, eq(memos.id, memoLabels.memoId))
      .where(and(eq(memoLabels.labelId, options.labelId), ...conditions))
      .orderBy(...orderBy)
      .all();
  } else {
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    memoRows = await db
      .select(memoColumns)
      .from(memos)
      .where(whereClause)
      .orderBy(...orderBy)
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

  return memoRows.map((m) => ({
    ...m,
    labels: labelMap.get(m.id) || [],
  }));
}