// @vitest-environment jsdom
//
// ラベル管理画面（routes/labels.tsx）の配線契約（ADR 0006）:
// 一覧描画・作成（入力クリアまで）・確認付き削除・空状態
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./test-utils";
import { getLabels, createLabel, deleteLabel } from "@/lib/api";

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

const mockedGetLabels = vi.mocked(getLabels);
const mockedCreateLabel = vi.mocked(createLabel);
const mockedDeleteLabel = vi.mocked(deleteLabel);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetLabels.mockResolvedValue([]);
  mockedCreateLabel.mockResolvedValue({ id: "l-new", name: "new-label" });
  mockedDeleteLabel.mockResolvedValue({ ok: true });
});

describe("ラベル管理画面", () => {
  it("ラベルが 0 件のときは案内を表示する", async () => {
    renderApp("/labels");
    expect(await screen.findByText("ラベルがありません。")).toBeInTheDocument();
  });

  it("ラベル一覧を描画する", async () => {
    mockedGetLabels.mockResolvedValue([
      { id: "l1", name: "work" },
      { id: "l2", name: "private" },
    ]);
    renderApp("/labels");

    expect(await screen.findByText("work")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
  });

  it("ラベルを作成すると createLabel が呼ばれ、入力欄がクリアされる", async () => {
    const user = userEvent.setup();
    renderApp("/labels");
    await screen.findByText("ラベルがありません。");

    const input = screen.getByPlaceholderText("新しいラベル名");
    await user.type(input, "new-label");
    await user.click(screen.getByRole("button", { name: "追加" }));

    await waitFor(() =>
      expect(mockedCreateLabel).toHaveBeenCalledWith("new-label")
    );
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("確認付きでラベルを削除すると deleteLabel が呼ばれる", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedGetLabels.mockResolvedValue([{ id: "l1", name: "work" }]);
    renderApp("/labels");

    const badge = (await screen.findByText("work")).parentElement!;
    const deleteButton = badge.querySelector("button");
    if (!deleteButton) throw new Error("delete button not found in badge");
    await user.click(deleteButton);

    // mutationFn は TanStack Query から (variables, context) で呼ばれるため先頭引数で検証
    await waitFor(() =>
      expect(mockedDeleteLabel.mock.calls[0][0]).toBe("l1")
    );
  });
});
