// @vitest-environment jsdom
//
// MemoEditor の「契約」を測る（ADR 0006）:
// - 作成契約（title/body/labelIds が渡る）
// - 実 TipTap を経由した org ラウンドトリップ
// - 自動タイトルの 3 分岐（成功 / null / throw、いずれもブロックしない）
// - ラベル配線（トグル・その場作成→自動選択）
// - リンクのスキーマサニタイズ（XSS 防止）
// ツールバーの各マーク操作（TipTap 本体）は測らない。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoEditor } from "../MemoEditor";
import {
  getLabels,
  createLabel,
  createMemo,
  generateTitle,
  type Memo,
} from "@/lib/api";

// API はモジュール境界でモック（実サーバには一切接続しない）
vi.mock("@/lib/api", () => ({
  getLabels: vi.fn(),
  createLabel: vi.fn(),
  createMemo: vi.fn(),
  generateTitle: vi.fn(),
}));

const mockedGetLabels = vi.mocked(getLabels);
const mockedCreateLabel = vi.mocked(createLabel);
const mockedCreateMemo = vi.mocked(createMemo);
const mockedGenerateTitle = vi.mocked(generateTitle);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeMemo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "m1",
    title: "Existing",
    body: "plain body",
    isPinned: 0,
    isArchived: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

// 保存ボタンは新規モードでは「作成」（ラベル追加ボタンと同名）、
// 編集モードでは「保存」。DOM 順で最後が保存ボタン。
function getSaveButton(): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: /^(作成|保存)$/ });
  return buttons[buttons.length - 1];
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetLabels.mockResolvedValue([]);
  mockedCreateMemo.mockResolvedValue({ id: "new-id" });
  // jsdom の alert は未実装のため、必ずモックしてから操作する
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("作成契約", () => {
  it("空タイトルでは作成ボタンが無効", async () => {
    render(<MemoEditor />, { wrapper });
    await screen.findByPlaceholderText("タイトル（1行目）");
    expect(getSaveButton()).toBeDisabled();
  });

  it("タイトルを入力して作成すると createMemo に title/body/labelIds が渡り onSaved が呼ばれる", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<MemoEditor onSaved={onSaved} />, { wrapper });

    await user.type(
      screen.getByPlaceholderText("タイトル（1行目）"),
      "New Memo"
    );
    await user.click(getSaveButton());

    await waitFor(() => {
      expect(mockedCreateMemo).toHaveBeenCalledWith({
        title: "New Memo",
        body: "",
        labelIds: [],
      });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("org ラウンドトリップ（実 TipTap 経由）", () => {
  it("initialMemo の org 本文がエディタを経由して保存時に org に戻る", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const body = "* Heading\n- item one\n- item two\n\nSome *bold* text";
    render(<MemoEditor initialMemo={makeMemo({ body })} onSave={onSave} />, {
      wrapper,
    });

    // 実エディタがマウントされるのを待つ（aria-label="メモ本文"）
    await screen.findByLabelText("メモ本文");
    await user.click(getSaveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved.title).toBe("Existing");
    // 見出し・リスト・太字が org 記法として保持されている
    expect(saved.body).toContain("* Heading");
    expect(saved.body).toContain("- item one");
    expect(saved.body).toContain("- item two");
    expect(saved.body).toContain("Some *bold* text");
  });
});

describe("自動タイトル", () => {
  it("成功: 生成されたタイトルがタイトル欄に反映される", async () => {
    const user = userEvent.setup();
    mockedGenerateTitle.mockResolvedValue({ title: "Generated Title" });
    render(<MemoEditor initialMemo={makeMemo({ body: "some body" })} />, {
      wrapper,
    });

    await user.click(screen.getByRole("button", { name: "AIで生成" }));

    expect(
      await screen.findByDisplayValue("Generated Title")
    ).toBeInTheDocument();
    expect(mockedGenerateTitle).toHaveBeenCalledWith("some body");
  });

  it("null: alert で案内し、作成をブロックしない", async () => {
    const user = userEvent.setup();
    mockedGenerateTitle.mockResolvedValue({ title: null });
    render(<MemoEditor initialMemo={makeMemo({ body: "some body" })} />, {
      wrapper,
    });

    await user.click(screen.getByRole("button", { name: "AIで生成" }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("タイトルの自動生成が利用できません")
      )
    );
  });

  it("throw: alert で失敗を案内し、作成をブロックしない", async () => {
    const user = userEvent.setup();
    mockedGenerateTitle.mockRejectedValue(new Error("boom"));
    render(<MemoEditor initialMemo={makeMemo({ body: "some body" })} />, {
      wrapper,
    });

    await user.click(screen.getByRole("button", { name: "AIで生成" }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("タイトルの生成に失敗しました")
    );
  });

  it("本文が空のときは AIで生成 ボタンが無効", async () => {
    render(<MemoEditor />, { wrapper });
    expect(screen.getByRole("button", { name: "AIで生成" })).toBeDisabled();
  });
});

describe("ラベル配線", () => {
  it("badge クリックで選択がトグルし、保存時の labelIds に反映される", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    mockedGetLabels.mockResolvedValue([
      { id: "l1", name: "work" },
      { id: "l2", name: "private" },
    ]);
    render(
      <MemoEditor initialMemo={makeMemo()} onSave={onSave} />,
      { wrapper }
    );

    const work = await screen.findByText("work");
    await user.click(work);
    await user.click(getSaveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].labelIds).toEqual(["l1"]);

    // もう一度クリックすると解除される
    onSave.mockClear();
    await user.click(work);
    await user.click(getSaveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].labelIds).toEqual([]);
  });

  it("その場で新規ラベルを作成すると自動で選択される", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    mockedGetLabels.mockResolvedValue([]);
    mockedCreateLabel.mockResolvedValue({ id: "l3", name: "new-label" });
    render(<MemoEditor initialMemo={makeMemo()} onSave={onSave} />, {
      wrapper,
    });

    await user.type(
      screen.getByPlaceholderText("新しいラベル名"),
      "new-label"
    );
    await user.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(mockedCreateLabel).toHaveBeenCalledWith("new-label"));
    // 入力欄はクリアされる
    await waitFor(() =>
      expect(screen.getByPlaceholderText("新しいラベル名")).toHaveValue("")
    );
    // 作成したラベル（l3）はクリックせずとも自動選択状態で保存される
    await user.click(getSaveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].labelIds).toEqual(["l3"]);
  });
});

