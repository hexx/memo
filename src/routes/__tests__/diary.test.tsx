// @vitest-environment jsdom
//
// 日記ビュー（routes/diary.tsx）の配線契約（ADR 0006）:
// 日記のみの一覧取得・検索・「日記を書く」の分岐（既存を開く / 作成ダイアログ）・
// 作成（entryDate 付き）・409 時に既存を開く・アーカイブ/削除
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test-utils";
import {
  getDiaries,
  getLabels,
  createDiary,
  deleteMemo,
  toggleArchive,
  type Memo,
} from "@/lib/api";
import { defaultDiaryTitle, todayInTokyo } from "@/lib/diaryDate";

vi.mock("@/lib/api", () => ({
  getMemos: vi.fn(),
  getLabels: vi.fn(),
  getMemo: vi.fn(),
  createMemo: vi.fn(),
  updateMemo: vi.fn(),
  deleteMemo: vi.fn(),
  togglePin: vi.fn(),
  toggleArchive: vi.fn(),
  generateTitle: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  importOrgText: vi.fn(),
  importOrgFile: vi.fn(),
  getDiaries: vi.fn(),
  createDiary: vi.fn(),
  getExportUrl: (id: string) => `/api/memos/${id}/export`,
}));

const mockedGetDiaries = vi.mocked(getDiaries);
const mockedGetLabels = vi.mocked(getLabels);
const mockedCreateDiary = vi.mocked(createDiary);
const mockedDeleteMemo = vi.mocked(deleteMemo);
const mockedToggleArchive = vi.mocked(toggleArchive);

function diary(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "d1",
    title: "2020-01-05 (日)",
    body: "今日の記録",
    entryDate: "2020-01-05",
    isPinned: 0,
    isArchived: 0,
    createdAt: "2020-01-05T00:00:00.000Z",
    updatedAt: "2020-01-05T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetDiaries.mockResolvedValue([]);
  mockedGetLabels.mockResolvedValue([]);
  mockedCreateDiary.mockResolvedValue({
    id: "new-diary",
    entryDate: todayInTokyo(),
    title: defaultDiaryTitle(todayInTokyo()),
  });
  mockedDeleteMemo.mockResolvedValue({ ok: true });
  mockedToggleArchive.mockResolvedValue({ isArchived: true });
});

describe("日記一覧", () => {
  it("日記を取得して日付とタイトルを描画する", async () => {
    mockedGetDiaries.mockResolvedValue([diary()]);
    renderApp("/diary");

    expect(await screen.findByText("2020-01-05 (日)")).toBeInTheDocument();
    expect(mockedGetDiaries).toHaveBeenCalledWith({
      q: undefined,
      label: undefined,
    });
  });

  it("検索入力で q パラメータ付き再取得する", async () => {
    const user = userEvent.setup();
    renderApp("/diary");
    await screen.findByText(/日記はまだありません/);

    await user.type(screen.getByPlaceholderText("日記を検索..."), "trip");

    await waitFor(() =>
      expect(mockedGetDiaries).toHaveBeenLastCalledWith({
        q: "trip",
        label: undefined,
      })
    );
  });

  it("日記が 0 件のときは案内を表示する", async () => {
    renderApp("/diary");
    expect(await screen.findByText(/日記はまだありません/)).toBeInTheDocument();
  });
});

describe("日記を書く", () => {
  it("今日の日記が既にあれば作成せず既存の詳細画面を開く", async () => {
    const user = userEvent.setup();
    const today = todayInTokyo();
    mockedGetDiaries.mockImplementation(async (params) =>
      params?.date === today
        ? [
            diary({
              id: "today-diary",
              entryDate: today,
              title: defaultDiaryTitle(today),
            }),
          ]
        : []
    );
    const { router } = renderApp("/diary");
    await screen.findByText(/日記はまだありません/);

    await user.click(screen.getByRole("button", { name: "日記を書く" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/memos/today-diary")
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("今日の日記がなければ作成ダイアログを開き、entryDate 付きで作成する", async () => {
    const user = userEvent.setup();
    renderApp("/diary");
    await screen.findByText(/日記はまだありません/);

    await user.click(screen.getByRole("button", { name: "日記を書く" }));

    const dialog = await screen.findByRole("dialog");
    const today = todayInTokyo();
    expect(within(dialog).getByLabelText("日付")).toHaveValue(today);
    expect(within(dialog).getByPlaceholderText("タイトル（1行目）")).toHaveValue(
      defaultDiaryTitle(today)
    );

    const saveButtons = within(dialog).getAllByRole("button", { name: "作成" });
    await user.click(saveButtons[saveButtons.length - 1]);

    // mutationFn は TanStack Query から (variables, context) で呼ばれるため先頭引数で検証
    await waitFor(() => expect(mockedCreateDiary).toHaveBeenCalled());
    expect(mockedCreateDiary.mock.calls[0][0]).toEqual({
      title: defaultDiaryTitle(today),
      body: "",
      labelIds: [],
      entryDate: today,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("保存時に 409 なら同日の既存日記を開く", async () => {
    const user = userEvent.setup();
    const today = todayInTokyo();
    let created = false;
    mockedGetDiaries.mockImplementation(async (params) => {
      if (params?.date === today) {
        return created
          ? [
              diary({
                id: "existing",
                entryDate: today,
                title: defaultDiaryTitle(today),
              }),
            ]
          : [];
      }
      return [];
    });
    mockedCreateDiary.mockImplementation(async () => {
      created = true;
      throw new Error("Diary already exists for this date");
    });

    const { router } = renderApp("/diary");
    await screen.findByText(/日記はまだありません/);
    await user.click(screen.getByRole("button", { name: "日記を書く" }));

    const dialog = await screen.findByRole("dialog");
    const saveButtons = within(dialog).getAllByRole("button", { name: "作成" });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/memos/existing")
    );
    // アーカイブ済みの日記も日付を占有しているため、復旧検索は archived を含める
    expect(mockedGetDiaries).toHaveBeenCalledWith({
      date: today,
      archived: true,
    });
  });
});

describe("日記カードの操作", () => {
  it("アーカイブすると toggleArchive が呼ばれる", async () => {
    const user = userEvent.setup();
    mockedGetDiaries.mockResolvedValue([diary()]);
    renderApp("/diary");
    await screen.findByText("2020-01-05 (日)");

    const card = screen.getByText("2020-01-05 (日)").closest(".group");
    if (!card) throw new Error("card not found");
    await user.click(within(card as HTMLElement).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: "アーカイブ" }));

    await waitFor(() => expect(mockedToggleArchive.mock.calls[0][0]).toBe("d1"));
  });

  it("確認付きで削除すると deleteMemo が呼ばれる", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedGetDiaries.mockResolvedValue([diary()]);
    renderApp("/diary");
    await screen.findByText("2020-01-05 (日)");

    const card = screen.getByText("2020-01-05 (日)").closest(".group");
    if (!card) throw new Error("card not found");
    await user.click(within(card as HTMLElement).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));

    await waitFor(() => expect(mockedDeleteMemo.mock.calls[0][0]).toBe("d1"));
  });
});