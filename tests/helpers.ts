import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";

// In-memory SQLite database for testing
export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  // Create tables (run DDL manually)
  sqlite.exec(`
    CREATE TABLE memos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE memo_labels (
      memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (memo_id, label_id)
    );
  `);

  return { sqlite, db };
}

// Seed helpers
export function seedMemo(
  db: ReturnType<typeof drizzle>,
  overrides: Partial<{
    id: string;
    title: string;
    body: string;
    isPinned: number;
    isArchived: number;
  }> = {}
) {
  const id = overrides.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.memos).values({
    id,
    title: overrides.title ?? "Test Memo",
    body: overrides.body ?? "Body content",
    isPinned: overrides.isPinned ?? 0,
    isArchived: overrides.isArchived ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

export function seedLabel(
  db: ReturnType<typeof drizzle>,
  overrides: Partial<{ id: string; name: string }> = {}
) {
  const id = overrides.id || crypto.randomUUID();
  db.insert(schema.labels).values({
    id,
    name: overrides.name ?? "test-label",
  }).run();
  return id;
}

export function seedMemoLabel(
  db: ReturnType<typeof drizzle>,
  memoId: string,
  labelId: string
) {
  db.insert(schema.memoLabels).values({
    memoId,
    labelId,
  }).run();
}
