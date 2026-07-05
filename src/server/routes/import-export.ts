import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { parse, walk, type Heading } from "org-toolkit";
import { getDb } from "../db";
import { memos, labels, memoLabels } from "../db/schema";

type Bindings = { DB: D1Database };

const route = new Hono<{ Bindings: Bindings }>();

// POST /api/import — orgテキストをインポート
route.post("/import", async (c) => {
  const db = getDb({ DB: c.env.DB });
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

  // タイトル: TITLE メタデータ or 1行目
  let title = ast.metadata["TITLE"] || "";
  if (!title) {
    const lines = orgText.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#+") && !trimmed.startsWith("*")) {
        title = trimmed;
        break;
      }
      if (trimmed.startsWith("* ")) {
        title = trimmed.slice(2).trim();
        // 見出しのタグを除去
        const tagIdx = title.indexOf(" :");
        if (tagIdx !== -1) title = title.slice(0, tagIdx);
        break;
      }
    }
  }
  if (!title) title = "Untitled";

  // ラベル: 全見出しのタグを収集
  const tagSet = new Set<string>();
  walk(ast, {
    heading(node: Heading) {
      for (const tag of node.tags) {
        tagSet.add(tag);
      }
    },
  });

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
  await db.insert(memos).values({
    id: memoId,
    title,
    body: orgText,
    createdAt: now,
    updatedAt: now,
  });

  // ラベル関連付け
  if (labelIds.length) {
    await db.insert(memoLabels).values(
      labelIds.map((labelId) => ({ memoId, labelId }))
    );
  }

  return c.json({ id: memoId, title, labelCount: labelIds.length }, 201);
});

// GET /api/memos/:id/export — 単一メモを .org としてエクスポート
route.get("/memos/:id/export", async (c) => {
  const db = getDb({ DB: c.env.DB });
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

  // #+FILETAGS:
  if (labelRows.length > 0) {
    const tagLine = `#+FILETAGS: ${labelRows.map((l) => `:${l.name}`).join("")}`;
    if (/^#\+FILETAGS:/m.test(exportText)) {
      exportText = exportText.replace(
        /^#\+FILETAGS:.*$/m,
        tagLine
      );
    } else {
      // TITLE 行の次に挿入
      const titleEnd = exportText.indexOf("\n");
      exportText =
        exportText.slice(0, titleEnd + 1) +
        tagLine +
        "\n" +
        exportText.slice(titleEnd + 1);
    }
  }

  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${memo.title}.org"; filename*=UTF-8''${encodeURIComponent(memo.title)}.org`
  );
  return c.text(exportText);
});

export { route as importExportRoute };
