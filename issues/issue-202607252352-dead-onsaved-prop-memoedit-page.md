---
title: "メモ詳細画面の onSaved prop がデッドコード（保存後の遷移が発火しない）"
status: DONE
resolved: 2026-07-25T00:00:00+09:00
resolution: "案 A（現状維持・デッドコード削除）を採用。ADR 0007 で確定"
created: 2026-07-25T23:52:59+09:00
---

# メモ詳細画面の onSaved prop がデッドコード（保存後の遷移が発火しない）

## 背景・前提条件 (Context)

### 期待される挙動 vs 実際の挙動

- **期待**: `src/routes/memos/$memoId.tsx`（メモ詳細/編集画面）が MemoEditor に渡している `onSaved={() => navigate({ to: "/" })}` が、保存成功後に発火してホームへ遷移する——**あるいは**、画面に留まるのが意図した挙動なら、この prop は削除されているべき
- **実際**: `MemoEditor` の `handleSave` は `onSave` prop が渡されているとそれを呼んで即 `return` するため、`onSaved` は**決して発火しない**。詳細画面で「保存」を押すと `updateMemo` は実行されるが、ユーザーは編集画面に留まる。`onSaved` prop はデッドコードになっている

### エラーログ / スタックトレース

なし（クラッシュではなく、未発火のコールバック/デッドコードの問題）。

### 再現手順

1. `npm run dev` でアプリを起動し、任意のメモ詳細画面（`/memos/:id`）を開く
2. タイトル等を変更して「保存」ボタンを押す
3. 保存は成功する（`PUT /api/memos/:id` が 200 を返す）が、ホーム（`/`）へ遷移せず編集画面に留まる

コードレベルでの確認:

1. `npx vitest run src/routes/__tests__/memoId.test.tsx` を実行する
2. テスト「保存すると updateMemo が呼ばれ、編集画面に留まる」が、保存後も `router.state.location.pathname === "/memos/abc"` であることを固定している（現状挙動の証跡）

### 環境情報

- OS: Linux（CI: ubuntu-latest）/ 開発環境不問
- 言語/ランタイム: Node.js 24、TypeScript、React 19、TanStack Router/Query、Hono
- 起動方法: `npm run dev`（API: wrangler dev / Web: vite）

### 関連ファイル / コード

- `src/components/MemoEditor.tsx` — `handleSave`。`onSave` が存在すると短絡し、`onSaved` は createMemo 経路でしか呼ばれない:

```ts
const handleSave = async () => {
  if (!title.trim()) return;

  const currentBody = editor ? docToOrg(editor.getJSON()) : body;

  if (onSave) {
    onSave({ title: title.trim(), body: currentBody, labelIds: selectedLabels });
    return; // ← ここで return するため onSaved は呼ばれない
  }

  try {
    await createMemo({
      title: title.trim(),
      body: currentBody,
      labelIds: selectedLabels,
    });
    onSaved?.(); // ← 新規作成（onSave 未指定）経路でのみ発火
  } catch (err) {
    alert(err instanceof Error ? err.message : "保存に失敗しました");
  }
};
```

- `src/routes/memos/$memoId.tsx` — 詳細画面は `onSave` と `onSaved` の**両方**を渡している。`onSaved`（遷移）は発火せず、`updateMutation.onSuccess` にも遷移はない:

```tsx
const updateMutation = useMutation({
  mutationFn: (data: { title: string; body: string; labelIds?: string[] }) =>
    updateMemo(memoId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["memos"] });
    queryClient.invalidateQueries({ queryKey: ["memo", memoId] });
    // navigate は無い
  },
  onError: (err) => alert(err instanceof Error ? err.message : "保存に失敗しました"),
});

// ...

<MemoEditor
  initialMemo={memo}
  onSaved={() => {
    navigate({ to: "/" }); // ← 決して発火しないデッドコード
  }}
  saving={updateMutation.isPending}
  onSave={(data) => updateMutation.mutate(data)}
/>
```

- `src/routes/__tests__/memoId.test.tsx` — 現状挙動（保存→留まる）を固定しているテスト:

```ts
it("保存すると updateMemo が呼ばれ、編集画面に留まる", async () => {
  // ...
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(mockedUpdateMemo).toHaveBeenCalledWith("abc", expect.objectContaining({ /* ... */ }))
  );
  // 詳細画面での保存は遷移しない（onSave が onSaved を短絡するため）。
  expect(router.state.location.pathname).toBe("/memos/abc");
});
```

### 試したが駄目だったこと

- なし（2026-07-25 のテスト拡充作業（ADR 0006）で発覚。挙動を修正せず現状の契約としてテストに固定した）

## 解決すべきゴール (Goal)

まず**意図した挙動を確定**し、コードとテストを一致させる。二者択一:

- [x] **案 A（現状維持・デッドコード削除）**: 「詳細画面の保存後は画面に留まる」を正式な仕様と確定し、`$memoId.tsx` から発火しない `onSaved` prop を削除する。必要なら CONTEXT.md か ADR に「詳細画面の保存は遷移しない」と明記する（→ ADR 0007）
- [ ] **案 B（遷移を実装）**: 不採用
- [x] どちらの案でも、`src/routes/__tests__/memoId.test.tsx` の「保存すると updateMemo が呼ばれ、編集画面に留まる」テストを選択した挙動に合わせて更新する（案 A により現状維持。不正確なヘッダコメントを修正）
- [x] 既存の他テストを壊さないこと（132/132 通過）

### 完了条件（検証方法）

- `npm test` が緑（全テスト通過）
- `npx oxlint src` がクリーン（exit 0）
- `npm run build` が成功
- `$memoId.tsx` に発火しない `onSaved` prop が残っていない（`grep -n "onSaved" src/routes/memos/\$memoId.tsx` で、削除済みなら出力なし、案 B でも mutation 経由に統一済み）
- 選択した挙動がテストで固定されている

## 補足

- 新規作成経路（`routes/index.tsx` の作成ダイアログ）では `onSaved` は**実際に発火**している（ダイアログを閉じてメモ一覧を再取得）。デッドコードになっているのは詳細画面（`$memoId.tsx`）の渡し方のみ
- 発見の経緯: ADR 0006（テスト coverage 境界）に基づく UI テスト追加で、実メモリルーター経由の統合テストを書いた際に露出した