describe("リンクサニタイズ（XSS 防止）", () => {
  // jsdom ではキーボードでの全選択（Mod-a）が TipTap に届かないため、
  // DOM 選択を手動設定し、selectionchange で ProseMirror の状態に同期させる。
  async function selectEditorContent(editorEl: HTMLElement) {
    editorEl.focus();
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    // ProseMirror が selectionchange を非同期で処理するのを待つ
    await new Promise((r) => setTimeout(r, 200));
  }

  it("javascript: スキーマは拒否され、リンクが挿入されない", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.fn().mockReturnValue("javascript:alert(1)");
    window.prompt = promptSpy;

    render(
      <MemoEditor initialMemo={makeMemo({ body: "hello link world" })} />,
      { wrapper }
    );
    const editorEl = await screen.findByLabelText("メモ本文");
    await selectEditorContent(editorEl);
    await user.click(screen.getByRole("button", { name: "リンク" }));

    expect(promptSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("http(s):// または mailto:")
    );
    expect(editorEl.querySelector("a")).toBeNull();
  });

  it("https: スキーマは許可され、リンクが挿入される", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.fn().mockReturnValue("https://example.com");
    window.prompt = promptSpy;

    render(
      <MemoEditor initialMemo={makeMemo({ body: "hello link world" })} />,
      { wrapper }
    );
    const editorEl = await screen.findByLabelText("メモ本文");
    await selectEditorContent(editorEl);
    await user.click(screen.getByRole("button", { name: "リンク" }));

    await waitFor(() =>
      expect(editorEl.querySelector('a[href="https://example.com"]')).not.toBeNull()
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
