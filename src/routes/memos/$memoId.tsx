import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getMemo, deleteMemo } from "@/lib/api";
import { MemoEditor, type MemoEditorHandle } from "@/components/MemoEditor";
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
  const editorRef = useRef<MemoEditorHandle>(null);

  const { data: memo, isLoading, error } = useQuery({
    queryKey: ["memo", memoId],
    queryFn: () => getMemo(memoId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemo(memoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      // 日記は日記ビューへ戻す（通常メモはホーム）
      navigate({ to: memo?.entryDate ? "/diary" : "/" });
    },
    onError: (err) => alert(err instanceof Error ? err.message : "削除に失敗しました"),
  });

  // 画面を離れるときに一覧・詳細のキャッシュを更新する（staleTime があるため
  // 再マウントだけでは新しい内容にならない）。保存のたびではなく離脱時に 1 回だけ行う。
  useEffect(
    () => () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      queryClient.invalidateQueries({ queryKey: ["memo", memoId] });
    },
    [queryClient, memoId]
  );

  // 保留中のオートセーブを送り終えてから離脱する。失敗したら留まって状態表示に出す。
  const handleBack = async () => {
    const ok = await editorRef.current?.flush();
    if (ok === false) return;
    navigate({ to: memo?.entryDate ? "/diary" : "/" });
  };

  if (isLoading) return <p className="text-muted-foreground">読み込み中...</p>;
  if (error) return <p className="text-destructive">エラー: {(error as Error).message}</p>;
  if (!memo) return <p className="text-muted-foreground">メモが見つかりません。</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={handleBack}>
          ← 戻る
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm("削除しますか？")) {
              // 削除と競合しないよう、保留中・実行中のオートセーブを止める
              editorRef.current?.cancel();
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          削除
        </Button>
      </div>
      {/* 詳細画面の保存後は画面に留まる（ADR 0007）。保存は MemoEditor のオートセーブ（ADR 0013）
          が担い、ここでは onSave / onSaved を渡さない。 */}
      <MemoEditor
        ref={editorRef}
        initialMemo={memo}
        isDiary={memo.entryDate !== null}
      />
    </div>
  );
}
