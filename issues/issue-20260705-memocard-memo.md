---
title: "MemoCard に React.memo を適用してレンダリングを最適化"
status: TODO
created: 2026-07-05T12:00:00+09:00
---

# 課題解決プロンプト: MemoCard に React.memo を適用してレンダリングを最適化

## 1. 役割定義 (Persona)
あなたは React のパフォーマンス最適化に詳しいフロントエンドエンジニアです。

## 2. 背景・前提条件 (Context)
- **現状発生している問題**: `src/routes/index.tsx` の `MemoCard` コンポーネントが素の関数コンポーネントとして定義されており、親の `HomePage` が再レンダリングされるたびに全 MemoCard も再レンダリングされます。コールバック (`onDelete`, `onTogglePin`, `onToggleArchive`) が毎回新しいインライン関数として生成されるため、`React.memo` を適用しても意味がありません。
- **再現手順**: 任意のメモに対して操作（ピン留めなど）を行うと、すべての MemoCard が再レンダリングされる。
- **関連ファイル/コード**: `src/routes/index.tsx` の `MemoCard` 関数と `HomePage` 内のコールバック。

## 3. 解決すべきゴール (Goal & Objective)
- [ ] `MemoCard` を `React.memo` でラップする
- [ ] 親コンポーネントのコールバックを `useCallback` で安定化する（または `useMutation` の `mutate` を直接渡す）
- [ ] 大量メモ表示時のレンダリングパフォーマンスを改善する
- [ ] 既存の UI 動作を壊さないこと

## 4. 期待する成果物 (Output Format)
- 修正済みの `src/routes/index.tsx`
- パフォーマンス改善前後の比較（React DevTools の Profiler など）

## 5. 実行開始の合図
このプロンプトを意識したら、「タスクを開始します」と宣言し、直ちに関連ファイルの解析から始めてください。
