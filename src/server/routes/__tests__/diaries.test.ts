import { describe, it, expect, beforeEach } from "vitest";
import { diariesRoute } from "../diaries";
import { Hono } from "hono";
import {
  createTestDb,
  seedMemo,
  seedLabel,
  seedMemoLabel,
} from "../../../../tests/helpers";
import { setTestDb } from "../../db";
import { defaultDiaryTitle, todayInTokyo } from "../../../lib/diaryDate";

let db: ReturnType<typeof createTestDb>["db"];

function createApp() {
  const app = new Hono();
  app.route("/", diariesRoute);
  return app;
}

async function req(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("diaries", () => {
  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    setTestDb(db);
  });

  // ── GET / ──────────────────────────────────────────────

  describe("GET /", () => {
    it("日記のみを日付降順で返す", async () => {
      seedMemo(db, { title: "Plain memo" });
      seedMemo(db, { title: "d1", entryDate: "2020-01-04" });
      seedMemo(db, { title: "d2", entryDate: "2020-01-05" });

      const res = await req(createApp(), "GET", "/");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.map((m: { title: string }) => m.title)).toEqual(["d2", "d1"]);
    });

    it("アーカイブ済みの日記は既定で除外し、archived=1 で含む", async () => {
      seedMemo(db, { title: "Visible", entryDate: "2020-01-05" });
      seedMemo(db, { title: "Hidden", entryDate: "2020-01-04", isArchived: 1 });

      const app = createApp();
      expect(await req(app, "GET", "/").then((r) => r.json())).toHaveLength(1);
      expect(
        await req(app, "GET", "/?archived=1").then((r) => r.json())
      ).toHaveLength(2);
    });

    it("date クエリで日付を絞り込める", async () => {
      seedMemo(db, { title: "d1", entryDate: "2020-01-04" });
      seedMemo(db, { title: "d2", entryDate: "2020-01-05" });

      const res = await req(createApp(), "GET", "/?date=2020-01-05");
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe("d2");
    });

    it("検索とラベルフィルタが効き、ラベルを同梱する", async () => {
      const memoId = seedMemo(db, {
        title: "Trip",
        body: "train",
        entryDate: "2020-01-05",
      });
      seedMemo(db, { title: "Other", body: "train", entryDate: "2020-01-04" });
      const labelId = seedLabel(db, { name: "travel" });
      seedMemoLabel(db, memoId, labelId);

      const app = createApp();
      const searched = await req(app, "GET", "/?q=train").then((r) => r.json());
      expect(searched).toHaveLength(2);

      const labelled = await req(app, "GET", `/?label=${labelId}`).then((r) =>
        r.json()
      );
      expect(labelled).toHaveLength(1);
      expect(labelled[0].id).toBe(memoId);
      expect(labelled[0].labels[0].name).toBe("travel");
    });
  });

  // ── POST / ─────────────────────────────────────────────

  describe("POST /", () => {
    it("entryDate と title を指定して作成できる", async () => {
      const res = await req(createApp(), "POST", "/", {
        title: "Custom",
        body: "Content",
        entryDate: "2020-01-05",
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.entryDate).toBe("2020-01-05");
      expect(data.title).toBe("Custom");

      const list = await req(createApp(), "GET", "/").then((r) => r.json());
      expect(list[0].body).toBe("Content");
    });

    it("entryDate 省略時はサーバーが Asia/Tokyo の今日を割り当て、タイトルは日付が既定になる", async () => {
      const res = await req(createApp(), "POST", "/", { body: "Today" });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.entryDate).toBe(todayInTokyo());
      expect(data.title).toBe(defaultDiaryTitle(todayInTokyo()));
    });

    it("空タイトルは日付の既定タイトルで補完する（AI 生成は使わない）", async () => {
      const res = await req(createApp(), "POST", "/", {
        title: "   ",
        body: "B",
        entryDate: "2020-01-05",
      });
      const data = await res.json();
      expect(data.title).toBe("2020-01-05 (日)");
    });

    it("未来日は 400", async () => {
      const res = await req(createApp(), "POST", "/", {
        body: "B",
        entryDate: "2999-01-01",
      });
      expect(res.status).toBe(400);
    });

    it("不正な日付は 400", async () => {
      const app = createApp();
      for (const entryDate of ["2020-02-30", "2020/01/05", ""]) {
        const res = await req(app, "POST", "/", { body: "B", entryDate });
        // 空文字は「未指定」と同義のため今日で作成される。ここでは不正形式のみ 400 を確認
        if (entryDate === "") {
          expect(res.status).toBe(201);
        } else {
          expect(res.status).toBe(400);
        }
      }
    });

    it("同じ日付の日記が既にあれば 409", async () => {
      seedMemo(db, { title: "Existing", entryDate: "2020-01-05" });
      const res = await req(createApp(), "POST", "/", {
        body: "B",
        entryDate: "2020-01-05",
      });
      expect(res.status).toBe(409);
    });

    it("body が文字列でなければ 400", async () => {
      const res = await req(createApp(), "POST", "/", {
        entryDate: "2020-01-05",
      });
      expect(res.status).toBe(400);
    });

    it("labelIds を指定して作成できる", async () => {
      const labelId = seedLabel(db, { name: "diary-tag" });
      const res = await req(createApp(), "POST", "/", {
        body: "B",
        entryDate: "2020-01-05",
        labelIds: [labelId],
      });
      expect(res.status).toBe(201);

      const list = await req(createApp(), "GET", "/").then((r) => r.json());
      expect(list[0].labels[0].name).toBe("diary-tag");
    });

    it("存在しないラベル ID は 400 で、日付を占有した行も残さない", async () => {
      const res = await req(createApp(), "POST", "/", {
        body: "B",
        entryDate: "2020-01-05",
        labelIds: ["no-such-label"],
      });
      expect(res.status).toBe(400);

      const list = await req(createApp(), "GET", "/").then((r) => r.json());
      expect(list).toHaveLength(0);
    });

    it("JSON ボディが null でも 400（500 にしない）", async () => {
      const res = await createApp().request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(res.status).toBe(400);
    });
  });
});