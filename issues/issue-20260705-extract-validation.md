---
title: "memos.ts の POST/PUT ハンドラで重複したバリデーションロジックを共通化"
status: TODO
created: 2026-07-05T12:00:00+09:00
---

# 課題解決プロンプト: memos.ts の POST/PUT ハンドラで重複したバリデーションロジックを共通化

## 1. 役割定義 (Persona)
あなたはコードの保守性と品質向上に詳しいバックエンドエンジニアです。

## 2. 背景・前提条件 (Context)
- **現状発生している問題**: `src/server/routes/memos.ts` の `POST /api/memos` と `PUT /api/memos/:id` に、title と body のバリデーションロジックが同一コードで重複しています。今後の変更時に両方を同期させる必要があり、保守性が低下しています。
- **再現手順**: `memos.ts` の POST ハンドラ (約 107 行目) と PUT ハンドラ (約 145 行目) を見ると、同じバリデーションコードが存在する。
- **関連ファイル/コード**: `src/server/routes/memos.ts`

## 3. 解決すべきゴール (Goal & Objective)
- [ ] バリデーションロジックを `src/server/lib/validation.ts` などの共有モジュールに抽出する
- [ ] POST と PUT の両方で抽出した関数を使用する
- [ ] バリデーションエラーのレスポンス形式を統一する（400 Bad Request + JSON）
- [ ] 既存の API 動作を壊さないこと

## 4. 期待する成果物 (Output Format)
- 新規ファイル `src/server/lib/validation.ts`
- 修正済みの `src/server/routes/memos.ts`
- テストまたは動作確認結果

## 5. 実行開始の合図
このプロンプトを意識したら、「タスクを開始します」と宣言し、直ちに関連ファイルの解析から始めてください。
