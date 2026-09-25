// @vitest-environment jsdom
//
// メイン画面（routes/index.tsx）の配線契約（ADR 0006）:
// クエリ描画・検索・ラベルフィルタ・カード操作（ピン/削除）・インポートダイアログ・作成ダイアログ
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test-utils";
import {
  getMemos,
  getLabels,
  deleteMemo,
  togglePin,
  importOrgText,
  importOrgFile,
  type Memo,
} from "@/lib/api";

// API はモジュール境界でモック（実サーバには一切接続しない）
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

const mockedGetMemos = vi.mocked(getMemos);
const mockedGetLabels = vi.mocked(getLabels);
const mockedDeleteMemo = vi.mocked(deleteMemo);
const mockedTogglePin = vi.mocked(togglePin);
const mockedImportOrgText = vi.mocked(importOrgText);
const mockedImportOrgFile = vi.mocked(importOrgFile);

function memo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "m1",
    title: "Memo One",
    body: "body one",
    entryDate: null,
    isPinned: 0,
    isArchived: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMemos.mockResolvedValue([]);
  mockedGetLabels.mockResolvedValue([]);
  mockedDeleteMemo.mockResolvedValue({ ok: true });
  mockedTogglePin.mockResolvedValue({ isPinned: true });
  mockedImportOrgText.mockResolvedValue({ id: "i1", title: "T", labelCount: 0 });
  mockedImportOrgFile.mockResolvedValue({ id: "i2", title: "F", labelCount: 0 });
});

// MemoCard のドロップダウン起動ボタン（アイコンのみ）をカードから引く
function cardMenuTrigger(title: string): HTMLElement {
  const card = screen.getByText(title).closest(".group");
  if (!card) throw new Error(`card not found for ${title}`);
  return within(card as HTMLElement).getByRole("button");
}

describe("一覧描画", () => {
  it("ピン留めメモを専用セクションで先頭に表示し、ラベル badge を描画する", async () => {
    mockedGetMemos.mockResolvedValue([
      memo({ id: "p1", title: "Pinned Memo", isPinned: 1 }),
      memo({ id: "m1", title: "Normal Memo", labels: [{ id: "l1", name: "work" }] }),
    ]);
    renderApp("/");

    expect(await screen.findByText("Pinned Memo")).toBeInTheDocument();
    expect(screen.getByText("Normal Memo")).toBeInTheDocument();
    expect(screen.getByText("ピン留め")).toBeInTheDocument();
    expect(screen.getByText("work")).toBeInTheDocument();
  });

  it("メモが 0 件のときは案内を表示する", async () => {
    renderApp("/");
    expect(
      await screen.findByText(/メモがありません/)
    ).toBeInTheDocument();
  });
});

describe("検索", () => {
  it("検索入力すると q パラメータで再取得する", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(/メモがありません/);

    await user.type(screen.getByPlaceholderText("メモを検索..."), "foo");

    await waitFor(() =>
      expect(mockedGetMemos).toHaveBeenLastCalledWith({
        q: "foo",
        label: undefined,
        diary: "exclude",
      })
    );
  });
});

describe("ラベルフィルタ", () => {
  it("ラベルボタンで絞り込み、再クリックで解除する", async () => {
    const user = userEvent.setup();
    mockedGetLabels.mockResolvedValue([{ id: "l1", name: "work" }]);
    renderApp("/");
    await screen.findByText(/メモがありません/);

    await user.click(screen.getByRole("button", { name: "work" }));
    await waitFor(() =>
      expect(mockedGetMemos).toHaveBeenLastCalledWith({
        q: undefined,
        label: "l1",
        diary: "exclude",
      })
    );

    await user.click(screen.getByRole("button", { name: "work" }));
    await waitFor(() =>
      expect(mockedGetMemos).toHaveBeenLastCalledWith({
        q: undefined,
        label: undefined,
        diary: "exclude",
      })
    );
  });
});

describe("メモカードの操作", () => {
  it("ドロップダウンからピン留めすると togglePin が呼ばれる", async () => {
    const user = userEvent.setup();
    mockedGetMemos.mockResolvedValue([memo({ id: "m1", title: "Memo One" })]);
    renderApp("/");
    await screen.findByText("Memo One");

    await user.click(cardMenuTrigger("Memo One"));
    await user.click(await screen.findByRole("menuitem", { name: "ピン留め" }));

    // mutationFn は TanStack Query から (variables, context) で呼ばれるため先頭引数で検証
    await waitFor(() =>
      expect(mockedTogglePin.mock.calls[0][0]).toBe("m1")
    );
  });

  it("ドロップダウンから確認付きで削除すると deleteMemo が呼ばれる", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedGetMemos.mockResolvedValue([memo({ id: "m1", title: "Memo One" })]);
    renderApp("/");
    await screen.findByText("Memo One");

    await user.click(cardMenuTrigger("Memo One"));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));

    await waitFor(() =>
      expect(mockedDeleteMemo.mock.calls[0][0]).toBe("m1")
    );
  });
});

describe("インポートダイアログ", () => {
  it("テキスト貼り付け→インポートで importOrgText が呼ばれ、ダイアログが閉じる", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(/メモがありません/);

    await user.click(screen.getByRole("button", { name: "インポート" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByPlaceholderText("* TODO 買い物リスト"),
      "* TODO test"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "インポート" })
    );

    await waitFor(() =>
      expect(mockedImportOrgText.mock.calls[0][0]).toBe("* TODO test")
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull()
    );
  });

  it("ファイルアップロードで importOrgFile が呼ばれ、ダイアログが閉じる", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(/メモがありません/);

    await user.click(screen.getByRole("button", { name: "インポート" }));
    const dialog = await screen.findByRole("dialog");
    const fileInput = dialog.querySelector<HTMLInputElement>("input[type=file]");
    if (!fileInput) throw new Error("file input not found");

    const file = new File(["#+TITLE: F\nbody"], "memo.org", {
      type: "text/plain",
    });
    await user.upload(fileInput, file);

    await waitFor(() => expect(mockedImportOrgFile).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("作成ダイアログ", () => {
  it("新規メモボタンで MemoEditor が開く", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(/メモがありません/);

    await user.click(screen.getByRole("button", { name: "新規メモ" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByPlaceholderText("タイトル（1行目）")
    ).toBeInTheDocument();
  });
});
