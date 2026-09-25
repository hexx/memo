import { describe, it, expect } from "vitest";
import {
  defaultDiaryTitle,
  isFutureDate,
  isValidDateString,
  todayInTokyo,
} from "../diaryDate";

describe("todayInTokyo", () => {
  it("UTC 15:00 を境に JST の日付が切り替わる（固定 +9h）", () => {
    expect(todayInTokyo(Date.UTC(2026, 8, 24, 14, 59, 59))).toBe("2026-09-24");
    expect(todayInTokyo(Date.UTC(2026, 8, 24, 15, 0, 0))).toBe("2026-09-25");
  });
});

describe("isValidDateString", () => {
  it("YYYY-MM-DD 形式かつ実在する暦日のみ true", () => {
    expect(isValidDateString("2026-09-24")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true); // 閏日
    expect(isValidDateString("2026-02-30")).toBe(false); // 存在しない日
    expect(isValidDateString("2026-9-24")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString("2026-09-24T00:00:00Z")).toBe(false);
  });
});

describe("isFutureDate", () => {
  it("今日と過去は false、明日以降は true", () => {
    expect(isFutureDate("2026-09-23", "2026-09-24")).toBe(false);
    expect(isFutureDate("2026-09-24", "2026-09-24")).toBe(false);
    expect(isFutureDate("2026-09-25", "2026-09-24")).toBe(true);
  });
});

describe("defaultDiaryTitle", () => {
  it("YYYY-MM-DD (曜) を返す", () => {
    expect(defaultDiaryTitle("2026-09-24")).toBe("2026-09-24 (木)");
    expect(defaultDiaryTitle("2020-01-05")).toBe("2020-01-05 (日)");
  });
});