import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// テスト用ヘルパー（tests/helpers.ts）はマイグレーション適用後のスキーマを直接作るため、
// 実際のマイグレーション SQL が既存 DB に対して正しく適用されることは検証されない。
// ここでは 0000 のスキーマから開始して 0001 を適用し、既存データの保持と
// entry_date の一意性（1 日 1 件）を確認する。
function applyMigration(sqlite: Database.Database, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  sqlite.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

describe("migrations", () => {
  it("0001 は既存メモを保持し、entry_date に 1 日 1 件の UNIQUE を追加する", () => {
    const sqlite = new Database(":memory:");
    applyMigration(sqlite, "0000_mixed_quicksilver.sql");
    sqlite
      .prepare(
        "INSERT INTO memos (id, title, body, is_pinned, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)"
      )
      .run("m1", "Existing", "body", "t", "t");

    applyMigration(sqlite, "0001_brief_mongoose.sql");

    // 既存行は保持され、entry_date は NULL
    const row = sqlite
      .prepare("SELECT entry_date FROM memos WHERE id = ?")
      .get("m1") as { entry_date: string | null };
    expect(row.entry_date).toBeNull();

    const insert = sqlite.prepare(
      "INSERT INTO memos (id, title, body, entry_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // NULL は複数許容（通常メモに影響しない）
    expect(() => insert.run("m2", "A", "b", null, "t", "t")).not.toThrow();
    // 非 NULL の重複は拒否
    insert.run("m3", "B", "b", "2020-01-05", "t", "t");
    expect(() => insert.run("m4", "C", "b", "2020-01-05", "t", "t")).toThrow(
      /UNIQUE/
    );
  });
});