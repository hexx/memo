# スキーマ反映をデプロイ手順に組み込み、実値（account_id / database_id）をコミットする

## Status

Accepted（2026-09-26）

**ADR 0008 の「要確認 5」を覆す**: 実 UUID はリポジトリに記載せず `database_id = "local"` のままとする決定を撤回し、実値をコミットする。

## Context

本番反映を Cloudflare Workers Builds に一本化する（ADR 0011）にあたり、2 つの問題が生じた。

1. `wrangler.toml` の `database_id = "local"` はローカル開発用の記法で、`wrangler deploy` はこの値をそのまま API へ送信するため **code 10021 で失敗する**。Workers Builds のビルド環境にローカルの書き換え手順は持ち込めない。
2. `wrangler d1 migrations apply --remote` は `database_id` の明示が必須（`d1` サブコマンドの名前解決に頼れない）で、プレースホルダのままでは解決できない。

また、マイグレーション適用を人手に残す案は「忘れる」経路を消せない。適用がコードの反映より先に走るため、未適用のまま新コードが動くと全 INSERT が失敗する事故（実際に他プロジェクトで数か月未適用が放置された事例がある）につながる。

## Decision

- **`npm run deploy` を「ガード → マイグレーション適用 → デプロイ」の順にする。**
  ```json
  "deploy": "node scripts/deploy-guard.mjs && wrangler d1 migrations apply org-memo-db --remote && wrangler deploy"
  ```
- **`account_id` / `database_id` の実値を `wrangler.toml` にコミットする。** どちらも識別子であり認証情報ではない（ADR 0008 自身が明記していた通り）。Cloudflare ダッシュボードの deploy command には `npm run deploy` だけを設定し、長いコマンドを直書きしない（ダッシュボードはリポジトリから見えず、乖離しても気づけないため）。
- **スキーマ変更は追加のみ（後方互換）とする。** `DROP` / リネームは二段構え（① 追加して使う → ② 旧列を消す）とし、② は Issue 化して別デプロイにする。適用はコード反映より先に走るため、「旧コード + 新スキーマ」で動く時間帯が必ず生じる。
- **ビルドトークンは `D1: Edit` を含むカスタムトークンを使う。** 自動生成トークンには D1 権限が無い。

## Rationale

- 適用の順序（適用 → デプロイ）をスクリプトに固定することで、「マイグレーションを忘れてコードだけ反映」の経路をなくせる。ローカルからの実行はガードが止めるため、適用が起きるのは Workers Builds の deploy 手順だけになる。
- 実値をコミットしない方針の理由は ADR 0008 いわく「セキュリティではなくリポジトリをクリーンに保つ方針」だった。Workers Builds ではその方針がビルド不能と直結するため、方針の方を改める。
- `database_id` で誤って空の DB が自動プロビジョニングされる心配はない（`"local"` も UUID も「完全指定」と判定される）。

## Consequences

- 本番デプロイは必ずマイグレーション適用を経由する。冪等なので毎回のデプロイで適用済みなら「No migrations to apply」で素通りする。初回の本番反映ではログでこれを確認する。
- `wrangler.toml` の `database_id` が実 UUID になるため、ローカル開発の D1 も同じ値で扱われる。ローカルのテーブルが無い場合は `npm run db:migrate:local` を実行する。
- 破壊的 DDL の機械検出は置かない（誤検知が多い）。二段構えの Issue 運用で担保する。
- ダッシュボードの API トークンに `D1: Edit` が必須になる。写しは `docs/specs/deploy.md` に置く。