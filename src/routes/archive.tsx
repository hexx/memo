import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMemos, toggleArchive, deleteMemo, type Memo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Archive, Trash2, Undo2 } from "lucide-react";

export const Route = createFileRoute("/archive")({
  component: ArchivePage,
});

function ArchivePage() {
  const queryClient = useQueryClient();

  const { data: memos, isLoading } = useQuery({
    queryKey: ["memos", { archived: true }],
    queryFn: () => getMemos({ archived: true }),
  });

  const unarchiveMutation = useMutation({
    mutationFn: toggleArchive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memos"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "操作に失敗しました"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMemo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memos"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "削除に失敗しました"),
  });

  if (isLoading) return <p className="text-muted-foreground">読み込み中...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Archive className="h-5 w-5" />
        アーカイブ
      </h1>

      {memos?.length === 0 && (
        <p className="text-center text-muted-foreground py-12">
          アーカイブされたメモはありません。
        </p>
      )}

      <div className="space-y-3">
        {memos?.map((memo) => (
          <ArchiveMemoCard
            key={memo.id}
            memo={memo}
            onUnarchive={() => unarchiveMutation.mutate(memo.id)}
            onDelete={() => {
              if (confirm("このメモを完全に削除しますか？")) {
                deleteMutation.mutate(memo.id);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ArchiveMemoCard({
  memo,
  onUnarchive,
  onDelete,
}: {
  memo: Memo;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between border rounded-lg p-4 bg-card">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{memo.title}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(memo.updatedAt).toLocaleDateString("ja-JP")}
        </p>
      </div>
      <div className="flex gap-2 ml-4">
        <Button variant="outline" size="sm" onClick={onUnarchive}>
          <Undo2 className="h-4 w-4 mr-1" />
          戻す
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} aria-label="メモを完全に削除">
          <Trash2 className="h-4 w-4 mr-1" />
          削除
        </Button>
      </div>
    </div>
  );
}
