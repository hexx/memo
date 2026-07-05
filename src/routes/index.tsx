import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getMemos,
  getLabels,
  deleteMemo,
  togglePin,
  toggleArchive,
  importOrgText,
  importOrgFile,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemoEditor } from "@/components/MemoEditor";
import { Plus, Search, Pin, Archive, Trash2, MoreVertical, Upload, FileDown } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const { data: memos, isLoading } = useQuery({
    queryKey: ["memos", { q: search, label: selectedLabel }],
    queryFn: () => getMemos({ q: search || undefined, label: selectedLabel }),
  });

  const { data: labels } = useQuery({
    queryKey: ["labels"],
    queryFn: getLabels,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMemo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memos"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "削除に失敗しました"),
  });

  const pinMutation = useMutation({
    mutationFn: togglePin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memos"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "操作に失敗しました"),
  });

  const archiveMutation = useMutation({
    mutationFn: toggleArchive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memos"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "操作に失敗しました"),
  });

  const importMutation = useMutation({
    mutationFn: importOrgText,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      setImportOpen(false);
      setImportText("");
    },
    onError: (err) => alert(err instanceof Error ? err.message : "インポートに失敗しました"),
  });

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importOrgFile(file);
      queryClient.invalidateQueries({ queryKey: ["memos"] });
      setImportOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    }
    e.target.value = "";
  };

  const pinned = memos?.filter((m) => m.isPinned) ?? [];
  const unpinned = memos?.filter((m) => !m.isPinned) ?? [];

  return (
    <div>
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="メモを検索..."
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
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-1" />
                インポート
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>インポート</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    org ファイルをアップロード
                  </p>
                  <Input type="file" accept=".org,.txt" onChange={handleFileImport} />
                </div>
                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    またはテキストを貼り付け
                  </p>
                  <textarea
                    className="w-full min-h-[200px] border rounded-md p-3 text-sm font-mono"
                    placeholder="* TODO 買い物リスト"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <Button
                    className="mt-2"
                    onClick={() => importText.trim() && importMutation.mutate(importText)}
                    disabled={importMutation.isPending}
                  >
                    {importMutation.isPending ? "インポート中..." : "インポート"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                新規メモ
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>新規メモ</DialogTitle>
              </DialogHeader>
              <MemoEditor
                onSaved={() => {
                  setCreateOpen(false);
                  queryClient.invalidateQueries({ queryKey: ["memos"] });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">読み込み中...</p>}

      {/* ピン留めメモ */}
      {pinned.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1">
            <Pin className="h-3 w-3" /> ピン留め
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pinned.map((memo) => (
              <MemoCard
                key={memo.id}
                memo={memo}
                onDelete={() => deleteMutation.mutate(memo.id)}
                onTogglePin={() => pinMutation.mutate(memo.id)}
                onToggleArchive={() => archiveMutation.mutate(memo.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 通常メモ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {unpinned.map((memo) => (
          <MemoCard
            key={memo.id}
            memo={memo}
            onDelete={() => deleteMutation.mutate(memo.id)}
            onTogglePin={() => pinMutation.mutate(memo.id)}
            onToggleArchive={() => archiveMutation.mutate(memo.id)}
          />
        ))}
      </div>

      {memos?.length === 0 && (
        <p className="text-center text-muted-foreground py-12">
          メモがありません。「新規メモ」をクリックして作成してください。
        </p>
      )}
    </div>
  );
}

function MemoCard({
  memo,
  onDelete,
  onTogglePin,
  onToggleArchive,
}: {
  memo: Memo;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <div className="relative group border rounded-lg p-4 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start justify-between mb-2">
        <Link
          to="/memos/$memoId"
          params={{ memoId: memo.id }}
          className="font-medium text-sm line-clamp-2 hover:underline flex-1"
        >
          {memo.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity -mr-1"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onTogglePin}>
              <Pin className="h-4 w-4 mr-2" />
              {memo.isPinned ? "ピン留め解除" : "ピン留め"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleArchive}>
              <Archive className="h-4 w-4 mr-2" />
              アーカイブ
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(getExportUrl(memo.id))}>
              <FileDown className="h-4 w-4 mr-2" />
              エクスポート
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => {
                if (confirm("このメモを削除しますか？")) onDelete();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap mb-3">
        {memo.body.split("\n").slice(1).join("\n").substring(0, 200)}
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
