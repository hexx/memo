// @vitest-environment jsdom
//
// アーカイブ画面（routes/archive.tsx）の配線契約（ADR 0006）:
// archived=1 での取得・アーカイブ解除・確認付き削除・空状態
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test-utils";
import {
  getMemos,
  toggleArchive,
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

const mockedGetMemos = vi.mocked(getMemos);
const mockedToggleArchive = vi.mocked(toggleArchive);
const mockedDeleteMemo = vi.mocked(deleteMemo);

function memo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "a1",
    title: "Archived Memo",
    body: "archived body",
    isPinned: 0,
    isArchived: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMemos.mockResolvedValue([]);
  mockedToggleArchive.mockResolvedValue({ isArchived: false });
  mockedDeleteMemo.mockResolvedValue({ ok: true });
});

describe("アーカイブ画面", () => {
  it("archived=true で取得し、空のときは案内を表示する", async () => {
    renderApp("/archive");

    expect(
      await screen.findByText("アーカイブされたメモはありません。")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGetMemos).toHaveBeenCalledWith({ archived: true })
    );
  });

  it("アーカイブ済みメモを一覧し、「戻す」で toggleArchive が呼ばれる", async () => {
    const user = userEvent.setup();
    mockedGetMemos.mockResolvedValue([memo()]);
    renderApp("/archive");

    expect(await screen.findByText("Archived Memo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "戻す" }));

    // mutationFn は TanStack Query から (variables, context) で呼ばれるため先頭引数で検証
    await waitFor(() =>
      expect(mockedToggleArchive.mock.calls[0][0]).toBe("a1")
    );
  });

  it("確認付き削除で deleteMemo が呼ばれる", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedGetMemos.mockResolvedValue([memo()]);
    renderApp("/archive");

    await screen.findByText("Archived Memo");
    await user.click(
      screen.getByRole("button", { name: "メモを完全に削除" })
    );

    await waitFor(() =>
      expect(mockedDeleteMemo.mock.calls[0][0]).toBe("a1")
    );
  });
});
