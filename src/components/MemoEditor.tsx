import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useImperativeHandle,
  type Ref,
} from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQuery } from "@tanstack/react-query";
import {
  getLabels,
  createLabel,
  createMemo,
  createDiary,
  updateMemo,
  generateTitle,
  type Memo,
  type SaveContext,
} from "@/lib/api";
import { useAutosave, type AutosaveStatus } from "@/lib/autosave";
import { docToOrg, orgToHtml } from "@/lib/org-serialize";
import { defaultDiaryTitle, todayInTokyo } from "@/lib/diaryDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  List,
  ListOrdered,
  Code,
  Link as LinkIcon,
  Quote,
  Sparkles,
} from "lucide-react";

/** 保存 API に渡す内容。title を省略したときは既存タイトルを維持する */
export interface MemoDraft {
  title?: string;
  body: string;
  labelIds: string[];
  entryDate?: string;
}

/** 親から保存の完了・破棄を制御するためのハンドル（ADR 0013） */
export interface MemoEditorHandle {
  /** 保留中の変更を保存し、完了を待つ。失敗したら false */
  flush: (options?: { force?: boolean }) => Promise<boolean>;
  /** 保留中の保存を捨て、実行中の保存の完了を待つ（破棄・削除時） */
  cancel: () => Promise<void>;
}

interface MemoEditorProps {
  initialMemo?: Memo;
  onSaved?: () => void;
  /** 保存に失敗したとき（日記の日付重複など、親が追加の導線を出すため） */
  onSaveError?: (error: Error, draft: MemoDraft) => void;
  /** 日記モード: 日付ピッカーを表示し、タイトルの既定値を日付にする */
  isDiary?: boolean;
  /** 新規日記の初期日付（未指定なら Asia/Tokyo の今日） */
  initialEntryDate?: string;
  ref?: Ref<MemoEditorHandle>;
}

/** 新規メモの暫定タイトル: 本文の先頭の非空行、無ければ「無題」 */
function provisionalTitle(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return "無題";
}

/** 現在の編集状態から保存内容を組み立てる */
function buildDraft(params: {
  title: string;
  body: string;
  labelIds: string[];
  entryDate: string | null;
  isDiary: boolean;
  isNew: boolean;
}): MemoDraft {
  const { title, body, labelIds, entryDate, isDiary, isNew } = params;
  const trimmed = title.trim();
  const date = isDiary ? entryDate : null;
  // 日記の空タイトルは日付の既定値、新規メモは本文の先頭行、既存メモは空のまま
  // （= title を送らず既存タイトルを維持する）にフォールバックする
  const effectiveTitle =
    trimmed || (date ? defaultDiaryTitle(date) : "") || (isNew ? provisionalTitle(body) : "");
  const draft: MemoDraft = { body, labelIds };
  if (effectiveTitle) draft.title = effectiveTitle;
  if (date) draft.entryDate = date;
  return draft;
}

