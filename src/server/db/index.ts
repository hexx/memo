import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Test-only: set this to a mock drizzle instance before tests
let testDb: ReturnType<typeof drizzle> | null = null;

export function setTestDb(db: ReturnType<typeof drizzle>) {
  testDb = db as any;
}

export function getDb(env?: { DB: D1Database }) {
  if (testDb) return testDb;
  if (!env?.DB) throw new Error("D1 database binding not available");
  return drizzle(env.DB, { schema });
}
