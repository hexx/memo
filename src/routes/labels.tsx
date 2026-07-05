import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getLabels, createLabel, deleteLabel } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

export const Route = createFileRoute("/labels")({
  component: LabelsPage,
});

function LabelsPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: labels, isLoading } = useQuery({
    queryKey: ["labels"],
    queryFn: getLabels,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createLabel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      setNewName("");
    },
    onError: (err) => alert(err instanceof Error ? err.message : "Error"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLabel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["labels"] }),
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">ラベル管理</h1>

      <div className="flex gap-2 mb-6 max-w-md">
        <Input
          placeholder="新しいラベル名"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
          <Plus className="h-4 w-4 mr-1" />
          追加
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">読み込み中...</p>}

      <div className="flex flex-wrap gap-2">
        {labels?.map((label) => (
          <Badge key={label.id} variant="secondary" className="text-sm py-1.5 px-3 gap-1">
            {label.name}
            <button
              onClick={() => {
                if (confirm(`ラベル「${label.name}」を削除しますか？`)) {
                  deleteMutation.mutate(label.id);
                }
              }}
              className="ml-1 hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {labels?.length === 0 && (
          <p className="text-muted-foreground">ラベルがありません。</p>
        )}
      </div>
    </div>
  );
}
