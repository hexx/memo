# ビルド/デプロイ警告への対応方針：無害なものは許容し、将来壊れるものは即修正する

> **注（2026-09-26）**: 決定「要確認 5（`database_id`）」の「実 UUID はリポジトリに記載せず `database_id = "local"` のままとする」は、本番反映の Cloudflare Workers Builds への一本化に伴い ADR 0012 で覆した。

## Status

Accepted（2026-07-25、`wrangler deploy` の出力レビュー時）

## Context

`wrangler deploy`（custom build = `npm run build`）の出力にエラーはなくデプロイは成功するが、次の 4 種の警告と 1 件の要確認事項が出る。

1. **`npm warn Unknown env config "verify-deps-before-run"` / `"_jsr-registry"`** — pnpm がシェル環境に設定する `npm_config_*` 環境変数が npm にリークする既知の現象（pnpm/pnpm#10000 等）。ビルドには一切影響しない。次期 npm major で黙って無視される。
2. **`__dirname`（vite.config.ts:11 等）が `configLoader: 'native'` 非対応** — `"type": "module"` のプロジェクトで CJS 用の `__dirname` を使用。Vite の将来 major で native ローダーがデフォルト化すると設定が読めなくなる。
3. **`src/routes/__tests__/*.tsx` が Route として走査される** — TanStack Router がルートディレクトリ配下のテストファイルをルート候補として扱い警告を出す。ルートツリーには含まれないため実害はないが出力が騒がしい。
4. **チャンクサイズ 857.59 kB（gzip 270.11 kB）> 500 kB の警告** — 単一の JS チャンクが Vite 既定閾値を超える。
5. **`wrangler.toml` の `database_id = "local"`** — ローカル開発用の記法。`wrangler deploy` は `database_id` をそのまま API へ送信するため、非 UUID（`"local"` 含む）では **code 10021 でデプロイが失敗する**（wrangler 4.114.0 ソースで検証済み。`issues/issue-20260705-d1-database-id.md` に記録）。成功した本番デプロイは、ローカルで実 UUID を記載した状態で実行されている（コミット時は `"local"` に戻す運用）。名前解決が効くのは `d1` サブコマンド（migrations / execute / list）のみであり、デプロイ経路には存在しない。

## Decision

- **警告 1（npm env config）: 許容**。リポジトリ内では何もしない。原因は開発マシンのシェル環境であり、無害。
- **警告 2（`__dirname`）: 即修正**。`vite.config.ts` と `vitest.config.ts` の両方で `import.meta.dirname` に置換する。CI/ローカルの Node 24 で問題なく動作する。
- **警告 3（`__tests__` ルート走査）: 即修正**。TanStack Router プラグインに `routeFileIgnorePattern: "__tests__"` を追加する。テストの配置（ADR 0006 の「ルートと共に置く」方針）は維持する。
- **警告 4（チャンクサイズ）: 許容 + 閾値調整**。`build.chunkSizeWarningLimit: 900` を設定し警告を消す。コード分割は現時点で実施しない（下記 Rationale 参照）。
- **テレメトリ（Cloudflare の匿名利用統計）: 許容**。`send_metrics` は設定しない。
- **要確認 5（`database_id`）: 実 UUID はリポジトリに記載せず、`database_id = "local"` のままとする**。`wrangler d1 list` で本番 DB `org-memo-db` が 1 件（`bf349073-...`）のみ存在することを確認済み。**本番デプロイ時はローカルで実 UUID を記載してから実行する運用**（コミットしない。コミット済みの `"local"` のままでは deploy が code 10021 で失敗する）。`wrangler d1` サブコマンド（`migrations apply` 等）は名前ベースで動くため影響なし。

## Rationale

- 警告 2 は修正コストがほぼゼロで、Renovate が自動で上げてくる将来の Vite major アップグレード（ADR 0005 の対象）での破損リスクを事前に消せる。
- 警告 3 はテスト配置を変えずに 1 行の設定で消せる。リネーム（`-` プレフィックス）はファイル名が不自然になり、移動は ADR 0006 の意図に反する。
- 警告 4 はシングルユーザー PWA であり初回ロードは一度きり、gzip 270 kB は実用上問題ない。TanStack Router の lazy ルートによるコード分割は複雑さに見合わない。将来「初回ロードが重い」という実感が出た時点で `route.lazy` による分割を検討する。
- 警告 1 とテレメトリは「コードに現れない環境要因」であり、設定を増やして黙らせる価値がない。

## Consequences

- ビルド出力から警告 2・3・4 が消える。警告 1 とテレメトリは開発マシン環境に依存するため出る場合がある（無害）。
- `database_id` は `"local"` のまま。実 UUID（`bf349073-...`）は開発マシンでのみ把握し、リポジトリには記載しない。
- 記載しない理由はセキュリティではなく**リポジトリをクリーンに保つ方針**（D1 の UUID は識別子であり認証情報ではない。Cloudflare 標準ではコミットも一般的）。
- 既知のリスク: コミット済みの `wrangler.toml`（`database_id = "local"`）のままでは `wrangler deploy` が失敗する（code 10021）。**本番デプロイ前にはローカルで実 UUID を記載する手順が必須**。一方、`"local"` は「完全指定」と判定されるため自動プロビジョニングは発生せず、誤って空 DB が作られるリスクはない（失敗は硬いエラーとして顕在化する）。本番 DB の状態確認時は `wrangler d1 list` で `org-memo-db` が 1 件であることを確認する運用とする。
- 注意: `wrangler d1 list` の `num_tables` は当てにならない（`rss-reader` は 364 MB のデータがあるのに 0 表示）。本番のスキーマ有無は `wrangler d1 migrations list org-memo-db --remote` で確認すること（2026-07-25 に実行し `✅ No migrations to apply!` を確認済み＝`0000_mixed_quicksilver` は本番に適用済み、スキーマ存在を確認済み）。
- 将来の Vite major アップグレード時に `configLoader: 'native'` 関連の破損が起きない。

## Considered Options

- **警告 2: 抑制フラグ（`VITE_CONFIG_NATIVE_IGNORE_WARNING`）で先送り** — 却下。問題を将来に持ち越すだけで、修正コストがほぼゼロなので即修正が得。
- **警告 3: `-` プレフィックスへのリネーム / テストの移動** — 却下。ファイル名が不自然になる、または ADR 0006 のテスト配置方針に反する。
- **警告 4: TanStack Router の lazy ルートで分割** — 却下（現時点）。シングルユーザー用途では 270 kB gzip は許容範囲で、導入コストに見合わない。