export function MemoEditor({
  initialMemo,
  onSaved,
  onSaveError,
  isDiary = false,
  initialEntryDate,
  ref,
}: MemoEditorProps) {
  const initialDate =
    initialMemo?.entryDate ?? (isDiary ? initialEntryDate || todayInTokyo() : null);
  const [entryDate, setEntryDate] = useState(initialDate ?? "");
  const [title, setTitle] = useState(
    initialMemo?.title || (initialDate ? defaultDiaryTitle(initialDate) : "")
  );
  const [body, setBody] = useState(initialMemo?.body || "");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(
    initialMemo?.labels.map((l) => l.id) || []
  );
  const [newLabelName, setNewLabelName] = useState("");
  const [generating, setGenerating] = useState(false);
  // 保存済みのタイトル（タイトル欄が空のときの placeholder に使う）
  const [persistedTitle, setPersistedTitle] = useState(initialMemo?.title ?? "");
  const [persisted, setPersisted] = useState(!!initialMemo);
  const persistedRef = useRef(!!initialMemo);
  const memoIdRef = useRef<string | null>(initialMemo?.id ?? null);

  const { data: labels } = useQuery({
    queryKey: ["labels"],
    queryFn: getLabels,
  });

  const isNew = !initialMemo;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
    ],
    content: orgToHtml(initialMemo?.body || ""),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[300px] max-h-[60vh] overflow-y-auto rounded-md border border-input bg-background p-3 text-sm leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-ring prose-org",
        "aria-label": "メモ本文",
      },
    },
    onUpdate: ({ editor }) => {
      setBody(docToOrg(editor.getJSON()));
    },
  });

  const currentBody = editor ? docToOrg(editor.getJSON()) : body;

  const draft = useMemo(
    () =>
      buildDraft({
        title,
        body: currentBody,
        labelIds: selectedLabels,
        entryDate: isDiary ? entryDate || null : null,
        isDiary,
        isNew,
      }),
    [title, currentBody, selectedLabels, entryDate, isDiary, isNew]
  );

  // 新規で内容が入るまでは自動保存しない（開いただけでは作らない）。
  // 日記の既定タイトル（日付）は内容とみなさない。
  const hasUserTitle =
    title.trim() !== "" &&
    !(isDiary && entryDate !== "" && title.trim() === defaultDiaryTitle(entryDate));
  // 作成済みなら内容が空になっても保存する（新規で未作成の間だけ「内容が入るまで」待つ）
  const autosaveEnabled =
    !isNew || persisted || currentBody.trim() !== "" || hasUserTitle;

  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;

  const persist = useCallback(
    async (value: MemoDraft, context?: SaveContext) => {
      try {
        const memoId = memoIdRef.current;
        if (memoId) {
          await updateMemo(memoId, value, context);
        } else if (isDiary) {
          const created = await createDiary(value, context);
          memoIdRef.current = created.id;
          persistedRef.current = true;
          setPersisted(true);
          if (created.title) setPersistedTitle(created.title);
        } else {
          const created = await createMemo(
            { ...value, title: value.title ?? "無題" },
            context
          );
          memoIdRef.current = created.id;
          persistedRef.current = true;
          setPersisted(true);
        }
        if (value.title) setPersistedTitle(value.title);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onSaveErrorRef.current?.(error, value);
        throw error;
      }
    },
    [isDiary]
  );

  const autosave = useAutosave(draft, persist, {
    delayMs: 1000,
    enabled: autosaveEnabled,
  });

  useImperativeHandle(
    ref,
    () => ({
      flush: (options) => autosave.flush(options),
      cancel: () => autosave.cancel(),
    }),
    [autosave]
  );

  // 別メモへの切り替え時にエディタ内容を再同期し、自動保存のベースラインを合わせる
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(orgToHtml(initialMemo?.body || ""));
    setBody(initialMemo?.body || "");
    const nextDate = isDiary
      ? initialMemo?.entryDate ?? initialDate ?? todayInTokyo()
      : null;
    const nextTitle =
      initialMemo?.title || (nextDate ? defaultDiaryTitle(nextDate) : "");
    const nextLabels = initialMemo?.labels.map((l) => l.id) || [];
    setTitle(nextTitle);
    setEntryDate(nextDate ?? "");
    setSelectedLabels(nextLabels);
    setPersistedTitle(initialMemo?.title ?? "");
    persistedRef.current = !!initialMemo;
    setPersisted(!!initialMemo);
    memoIdRef.current = initialMemo?.id ?? null;
    autosave.reset(
      buildDraft({
        title: nextTitle,
        body: docToOrg(editor.getJSON()),
        labelIds: nextLabels,
        entryDate: nextDate,
        isDiary,
        isNew: !initialMemo,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, initialMemo?.id]);

  // 日付変更。タイトルが旧日付の既定値のまま（未編集）なら追従させる。
  const handleDateChange = (next: string) => {
    if (isDiary && entryDate && title === defaultDiaryTitle(entryDate)) {
      setTitle(next ? defaultDiaryTitle(next) : "");
    }
    setEntryDate(next);
  };

  const handleGenerateTitle = async () => {
    const targetBody = editor ? docToOrg(editor.getJSON()) : body;
    if (!targetBody.trim()) {
      alert("本文を入力してください");
      return;
    }
    setGenerating(true);
    try {
      const { title: gen } = await generateTitle(targetBody);
      if (gen) {
        setTitle(gen);
      } else {
        alert(
          "タイトルの自動生成が利用できません（OPENCODE_GO_* 環境変数の設定を確認してください）"
        );
      }
    } catch {
      alert("タイトルの生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  // 明示的な保存。保留分を送り終えてから onSaved（ダイアログを閉じる等）を呼ぶ。
  // 失敗したときは画面に留まり、保存状態の表示に失敗を出す。
  const handleSave = async () => {
    const ok = await autosave.flush({ force: !persistedRef.current });
    if (ok) onSaved?.();
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    try {
      const label = await createLabel(newLabelName.trim());
      setSelectedLabels([...selectedLabels, label.id]);
      setNewLabelName("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "ラベルの作成に失敗しました");
    }
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId]
    );
  };

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("リンク先URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const trimmed = url.trim();
    // 安全でないスキーマ (javascript: 等) を除外して XSS を防止
    if (!/^(https?:|mailto:)/i.test(trimmed)) {
      alert("http(s):// または mailto: で始まるURLのみ許可されます");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  };

  // 主ボタンの有効条件。既存メモは常に押せる（無変更なら何も起きない）
  const canSubmit =
    !isNew ||
    persisted ||
    (isDiary ? entryDate !== "" : title.trim() !== "" || currentBody.trim() !== "");
  const titlePlaceholder =
    !isNew && title.trim() === "" && persistedTitle
      ? persistedTitle
      : "タイトル（1行目）";

  return (
    <div className="space-y-4">
      {isDiary && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="diary-entry-date"
            className="text-sm text-muted-foreground"
          >
            日付
          </label>
          <Input
            id="diary-entry-date"
            type="date"
            value={entryDate}
            max={todayInTokyo()}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-auto"
            required
          />
        </div>
      )}
      <div className="flex gap-2">
        <Input
          placeholder={titlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg font-medium flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleGenerateTitle}
          disabled={generating || !body.trim()}
          title="本文からタイトルをAIで生成"
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {generating ? "生成中..." : "AIで生成"}
        </Button>
      </div>

      {editor && (
        <EditorToolbar
          editor={editor}
          onSetLink={setLink}
        />
      )}

      <EditorContent editor={editor} />

      {/* ラベル */}
      <div>
        <p className="text-sm text-muted-foreground mb-2">ラベル</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {labels?.map((label) => {
            const isSelected = selectedLabels.includes(label.id);
            return (
              <Badge
                key={label.id}
                variant={isSelected ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleLabel(label.id)}
              >
                {label.name}
              </Badge>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="新しいラベル名"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateLabel()}
            className="max-w-[200px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateLabel}
            disabled={!newLabelName.trim()}
          >
            作成
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4">
        {(persisted || autosave.status !== "saved") && (
          <AutosaveIndicator
            status={autosave.status}
            onRetry={autosave.retry}
          />
        )}
        <Button onClick={handleSave} disabled={!canSubmit}>
          {isNew && !persisted ? "作成" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/** 保存状態の表示（ADR 0013）。失敗のときは再試行できる */
function AutosaveIndicator({
  status,
  onRetry,
}: {
  status: AutosaveStatus;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-destructive underline underline-offset-2"
      >
        保存に失敗（再試行）
      </button>
    );
  }
  return (
    <span role="status" className="text-sm text-muted-foreground">
      {status === "saving" ? "保存中…" : "保存済み"}
    </span>
  );
}

/**
 * WYSIWYG ツールバー。
 * - タップ（スマホ）でも操作できるボタン群
 * - PC ではボタンに加え、エディタのキーボードショートカット（Mod-B 等）も併用可能
 */
function EditorToolbar({
  editor,
  onSetLink,
}: {
  editor: Editor;
  onSetLink: () => void;
}) {
  const btn = (active: boolean) =>
    `h-8 w-8 p-0 inline-flex items-center justify-center rounded ${
      active
        ? "bg-secondary text-secondary-foreground"
        : "text-muted-foreground hover:bg-secondary/60"
    }`;

  const chain = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-muted/40 p-1 sticky top-0 z-10">
      <select
        className="h-8 rounded border border-input bg-background px-2 text-sm"
        value={
          editor.isActive("heading", { level: 1 })
            ? "1"
            : editor.isActive("heading", { level: 2 })
            ? "2"
            : editor.isActive("heading", { level: 3 })
            ? "3"
            : "0"
        }
        onChange={(e) => {
          const v = e.target.value;
          if (v === "0") chain().setParagraph().run();
          else chain().toggleHeading({ level: Number(v) as 1 | 2 | 3 }).run();
        }}
        aria-label="見出しレベル"
      >
        <option value="0">本文</option>
        <option value="1">見出し 1</option>
        <option value="2">見出し 2</option>
        <option value="3">見出し 3</option>
      </select>

      <span className="mx-1 h-5 w-px bg-border" />

      <button
        type="button"
        className={btn(editor.isActive("bold"))}
        onClick={() => chain().toggleBold().run()}
        aria-label="太字"
        title="太字 (Ctrl/Cmd+B)"
      >
        <Bold className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("italic"))}
        onClick={() => chain().toggleItalic().run()}
        aria-label="イタリック"
        title="イタリック (Ctrl/Cmd+I)"
      >
        <Italic className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("underline"))}
        onClick={() => chain().toggleUnderline().run()}
        aria-label="下線"
        title="下線 (Ctrl/Cmd+U)"
      >
        <Underline className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("strike"))}
        onClick={() => chain().toggleStrike().run()}
        aria-label="取り消し線"
        title="取り消し線 (Ctrl/Cmd+Shift+S)"
      >
        <Strikethrough className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("link"))}
        onClick={onSetLink}
        aria-label="リンク"
        title="リンク"
      >
        <LinkIcon className="h-4 w-4" />
      </button>

      <span className="mx-1 h-5 w-px bg-border" />

      <button
        type="button"
        className={btn(editor.isActive("bulletList"))}
        onClick={() => chain().toggleBulletList().run()}
        aria-label="箇条書き"
        title="箇条書き (Ctrl/Cmd+Shift+8)"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("orderedList"))}
        onClick={() => chain().toggleOrderedList().run()}
        aria-label="番号付きリスト"
        title="番号付きリスト (Ctrl/Cmd+Shift+9)"
      >
        <ListOrdered className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("blockquote"))}
        onClick={() => chain().toggleBlockquote().run()}
        aria-label="引用"
        title="引用"
      >
        <Quote className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btn(editor.isActive("codeBlock"))}
        onClick={() => chain().toggleCodeBlock().run()}
        aria-label="コードブロック"
        title="コードブロック (Ctrl/Cmd+Alt+C)"
      >
        <Code className="h-4 w-4" />
      </button>
    </div>
  );
}
