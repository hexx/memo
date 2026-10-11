// @vitest-environment jsdom
//
// メモ詳細/編集画面（routes/memos/$memoId.tsx）の配線契約（ADR 0006 / ADR 0007）:
// パラメータ取得・MemoEditor 描画・保存（updateMemo→画面に留まる）・削除（ホーム遷移）・エラー表示
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
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
  getDiaries: vi.fn(),
  createDiary: vi.fn(),
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

  it("変更して保存すると updateMemo が呼ばれ、編集画面に留まる", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    fireEvent.change(screen.getByDisplayValue("Detail Memo"), {
      target: { value: "Renamed" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockedUpdateMemo).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({
          title: "Renamed",
          body: "* H",
          labelIds: [],
        }),
        undefined
      )
    );
    // 詳細画面での保存は遷移しない（ADR 0007: 連続編集を許容するため画面に留まる）。
    // ホームへは「← 戻る」ボタンで遷移し、削除時のみ onSuccess でホームへ戻る。
    expect(router.state.location.pathname).toBe("/memos/abc");
  });

  it("「← 戻る」は保留中の変更を保存してから遷移する", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    // デバウンス（1 秒）が待たれないうちに戻る
    fireEvent.change(screen.getByDisplayValue("Detail Memo"), {
      target: { value: "Renamed" },
    });
    await user.click(screen.getByRole("button", { name: "← 戻る" }));

    expect(mockedUpdateMemo).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ title: "Renamed" }),
      undefined
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("保存に失敗したときは「← 戻る」で遷移せず、編集画面に留まる", async () => {
    const user = userEvent.setup();
    mockedUpdateMemo.mockRejectedValue(new Error("network error"));
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    fireEvent.change(screen.getByDisplayValue("Detail Memo"), {
      target: { value: "Renamed" },
    });
    await user.click(screen.getByRole("button", { name: "← 戻る" }));

    await screen.findByRole("button", { name: "保存に失敗（再試行）" });
    expect(router.state.location.pathname).toBe("/memos/abc");
  });

  it("画面を離れるときは、保留中の保存が終わってからキャッシュを更新する", async () => {
    let resolveSave: (() => void) | undefined;
    mockedUpdateMemo.mockImplementation(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSave = () => resolve({ ok: true });
        })
    );
    const { router, queryClient } = renderApp("/memos/abc");
    await screen.findByDisplayValue("Detail Memo");

    fireEvent.change(screen.getByDisplayValue("Detail Memo"), {
      target: { value: "Renamed" },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // 戻るボタンではなくブラウザの戻る相当（アンマウント経由）で離脱する
    await act(async () => {
      await router.navigate({ to: "/" });
    });

    expect(mockedUpdateMemo).toHaveBeenCalled();
    // 保存が終わるまでは invalidate しない（古い内容で再取得しないため）
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave?.();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["memos"] });
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

describe("日記の詳細画面", () => {
  it("日記は日付ピッカー付きで表示し、「← 戻る」で /diary へ遷移する", async () => {
    const user = userEvent.setup();
    mockedGetMemo.mockResolvedValue(
      memo({ title: "2020-01-05 (日)", entryDate: "2020-01-05" })
    );
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("2020-01-05 (日)");

    expect(screen.getByLabelText("日付")).toHaveValue("2020-01-05");

    await user.click(screen.getByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/diary"));
  });

  it("日付を変更して保存すると entryDate 付きで updateMemo が呼ばれる", async () => {
    const user = userEvent.setup();
    mockedGetMemo.mockResolvedValue(
      memo({ title: "2020-01-05 (日)", entryDate: "2020-01-05" })
    );
    renderApp("/memos/abc");
    await screen.findByDisplayValue("2020-01-05 (日)");

    fireEvent.change(screen.getByLabelText("日付"), {
      target: { value: "2020-01-06" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mockedUpdateMemo).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({ entryDate: "2020-01-06" }),
        undefined
      )
    );
  });

  it("日記の削除後は /diary へ遷移する", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedGetMemo.mockResolvedValue(
      memo({ title: "2020-01-05 (日)", entryDate: "2020-01-05" })
    );
    const { router } = renderApp("/memos/abc");
    await screen.findByDisplayValue("2020-01-05 (日)");

    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(mockedDeleteMemo).toHaveBeenCalledWith("abc"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/diary"));
  });
});
