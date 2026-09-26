# 本番反映は main へのマージに一本化する（Cloudflare Workers Builds）

## Status

Accepted（2026-09-26）

## Context

本番反映は長らく開発マシンの手元から `wrangler deploy` を実行する運用で、リポジトリにはデプロイ実績が残らず（GitHub deployments は 0 件）、「どのコミットが本番か」「誰が出したか」を追えなかった。`wrangler.toml` の `database_id` はローカル用の `"local"` のままコミットされており、手元デプロイのたびに実 UUID へ書き換える属人的な手順が必要だった。

ゲートも「あるつもり」の状態だった。ruleset "main" は存在するが `conditions.ref_name.include` が空で何も適用されておらず、ルールも削除・force push 禁止のみ。PR 必須も必須ステータスチェックも無い。一方で Renovate は minor/patch を automerge しており、ゲートの無いこの状態では **CI が緑になっただけで誰も見ていない本番反映が起きる**。

また、本アプリにはアプリ内認証が無い（シングルユーザー前提）。Workers Builds の preview trigger は本番と同じ binding（本番 D1）を共有し、preview URL はカスタムドメインに付けたエッジ認証の保護対象外（別ホスト名）になるため、有効化すると本番データを無防備な URL から書き換えられる。

## Decision

- **本番反映の経路は main へのマージ 1 本とする。** Cloudflare Workers Builds が production branch `main` で build command `npm run build` → deploy command `npm run deploy` を実行する。
- **preview trigger は作らない。** 環境を分けたくなった場合は、別 Worker + 別 D1 を用意する（既定の preview は本番 binding を共有するため使わない）。
- **ゲートを機械化する。** ruleset "main" の conditions を `["~DEFAULT_BRANCH"]` に修正し、`pull_request`（承認者 0）と `required_status_checks`（context: `Lint / Test / Build`、strict=false）を追加する。既存の `deletion` / `non_fast_forward` は温存する。
- **手元からの反映は `scripts/deploy-guard.mjs` で中止する。** `WORKERS_CI=1`（Workers Builds が注入）が無く、かつ `ALLOW_LOCAL_DEPLOY=1` も無ければ `npm run deploy` は失敗する。
- **ロールバックの正は `git revert` → main へマージ。** ダッシュボードの promote / `wrangler rollback` は止血の例外とし、使ったら revert で追いつかせる。
- **Renovate の automerge は維持する。** PR 必須 + 必須チェックにより、無人で本番に出るのは CI が緑の更新だけになる。

## Rationale

- 本番で動いている成果物は常に main 先頭のコミットからビルドしたものである、という不変条件を回復できる。デプロイが GitHub のチェックラン（`Workers Builds: org-memo`）として現れるため、Cloudflare の認証が無くても追跡できる。
- 属人的な「ローカルで実値を書き換えて deploy」という手順を消せる（実値のコミットは ADR 0012）。
- ゲートが無いのに automerge を維持するのは「無人デプロイ」を意味する。ゲートを先に機械化することで、automerge を安全側に残せる。
- 必要十分なテストの範囲は ADR 0006 の通り。テストが無い領域（UI の見た目）は major を手動に留める ADR 0005 が引き続き守る。

## Consequences

- ダッシュボードの build / deploy command、path excludes、API トークンはリポジトリから見えない権威になる。写しを `docs/specs/deploy.md` に置き、変更時はそちらも更新する。
- デプロイ失敗が続く間、本番は旧バージョンのままとなり不変条件は一時的に崩れる（壊れはしないが放置しない）。失敗は GitHub のチェックランから検知し、設定を直してからリトライする。
- main にマージされるすべての変更（Renovate の automerge を含む）が本番反映のトリガーになる。成果物に影響しない `docs/**` 等は path excludes で除外する。
- 手元からの反映は例外操作になり、実行記録は残らない。使った場合は revert で main に追いつかせる運用で補う。