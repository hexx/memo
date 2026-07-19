import { useState, useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQuery } from "@tanstack/react-query";
import { getLabels, createLabel, createMemo, generateTitle, type Memo } from "@/lib/api";
import { docToOrg, orgToHtml } from "@/lib/org-serialize";
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

interface MemoEditorProps {
  initialMemo?: Memo;
  onSaved?: () => void;
  saving?: boolean;
  onSave?: (data: {
    title: string;
    body: string;
    labelIds?: string[];
  }) => void;
}

export function MemoEditor({
  initialMemo,
  onSaved,
  saving,
  onSave,
}: MemoEditorProps) {
  const [title, setTitle] = useState(initialMemo?.title || "");
  const [body, setBody] = useState(initialMemo?.body || "");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(
    initialMemo?.labels.map((l) => l.id) || []
  );
  const [newLabelName, setNewLabelName] = useState("");
  const [generating, setGenerating] = useState(false);

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
          "min-h-[300px] max-h-[60vh] overflow-y-auto rounded-md border border-input bg-background p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring prose-org",
        "aria-label": "メモ本文",
      },
    },
    onUpdate: ({ editor }) => {
      setBody(docToOrg(editor.getJSON()));
    },
  });

  // 別メモへの切り替え時にエディタ内容を再同期する
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(orgToHtml(initialMemo?.body || ""));
    setBody(initialMemo?.body || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, initialMemo?.id]);

  const handleGenerateTitle = async () => {
    const currentBody = editor ? docToOrg(editor.getJSON()) : body;
    if (!currentBody.trim()) {
      alert("本文を入力してください");
      return;
    }
    setGenerating(true);
    try {
      const { title: gen } = await generateTitle(currentBody);
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

  const handleSave = async () => {
    if (!title.trim()) return;

    const currentBody = editor ? docToOrg(editor.getJSON()) : body;

    if (onSave) {
      onSave({ title: title.trim(), body: currentBody, labelIds: selectedLabels });
      return;
    }

    try {
      await createMemo({
        title: title.trim(),
        body: currentBody,
        labelIds: selectedLabels,
      });
      onSaved?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存に失敗しました");
    }
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

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="タイトル（1行目）"
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

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={handleSave} disabled={saving || !title.trim()}>
          {saving ? "保存中..." : isNew ? "作成" : "保存"}
        </Button>
      </div>
    </div>
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
