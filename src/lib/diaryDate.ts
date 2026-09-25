// 日記の日付（暦日 YYYY-MM-DD）に関する純粋ロジック。
// サーバー（日付の割当・検証・既定タイトル）とクライアント（ピッカー既定値・追従）が
// 同じ規則を使う必要があるため、双方から共有する。

export const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000; // JST は DST なしの固定 +09:00

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** Asia/Tokyo の「今日」を YYYY-MM-DD で返す */
export function todayInTokyo(now: number = Date.now()): string {
  return new Date(now + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 形式かつ実在する暦日か（2026-02-30 のような存在しない日付は false） */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 日記の既定タイトル: `2026-09-24 (木)` */
export function defaultDiaryTitle(entryDate: string): string {
  const weekday = new Date(`${entryDate}T00:00:00Z`).getUTCDay();
  return `${entryDate} (${WEEKDAY_LABELS[weekday]})`;
}

/** 今日（Asia/Tokyo）より後の日付か */
export function isFutureDate(
  value: string,
  today: string = todayInTokyo()
): boolean {
  return value > today;
}