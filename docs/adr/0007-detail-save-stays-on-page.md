# メモ詳細画面の保存後は画面に留まり、ホームへは遷移しない

## Status

Accepted（2026-07-25 発覚、本 ADR で確定）

## Context

`src/routes/memos/$memoId.tsx`（メモ詳細/編集画面）は `MemoEditor` に `onSave` と `onSaved` の両方を渡していた。しかし `MemoEditor.handleSave` は `onSave` が渡されているとそれを呼んで即 `return` するため、`onSaved`（`navigate({ to: "/" })`）は**決して発火しない**デッドコードだった。結果、詳細画面で「保存」を押すと `updateMemo` は実行されるがユーザーは編集画面に留まる。

ADR 0006 のテスト拡充作業で実メモリルーター経由の統合テストを書いた際に露出し、当座は現状挙動（保存→留まる）をテストに固定していた（`src/routes/__tests__/memoId.test.tsx`）。

## Decision

**「詳細画面の保存後は画面に留まる」を正式な仕様として確定**し、発火しない `onSaved` prop を `$memoId.tsx` から削除する（案 A）。保存後のホーム遷移は実装しない（案 B は不採用）。

## Rationale

- 詳細/編集画面には明示的な「← 戻る」ボタンがあり、ホームへ戻る手段は確保されている
- 保存後に留まることで連続編集（追記・修正の反復）が可能で、編集画面として自然な UX
- 削除時のみ `onSuccess` でホームへ遷移するのは「リソースが消滅するため」であり、保存とは意味が異なる。この対比は意図的
- 案 B（`updateMutation.onSuccess` に `navigate` を追加）は、保存のたびにホームへ戻され連続編集が阻害される
- 既存のテスト契約（ADR 0006 で固定済み）と一致し、最小変更で済む

## Consequences

- `$memoId.tsx` の `MemoEditor` 呼び出しから `onSaved` prop を削除。`onSaved` は新規作成経路（`routes/index.tsx` の作成ダイアログ）専用の prop として残る
- `MemoEditor` の `onSaved` prop 自体は削除しない（作成経路で実際に発火しているため）
- 挙動は `src/routes/__tests__/memoId.test.tsx`「保存すると updateMemo が呼ばれ、編集画面に留まる」で固定する

## Considered Options

- **案 A（採用）: 現状維持・デッドコード削除** — 「保存後は留まる」を仕様化し `onSaved` を削除
- **案 B（却下）: 遷移を実装** — `updateMutation.onSuccess` に `navigate({ to: "/" })` を追加。保存のたびにホームへ戻り連続編集が阻害されるため不採用
