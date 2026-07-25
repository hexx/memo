// @vitest-environment jsdom
//
// メモ詳細/編集画面（routes/memos/$memoId.tsx）の配線契約（ADR 0006 / ADR 0007）:
// パラメータ取得・MemoEditor 描画・保存（updateMemo→画面に留まる）・削除（ホーム遷移）・エラー表示
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test-utils";
import {
  getMemo,
  getMemos,
  updateMemo,
  deleteMemo,
  type Memo,
} from "@/lib/api";

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
  getExportUrl: (id: string) => `/api/memos/${id}/export`,
}));

const mockedGetMemo = vi.mocked(getMemo);
const mockedGetMemos = vi.mocked(getMemos);
const mockedUpdateMemo = vi.mocked(updateMemo);
const mockedDeleteMemo = vi.mocked(deleteMemo);

function memo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "abc",
    title: "Detail Memo",
    body: "* H",
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
  mockedGetMemo.mockResolvedValue(memo());
  mockedUpdateMemo.mockResolvedValue({ ok: true });
  mockedDeleteMemo.mockResolvedValue({ ok: true });
});

describe("メモ詳細画面", () => {
  it("URL パラメータの id でメモを取得し、MemoEditor に反映する", async () => {
    renderApp("/memos/abc");

    expect(await screen.findByDisplayValue("Detail Memo")).toBeInTheDocument();
    await waitFor(() => expect(mockedGetMemo).toHaveBeenCalledWith("abc"));
  });

  it("保存すると updateMemo が呼ばれ、編集画面に留まる", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockedUpdateMemo).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({
          title: "Detail Memo",
          body: "* H",
          labelIds: [],
        })
      )
    );
    // 詳細画面での保存は遷移しない（ADR 0007: 連続編集を許容するため画面に留まる）。
    // ホームへは「← 戻る」ボタンで遷移し、削除時のみ onSuccess でホームへ戻る。
    expect(router.state.location.pathname).toBe("/memos/abc");
  });

  it("確認付き削除で deleteMemo が呼ばれ、ホームへ遷移する", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(mockedDeleteMemo).toHaveBeenCalledWith("abc"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/")
    );
  });

  it("取得失敗時はエラーメッセージを表示する", async () => {
    mockedGetMemo.mockRejectedValue(new Error("boom"));
    renderApp("/memos/abc");

    expect(await screen.findByText("エラー: boom")).toBeInTheDocument();
  });
});
