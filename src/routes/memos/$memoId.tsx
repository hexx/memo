import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMemo, updateMemo, deleteMemo } from "@/lib/api";
import { MemoEditor } from "@/components/MemoEditor";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/memos/$memoId")({
  component: MemoEditPage,
});

function MemoEditPage() {
  const { memoId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: memo, isLoading } = useQuery({
    queryKey: ["memo", memoId],
    queryFn: () => getMemo(memoId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { title: string; body: string; labelIds?: string[] }) =>
      updateMemo(memoId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      queryClient.invalidateQueries({ queryKey: ["memo", memoId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemo(memoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      navigate({ to: "/" });
    },
  });

  if (isLoading) return <p className="text-muted-foreground">読み込み中...</p>;
  if (!memo) return <p className="text-muted-foreground">メモが見つかりません。</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={() => navigate({ to: "/" })}>
          ← 戻る
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm("削除しますか？")) deleteMutation.mutate();
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          削除
        </Button>
      </div>
      <MemoEditor
        initialMemo={memo}
        onSaved={() => {
          navigate({ to: "/" });
        }}
        saving={updateMutation.isPending}
        onSave={(data) => updateMutation.mutate(data)}
      />
    </div>
  );
}
