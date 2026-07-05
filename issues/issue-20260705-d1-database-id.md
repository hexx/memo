---
title: "wrangler.toml の database_id を本番用 UUID に置き換える"
status: TODO
created: 2026-07-05T12:00:00+09:00
---

# 課題解決プロンプト: wrangler.toml の database_id を本番用 UUID に置き換える

## 1. 役割定義 (Persona)
あなたは Cloudflare Workers のデプロイに詳しいインフラエンジニアです。

## 2. 背景・前提条件 (Context)
- **現状発生している問題**: `wrangler.toml` の `database_id = "local"` はローカル開発用のプレースホルダーです。本番デプロイ (`wrangler deploy`) 時にエラーになります。
- **再現手順**: `wrangler deploy` を実行すると D1 database_id が無効であるというエラーが発生する。
- **関連ファイル/コード**: `wrangler.toml`

## 3. 解決すべきゴール (Goal & Objective)
- [ ] Cloudflare ダッシュボードまたは CLI で D1 データベースを作成する: `wrangler d1 create org-memo-db`
- [ ] 発行された UUID を `wrangler.toml` の `database_id` に設定する
- [ ] 本番環境で D1 マイグレーションを適用する: `wrangler d1 migrations apply org-memo-db`
- [ ] ローカル開発用には `[env.dev]` セクションなどで `database_id = "local"` を維持することを検討する

## 4. 期待する成果物 (Output Format)
- 修正済みの `wrangler.toml`
- デプロイ成功の確認

## 5. 実行開始の合図
このプロンプトを意識したら、「タスクを開始します」と宣言し、まず `wrangler d1 create org-memo-db` を実行してください。
