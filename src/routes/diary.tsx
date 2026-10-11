import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  getDiaries,
  getLabels,
  deleteMemo,
  toggleArchive,
  getExportUrl,
  type Memo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MemoEditor,
  type MemoDraft,
  type MemoEditorHandle,
} from "@/components/MemoEditor";
import { Search, Archive, Trash2, MoreVertical, FileDown, PenLine } from "lucide-react";
import { todayInTokyo } from "@/lib/diaryDate";

export const Route = createFileRoute("/diary")({
  component: DiaryPage,
});

function DiaryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  // 日付が重複したときに「既存の日記を開く」導線を出すための id
  const [duplicateDiaryId, setDuplicateDiaryId] = useState<string | null>(null);
  const editorRef = useRef<MemoEditorHandle>(null);
  const today = todayInTokyo();

  const { data: diaries, isLoading } = useQuery({
    queryKey: ["memos", { diary: "only", q: search, label: selectedLabel }],
    queryFn: () => getDiaries({ q: search || undefined, label: selectedLabel }),
  });

  const { data: labels } = useQuery({
    queryKey: ["labels"],
    queryFn: getLabels,
  });

  const invalidateMemos = () =>
    queryClient.invalidateQueries({ queryKey: ["memos"] });

  const deleteMutation = useMutation({
    mutationFn: deleteMemo,
    onSuccess: invalidateMemos,
    onError: (err) => alert(err instanceof Error ? err.message : "削除に失敗しました"),
  });

  const archiveMutation = useMutation({
    mutationFn: toggleArchive,
    onSuccess: invalidateMemos,
    onError: (err) => alert(err instanceof Error ? err.message : "操作に失敗しました"),
  });

  // 保存に失敗したときの導線。日付が重複したら既存の日記を提示する（自動遷移はしない）
  const handleSaveError = useCallback(async (err: Error, draft: MemoDraft) => {
    if (!err.message.includes("already exists") || !draft.entryDate) return;
    try {
      // アーカイブ済みの日記も日付を占有しているため、archived も含めて検索する
      const existing = await getDiaries({
        date: draft.entryDate,
        archived: true,
      });
      setDuplicateDiaryId(existing.length > 0 ? existing[0].id : null);
    } catch {
      setDuplicateDiaryId(null);
    }
  }, []);

  const closeCreateDialog = async () => {
    const editor = editorRef.current;
    if (editor) {
      const ok = await editor.flush();
      if (!ok) {
        if (!confirm("保存できていません。破棄しますか？")) return;
        editor.cancel();
      }
    }
    setCreateOpen(false);
    setDuplicateDiaryId(null);
    invalidateMemos();
  };

  const openDuplicateDiary = () => {
    if (!duplicateDiaryId) return;
    editorRef.current?.cancel();
    setCreateOpen(false);
    setDuplicateDiaryId(null);
    navigate({ to: "/memos/$memoId", params: { memoId: duplicateDiaryId } });
  };

  // 画面（作成ダイアログを含む）を離れるときに一覧を更新する
  useEffect(
    () => () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
    },
    [queryClient]
  );

  // 「日記を書く」: 今日の日記が既にあればそれを開き、なければ作成ダイアログを開く
  const handleWrite = async () => {
    try {
      // アーカイブ済みの日記も日付を占有しているため、 archived も含めて検索する
      const existing = await getDiaries({ date: today, archived: true });
      if (existing.length > 0) {
        navigate({ to: "/memos/$memoId", params: { memoId: existing[0].id } });
        return;
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作に失敗しました");
      return;
    }
    setDuplicateDiaryId(null);
    setCreateOpen(true);
  };

  return (
    <div>
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="日記を検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={!selectedLabel ? "secondary" : "outline"}
            size="sm"
            onClick={() => setSelectedLabel(undefined)}
          >
            すべて
          </Button>
          {labels?.map((label) => (
            <Button
              key={label.id}
              variant={selectedLabel === label.id ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelectedLabel(
                  selectedLabel === label.id ? undefined : label.id
                )
              }
            >
              {label.name}
            </Button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          <Button size="sm" onClick={handleWrite}>
            <PenLine className="h-4 w-4 mr-1" />
            日記を書く
          </Button>
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open) setCreateOpen(true);
          else void closeCreateDialog();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>日記を書く</DialogTitle>
          </DialogHeader>
          <MemoEditor
            ref={editorRef}
            isDiary
            initialEntryDate={today}
            onSaved={closeCreateDialog}
            onSaveError={handleSaveError}
          />
          {duplicateDiaryId && (
            <p className="text-sm text-muted-foreground">
              この日付の日記はすでにあります。{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={openDuplicateDiary}
              >
                既存の日記を開く
              </button>
            </p>
          )}
        </DialogContent>
      </Dialog>

      {isLoading && <p className="text-muted-foreground">読み込み中...</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {diaries?.map((diary) => (
          <DiaryCard
            key={diary.id}
            memo={diary}
            onDelete={() => {
              if (confirm("この日記を削除しますか？")) {
                deleteMutation.mutate(diary.id);
              }
            }}
            onArchive={() => archiveMutation.mutate(diary.id)}
          />
        ))}
      </div>

      {diaries?.length === 0 && !isLoading && (
        <p className="text-center text-muted-foreground py-12">
          日記はまだありません。「日記を書く」から始めましょう。
        </p>
      )}
    </div>
  );
}

function DiaryCard({
  memo,
  onDelete,
  onArchive,
}: {
  memo: Memo;
  onDelete: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="relative group border rounded-lg p-4 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">
          {memo.entryDate}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity -mr-1 -mt-1"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.open(getExportUrl(memo.id))}>
              <FileDown className="h-4 w-4 mr-2" />
              エクスポート
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchive}>
              <Archive className="h-4 w-4 mr-2" />
              アーカイブ
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link
        to="/memos/$memoId"
        params={{ memoId: memo.id }}
        className="font-medium text-sm line-clamp-2 hover:underline block mb-2"
      >
        {memo.title}
      </Link>

      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap mb-3">
        {memo.body.substring(0, 200)}
      </p>

      {memo.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {memo.labels.map((label) => (
            <Badge key={label.id} variant="secondary" className="text-xs">
              {label.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}