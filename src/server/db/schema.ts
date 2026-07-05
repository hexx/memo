import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const memos = sqliteTable("memos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isPinned: integer("is_pinned").notNull().default(0),
  isArchived: integer("is_archived").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const memoLabels = sqliteTable(
  "memo_labels",
  {
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.memoId, table.labelId] }),
  }),
);
