import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { parse, findAllByType, getTextContent } from "org-toolkit";
import { getDb } from "../db";
import { memos, labels, memoLabels } from "../db/schema";
import { isUniqueConstraintError } from "../lib/dbErrors";
import {
  defaultDiaryTitle,
  isFutureDate,
  isValidDateString,
} from "../../lib/diaryDate";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// #+DATE メタデータから暦日を取り出す。org のタイムスタンプ形式（<2026-09-24 Thu>）も許容。
// 暦日として解釈できない場合は null（通常メモとして取り込む）。
function extractCalendarDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^<?(\d{4}-\d{2}-\d{2})/);
  return m && isValidDateString(m[1]) ? m[1] : null;
}

// POST /api/import — orgテキストをインポート
route.post("/import", async (c) => {
  const db = getDb(c.env);
  const contentType = c.req.header("Content-Type") || "";

  let orgText: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (file instanceof File) {
      orgText = await file.text();
    } else {
      const textField = formData.get("text");
      orgText = typeof textField === "string" ? textField : "";
    }
  } else {
    const body = await c.req.json<{ text: string }>();
    orgText = body.text || "";
  }

  if (!orgText.trim()) {
    return c.json({ error: "No org text provided" }, 400);
  }

  // org-toolkit でパースしてメタデータ抽出
  const ast = parse(orgText);

  // 日記: #+DATE が暦日として解釈できれば日記として取り込む。
  // 同じ日付の日記が既にある場合は上書きせず 409 で拒否する。
  const entryDate = extractCalendarDate(ast.metadata["DATE"]);
  if (entryDate && isFutureDate(entryDate)) {
    return c.json({ error: "Date is in the future" }, 400);
  }
  if (entryDate) {
    const existing = await db
      .select({ id: memos.id })
      .from(memos)
      .where(eq(memos.entryDate, entryDate))
      .get();
    if (existing) {
      return c.json({ error: "Diary already exists for this date" }, 409);
    }
  }

  // タイトル: #+TITLE メタデータ → 先頭の見出し/段落のテキスト
  // → 日記は日付の既定タイトル、通常メモは "Untitled"
  // AST では見出しのタグ・TODO キーワードが構造的に分離されているため、
  // 自前のタグ除去は不要（getTextContent が本文のみを返す）
  let title = ast.metadata["TITLE"] || "";
  if (!title) {
    for (const child of ast.children) {
      if (child.type === "heading" || child.type === "paragraph") {
        title = getTextContent(child).split("\n")[0].trim();
        if (title) break;
      }
    }
  }
  if (!title) title = entryDate ? defaultDiaryTitle(entryDate) : "Untitled";

  // ラベル: 全見出しのタグを収集
  const tagSet = new Set(
    findAllByType(ast, "heading").flatMap((heading) => heading.tags),
  );

  // ラベルを find-or-create（競合回避のため onConflictDoNothing 使用）
  const labelIds: string[] = [];
  for (const tagName of tagSet) {
    // 既存ラベルを確認
    let label = await db
      .select()
      .from(labels)
      .where(eq(labels.name, tagName))
      .get();
    if (!label) {
      // なければ新規作成（競合時は何もしない）
      const id = uuid();
      await db.insert(labels).values({ id, name: tagName });
      // 競合していた場合に備えて再取得
      label = await db
        .select()
        .from(labels)
        .where(eq(labels.name, tagName))
        .get();
    }
    if (label) labelIds.push(label.id);
  }

  // メモ作成
  const now = new Date().toISOString();
  const memoId = uuid();
  try {
    await db.insert(memos).values({
      id: memoId,
      title,
      body: orgText,
      entryDate,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    // 事前チェックをすり抜けた同時インポートは UNIQUE 違反を 409 に変換する
    if (isUniqueConstraintError(err)) {
      return c.json({ error: "Diary already exists for this date" }, 409);
    }
    throw err;
  }

  // ラベル関連付け
  if (labelIds.length) {
    await db.insert(memoLabels).values(
      labelIds.map((labelId) => ({ memoId, labelId }))
    );
  }

  return c.json({ id: memoId, title, labelCount: labelIds.length, entryDate }, 201);
});

// GET /api/memos/:id/export — 単一メモを .org としてエクスポート
route.get("/memos/:id/export", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");

  const memo = await db.select().from(memos).where(eq(memos.id, id)).get();
  if (!memo) return c.json({ error: "Not found" }, 404);

  // ラベル取得
  const labelRows = await db
    .select({ name: labels.name })
    .from(memoLabels)
    .innerJoin(labels, eq(memoLabels.labelId, labels.id))
    .where(eq(memoLabels.memoId, id))
    .all();

  let exportText = memo.body;

  // #+TITLE: が本文中にあれば置換、なければ先頭に追加
  if (/^#\+TITLE:/m.test(exportText)) {
    exportText = exportText.replace(/^#\+TITLE:.*$/m, `#+TITLE: ${memo.title}`);
  } else {
    exportText = `#+TITLE: ${memo.title}\n${exportText}`;
  }

  // #+DATE:（日記のみ）本文中にあれば置換、なければ TITLE 行の次に追加
  if (memo.entryDate) {
    const dateLine = `#+DATE: ${memo.entryDate}`;
    if (/^#\+DATE:/m.test(exportText)) {
      exportText = exportText.replace(/^#\+DATE:.*$/m, dateLine);
    } else {
      const titleEnd = exportText.indexOf("\n");
      exportText =
        titleEnd === -1
          ? `${exportText}\n${dateLine}`
          : exportText.slice(0, titleEnd + 1) +
            dateLine +
            "\n" +
            exportText.slice(titleEnd + 1);
    }
  }

  // #+FILETAGS:
  if (labelRows.length > 0) {
    const tagLine = `#+FILETAGS: ${labelRows.map((l) => `:${l.name}`).join("")}`;
    if (/^#\+FILETAGS:/m.test(exportText)) {
      exportText = exportText.replace(
        /^#\+FILETAGS:.*$/m,
        tagLine
      );
    } else {
      // TITLE 行の次に挿入（本文が見出し 1 行だけの場合は末尾に追加）
      const titleEnd = exportText.indexOf("\n");
      exportText =
        titleEnd === -1
          ? `${exportText}\n${tagLine}`
          : exportText.slice(0, titleEnd + 1) +
            tagLine +
            "\n" +
            exportText.slice(titleEnd + 1);
    }
  }

  // 日記のファイル名はタイトルに依存せず日付（YYYY-MM-DD.org）にする
  const filenameBase = memo.entryDate ?? memo.title;
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${filenameBase}.org"; filename*=UTF-8''${encodeURIComponent(filenameBase)}.org`
  );
  return c.text(exportText);
});

export { route as importExportRoute };
