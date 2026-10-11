// @vitest-environment jsdom
//
// MemoEditor の「契約」を測る（ADR 0006 / ADR 0013）:
// - 作成契約（title/body/labelIds が渡る）
// - 実 TipTap を経由した org ラウンドトリップ
// - 自動タイトルの 3 分岐（成功 / null / throw、いずれもブロックしない）
// - ラベル配線（トグル・その場作成→自動選択）
// - リンクのスキーマサニタイズ（XSS 防止）
// - オートセーブ（デバウンス・状態表示・タイトルの扱い・新規作成の意味論）
// ツールバーの各マーク操作（TipTap 本体）は測らない。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoEditor } from "../MemoEditor";
import {
  getLabels,
  createLabel,
  createMemo,
  createDiary,
  updateMemo,
  generateTitle,
  type Memo,
} from "@/lib/api";
import { defaultDiaryTitle, todayInTokyo } from "@/lib/diaryDate";

// API はモジュール境界でモック（実サーバには一切接続しない）
vi.mock("@/lib/api", () => ({
  getLabels: vi.fn(),
  createLabel: vi.fn(),
  createMemo: vi.fn(),
  createDiary: vi.fn(),
  updateMemo: vi.fn(),
  generateTitle: vi.fn(),
}));

const mockedGetLabels = vi.mocked(getLabels);
const mockedCreateLabel = vi.mocked(createLabel);
const mockedCreateMemo = vi.mocked(createMemo);
const mockedCreateDiary = vi.mocked(createDiary);
const mockedUpdateMemo = vi.mocked(updateMemo);
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
    entryDate: null,
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
  mockedCreateDiary.mockResolvedValue({
    id: "new-diary",
    entryDate: "2020-01-05",
    title: "2020-01-05 (日)",
  });
  mockedUpdateMemo.mockResolvedValue({ ok: true });
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
      }, undefined);
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("org ラウンドトリップ（実 TipTap 経由）", () => {
  it("initialMemo の org 本文がエディタを経由して保存時に org に戻る", async () => {
    const user = userEvent.setup();
    const body = "* Heading\n- item one\n- item two\n\nSome *bold* text";
    render(<MemoEditor initialMemo={makeMemo({ body })} />, { wrapper });

    // 実エディタがマウントされるのを待つ（aria-label="メモ本文"）
    await screen.findByLabelText("メモ本文");
    // 変更が無いと保存しないので、タイトルだけ変えて保存を起こす
    fireEvent.change(screen.getByDisplayValue("Existing"), {
      target: { value: "Renamed" },
    });
    await user.click(getSaveButton());

    await waitFor(() => expect(mockedUpdateMemo).toHaveBeenCalled());
    const [, saved] = mockedUpdateMemo.mock.calls[0]!;
    expect(saved.title).toBe("Renamed");
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
    mockedGetLabels.mockResolvedValue([
      { id: "l1", name: "work" },
      { id: "l2", name: "private" },
    ]);
    render(<MemoEditor initialMemo={makeMemo()} />, { wrapper });

    const work = await screen.findByText("work");
    await user.click(work);
    mockedUpdateMemo.mockClear();
    await user.click(getSaveButton());

    await waitFor(() => expect(mockedUpdateMemo).toHaveBeenCalled());
    expect(mockedUpdateMemo.mock.calls[0]![1].labelIds).toEqual(["l1"]);

    // もう一度クリックすると解除される
    mockedUpdateMemo.mockClear();
    await user.click(work);
    await user.click(getSaveButton());
    await waitFor(() => expect(mockedUpdateMemo).toHaveBeenCalled());
    expect(mockedUpdateMemo.mock.calls[0]![1].labelIds).toEqual([]);
  });

  it("その場で新規ラベルを作成すると自動で選択される", async () => {
    const user = userEvent.setup();
    mockedGetLabels.mockResolvedValue([]);
    mockedCreateLabel.mockResolvedValue({ id: "l3", name: "new-label" });
    render(<MemoEditor initialMemo={makeMemo()} />, { wrapper });

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
    mockedUpdateMemo.mockClear();
    await user.click(getSaveButton());
    await waitFor(() => expect(mockedUpdateMemo).toHaveBeenCalled());
    expect(mockedUpdateMemo.mock.calls[0]![1].labelIds).toEqual(["l3"]);
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

describe("日記モード", () => {
  it("日付ピッカーと日付の既定タイトルで初期化される", async () => {
    const today = todayInTokyo();
    render(<MemoEditor isDiary />, { wrapper });

    expect(await screen.findByLabelText("日付")).toHaveValue(today);
    expect(screen.getByPlaceholderText("タイトル（1行目）")).toHaveValue(
      defaultDiaryTitle(today)
    );
  });

  it("未編集のタイトルは日付変更に追従する", async () => {
    render(<MemoEditor isDiary />, { wrapper });
    const dateInput = await screen.findByLabelText("日付");

    fireEvent.change(dateInput, { target: { value: "2020-01-05" } });

    expect(screen.getByPlaceholderText("タイトル（1行目）")).toHaveValue(
      "2020-01-05 (日)"
    );
  });

  it("編集済みのタイトルは日付変更でも保持される", async () => {
    const user = userEvent.setup();
    render(<MemoEditor isDiary />, { wrapper });
    const titleInput = await screen.findByPlaceholderText("タイトル（1行目）");
    await user.clear(titleInput);
    await user.type(titleInput, "旅行の記録");

    fireEvent.change(screen.getByLabelText("日付"), {
      target: { value: "2020-01-05" },
    });

    expect(titleInput).toHaveValue("旅行の記録");
  });

  it("保存時に entryDate 付きで createDiary を呼ぶ", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<MemoEditor isDiary onSaved={onSaved} />, { wrapper });
    await screen.findByLabelText("日付");

    fireEvent.change(screen.getByLabelText("日付"), {
      target: { value: "2020-01-05" },
    });
    await user.click(getSaveButton());

    await waitFor(() =>
      expect(mockedCreateDiary).toHaveBeenCalledWith({
        title: "2020-01-05 (日)",
        body: "",
        labelIds: [],
        entryDate: "2020-01-05",
      }, undefined)
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("空タイトルでも日付の既定タイトルで保存できる", async () => {
    const user = userEvent.setup();
    render(<MemoEditor isDiary initialEntryDate="2020-01-05" />, { wrapper });
    const titleInput = await screen.findByPlaceholderText("タイトル（1行目）");
    await user.clear(titleInput);

    await user.click(getSaveButton());

    await waitFor(() =>
      expect(mockedCreateDiary).toHaveBeenCalledWith({
        title: "2020-01-05 (日)",
        body: "",
        labelIds: [],
        entryDate: "2020-01-05",
      }, undefined)
    );
  });
});

describe("オートセーブ（ADR 0013）", () => {
  // TipTap のマウントは実タイマーで待ち、デバウンスの検証だけ fake timers で行う
  async function renderForAutosave(element: ReactNode) {
    render(element, { wrapper });
    await screen.findByLabelText("メモ本文");
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("開いただけでは保存しない", async () => {
    await renderForAutosave(<MemoEditor initialMemo={makeMemo()} />);
    vi.useFakeTimers();

    await advance(5000);

    expect(mockedUpdateMemo).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("保存済み");
  });

  it("変更を検知して 1 秒後に保存し、状態表示が保存中…から保存済みになる", async () => {
    await renderForAutosave(<MemoEditor initialMemo={makeMemo()} />);
    vi.useFakeTimers();

    fireEvent.change(screen.getByDisplayValue("Existing"), {
      target: { value: "Changed" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("保存中…");
    expect(mockedUpdateMemo).not.toHaveBeenCalled();

    await advance(1000);

    expect(mockedUpdateMemo).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ title: "Changed" }),
      undefined
    );
    expect(screen.getByRole("status")).toHaveTextContent("保存済み");
  });

  it("タイトルを空にすると title を送らず、placeholder に既存タイトルを出す", async () => {
    await renderForAutosave(<MemoEditor initialMemo={makeMemo()} />);
    vi.useFakeTimers();

    fireEvent.change(screen.getByDisplayValue("Existing"), {
      target: { value: "" },
    });
    expect(screen.getByPlaceholderText("Existing")).toBeInTheDocument();

    await advance(1000);

    const [, saved] = mockedUpdateMemo.mock.calls[0]!;
    expect(saved).not.toHaveProperty("title");
    expect(saved.body).toBe("plain body");
  });

  it("失敗すると保存に失敗（再試行）を出し、押すと再送する", async () => {
    mockedUpdateMemo.mockRejectedValueOnce(new Error("network error"));
    await renderForAutosave(<MemoEditor initialMemo={makeMemo()} />);
    vi.useFakeTimers();

    fireEvent.change(screen.getByDisplayValue("Existing"), {
      target: { value: "Changed" },
    });
    await advance(1000);

    const retry = screen.getByRole("button", { name: "保存に失敗（再試行）" });
    fireEvent.click(retry);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedUpdateMemo).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("保存済み");
  });

  it("新規メモは内容が入るまで作成せず、入ったら POST してボタンが保存に変わる", async () => {
    await renderForAutosave(<MemoEditor />);
    vi.useFakeTimers();

    await advance(5000);
    expect(mockedCreateMemo).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("タイトル（1行目）"), {
      target: { value: "New Memo" },
    });
    await advance(1000);

    expect(mockedCreateMemo).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Memo" }),
      undefined
    );
    expect(getSaveButton()).toHaveTextContent("保存");
  });

  it("新規メモでタイトルが空でも本文の先頭行を暫定タイトルとして送る", async () => {
    const user = userEvent.setup();
    await renderForAutosave(<MemoEditor />);

    // TipTap への入力は実タイマーで行い、1 秒のデバウンス後に保存されるのを待つ
    const editorEl = screen.getByLabelText("メモ本文");
    await user.click(editorEl);
    await user.type(editorEl, "body first line");

    await waitFor(
      () =>
        expect(mockedCreateMemo).toHaveBeenCalledWith(
          expect.objectContaining({ title: "body first line" }),
          undefined
        ),
      { timeout: 3000 }
    );
  });

  it("新規メモは作成後に内容を空にしても保存する", async () => {
    await renderForAutosave(<MemoEditor />);
    vi.useFakeTimers();

    fireEvent.change(screen.getByPlaceholderText("タイトル（1行目）"), {
      target: { value: "New Memo" },
    });
    await advance(1000);
    expect(mockedCreateMemo).toHaveBeenCalledTimes(1);

    mockedUpdateMemo.mockClear();
    fireEvent.change(screen.getByDisplayValue("New Memo"), {
      target: { value: "" },
    });
    await advance(1000);

    expect(mockedUpdateMemo).toHaveBeenCalledWith(
      "new-id",
      expect.objectContaining({ body: "" }),
      undefined
    );
  });

  it("作成中に保存ボタンを押しても二重に作成しない", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: { id: string }) => void) | undefined;
    mockedCreateMemo.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve;
        })
    );
    render(<MemoEditor />, { wrapper });
    await screen.findByPlaceholderText("タイトル（1行目）");

    await user.type(
      screen.getByPlaceholderText("タイトル（1行目）"),
      "New Memo"
    );
    await waitFor(() => expect(mockedCreateMemo).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });

    // 実行中の作成を待つだけで、二重に POST しない
    await user.click(getSaveButton());
    expect(mockedCreateMemo).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate?.({ id: "new-id" });
    });
    expect(mockedCreateMemo).toHaveBeenCalledTimes(1);
  });

  it("日記の保存失敗は onSaveError に draft 付きで渡す", async () => {
    const user = userEvent.setup();
    const onSaveError = vi.fn();
    mockedCreateDiary.mockRejectedValueOnce(
      new Error("Diary already exists for this date")
    );
    render(
      <MemoEditor isDiary initialEntryDate="2020-01-05" onSaveError={onSaveError} />,
      { wrapper }
    );
    await screen.findByLabelText("日付");

    await user.click(getSaveButton());

    await waitFor(() => expect(onSaveError).toHaveBeenCalled());
    const [error, draft] = onSaveError.mock.calls[0]!;
    expect((error as Error).message).toContain("already exists");
    expect(draft).toMatchObject({ entryDate: "2020-01-05" });
  });
});
