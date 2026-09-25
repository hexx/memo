// SQLite / D1 の UNIQUE 制約違反を判定する。
// 競合の事前チェックをすり抜けた同時実行（単一ユーザーでも起こり得る）を
// 409 として扱うためのセーフティネット。
export function isUniqueConstraintError(err: unknown): boolean {
  const messages: string[] = [];
  if (err instanceof Error) messages.push(err.message);
  if (err && typeof err === "object" && "cause" in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) messages.push(cause.message);
    else if (cause) messages.push(String(cause));
  }
  messages.push(String(err));
  return messages.some((m) =>
    /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(m)
  );
}