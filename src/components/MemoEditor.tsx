import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLabels, createLabel, createMemo, type Memo, type Label } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

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

  const { data: labels } = useQuery({
    queryKey: ["labels"],
    queryFn: getLabels,
  });

  const isNew = !initialMemo;

  const handleSave = async () => {
    if (!title.trim()) return;

    if (onSave) {
      onSave({ title: title.trim(), body, labelIds: selectedLabels });
      return;
    }

    try {
      await createMemo({
        title: title.trim(),
        body,
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

  return (
    <div className="space-y-4">
      <div>
        <Input
          placeholder="タイトル（1行目）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg font-medium"
        />
      </div>

      <div>
        <Textarea
          placeholder="本文（org記法）"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[300px] font-mono text-sm"
        />
      </div>

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
