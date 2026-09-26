# 仕様：本番反映（Production Deploy）

この文書は「本番反映の手順」と「リポジトリの外にある設定の写し」をまとめたもの。決定の根拠は ADR 0011（本番反映の経路）/ ADR 0012（スキーマ反映）を参照。用語は `CONTEXT.md` が権威。

## 1. 権威の所在

| 何を決めるか | 権威 |
| --- | --- |
| デプロイ手順の中身（ガード → マイグレーション適用 → デプロイ） | リポジトリ（`package.json` の `deploy`、`scripts/deploy-guard.mjs`） |
| ビルド成果物の中身（Worker / assets） | リポジトリ（`src/**`、`public/**`、`vite.config.ts`、`wrangler.toml`） |
| いつ・どのブランチでビルドするか、build / deploy command、path excludes、API トークン | Cloudflare ダッシュボード（Workers & Pages → `org-memo` → Settings → Build） |
| 本番に出てよいか（テストの合否） | CI（`.github/workflows/ci.yml`）＋ `main` の ruleset（必須ステータスチェック・PR 必須） |

ダッシュボードの設定は**リポジトリからは見えない**。§3 がその写しであり、変更したら必ずここも更新する。

## 2. 不変条件

- **本番で動いている成果物は main 先頭のコミットからビルドしたものである。** 成果物に影響する差分が入れば必ず本番反映が走る。
- 巻き戻しは **`git revert` → main へマージ**が正。ダッシュボードの promote / `wrangler rollback` は止血の例外で、使ったら必ず revert で追いつかせる。
- DB は巻き戻せない。追加のみ規約により、旧コードは新スキーマで動く。

## 3. Cloudflare Workers Builds の設定値（写し）

| 設定 | 値 |
| --- | --- |
| Git アカウント / リポジトリ | GitHub `hexx/memo` |
| Worker 名 | `org-memo`（`wrangler.toml` の `name`） |
| production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Non-production branch builds | **無効**（preview trigger を作らない） |
| Root directory | 空（リポジトリ直下） |
| API token | カスタムトークン（**`D1: Edit` を含む**。自動生成トークンには D1 権限が無い） |
| Build variables / secrets | なし（Node は既定 24 で CI と一致） |
| Path excludes | `docs/**` `issues/**` `*.md` `.github/**`（配信物 `public/**` と `migrations/**` は除外しない） |
| D1 | `org-memo-db`（`database_id` は `wrangler.toml` にコミット済み） |

## 4. リポジトリ側

```json
"build": "vite build",
"deploy": "node scripts/deploy-guard.mjs && wrangler d1 migrations apply org-memo-db --remote && wrangler deploy"
```

- `scripts/deploy-guard.mjs`: `WORKERS_CI=1`（Workers Builds が注入）が無く、かつ `ALLOW_LOCAL_DEPLOY=1` も無ければ中止する。
- `wrangler` 設定: `account_id` / `database_id` は実値をコミットする（秘匿値ではない。ADR 0012）。
- `wrangler` は `devDependencies` に固定する（Workers Builds はこの版を使う）。
- ビルドとデプロイは分離する（`wrangler.toml` に `[build]` を置かず二重ビルドを避ける。ビルドは Workers Builds の build command が行う）。
- 追加のみ規約: マイグレーションに `DROP` / リネームを含めない。必要な場合は二段目の Issue を立てる。

## 5. GitHub 側（main の ruleset）

| ルール | 設定 |
| --- | --- |
| `pull_request` | 必須（承認者 0） |
| `required_status_checks` | `Lint / Test / Build`、`strict=false` |
| `deletion` / `non_fast_forward` | 有効（削除・force push 禁止） |
| `conditions.ref_name.include` | `["~DEFAULT_BRANCH"]`（**空だと ruleset は無効**） |

適用は `workers-builds-deploy` スキルの `assets/ruleset-apply.sh` を使う。有効性の確認:

```bash
gh api repos/hexx/memo/rules/branches/main --jq '[.[] | {type, parameters}]'
```

## 6. 通常のフロー / ロールバック / 緊急時

- **通常**: PR → CI 緑 → main にマージ → Workers Builds が build → deploy（= マイグレーション適用 → デプロイ）
- **ロールバック**: `git revert <commit>` → PR → マージ
- **止血（例外）**: ダッシュボードで旧バージョンを promote、または `wrangler rollback`。**使ったら revert で追いつかせる。**
- **緊急のローカル反映**: `npm run build && ALLOW_LOCAL_DEPLOY=1 npm run deploy`
- **失敗時**: GitHub のチェックラン（`Workers Builds: org-memo`）から追う。**設定を直してから**リトライする（リトライにはその時点の設定が使われる）。

## 7. 検証

```bash
npm run deploy                                        # ガードで中止されること
npx wrangler d1 migrations apply org-memo-db --local  # 2 回実行し、2 回目が適用なしであること
gh api repos/hexx/memo/rules/branches/main --jq '[.[].type]'  # 4 種が効いていること
```

初回の本番反映では、ビルドログで「適用なしで素通りした」ことを確認する。**本番で未適用のマイグレーションを意図的に作る検証はしない。**

## 8. 採用しないもの

- **プレビュー配備**: 既定の preview は本番 binding を共有し、preview URL（version URL）はエッジ認証の保護対象外。アプリ内認証が無い本アプリでは、本番 D1 を無防備な URL から書き換えられる。環境を分けるなら別 Worker + 別 D1。
- **ダッシュボードの deploy command への長いコマンド直書き**: リポジトリと乖離しても気づけない（マイグレーション未適用が放置された実例がある）。
- **マイグレーション適用の人手運用**: 「忘れる」経路が残る。適用 → デプロイの順をスクリプトに固定する。
- **破壊的 DDL の機械検出**: 誤検知が多い。二段目の Issue 運用で担保する。