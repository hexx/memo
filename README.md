# Org Memo

Google Keep ライクなメモアプリケーション。org-mode 記法でのメモ作成とインポート/エクスポートをサポートします。Cloudflare Workers 上で動作するシングルユーザー向け PWA です。

## 主な機能

- **メモの作成・編集・削除** — org-mode 記法（見出し、リスト、太字、イタリック、コードブロック、リンクなど）による構造化メモ
- **ラベル管理** — メモに複数のラベルを付与して整理・フィルタリング
- **ピン留め** — 重要なメモを先頭に固定表示
- **アーカイブ** — 使用頻度の低いメモをメイン画面から非表示
- **インポート** — `.org` ファイルのアップロードまたは org-mode テキストの貼り付けでメモを作成
- **エクスポート** — メモを `.org` ファイルとしてダウンロード（単一 / ラベルで絞り込んだ ZIP）
- **検索** — メモ本文の全文検索
- **PWA** — サービスワーカーによるオフライン閲覧対応

## 技術スタック

| レイヤー | 技術 |
|---|---|
| ランタイム | Cloudflare Workers |
| API サーバー | Hono |
| データベース | Cloudflare D1 (SQLite) |
| フロントエンド | React (TanStack Router + TanStack Query) |
| ビルドツール | Vite |
| UI コンポーネント | shadcn/ui + Tailwind CSS |
| Org パース | org-toolkit (hexx/org-toolkit) |
| 静的解析 | oxlint |
| テスト | Vitest |

## プロジェクト構成

```
src/
├── main.tsx                # アプリケーションエントリーポイント
├── index.css               # グローバルスタイル
├── components/
│   ├── MemoEditor.tsx      # メモ編集ダイアログ
│   └── ui/                 # shadcn/ui コンポーネント
├── lib/
│   ├── api.ts              # API クライアント
│   ├── utils.ts            # ユーティリティ
│   └── __tests__/          # フロントエンドテスト
├── routes/                 # TanStack Router のルート定義
│   ├── __root.tsx          # ルートレイアウト
│   ├── index.tsx           # メイン画面（メモ一覧）
│   ├── archive.tsx         # アーカイブ画面
│   ├── labels.tsx          # ラベル管理画面
│   └── memos/
│       └── $memoId.tsx     # メモ詳細画面
└── server/
    ├── index.ts            # Worker エントリーポイント
    ├── app.ts              # Hono アプリケーション設定
    ├── db/
    │   ├── schema.ts       # Drizzle ORM スキーマ定義
    │   └── index.ts        # DB 接続
    └── routes/
        ├── memos.ts        # メモ CRUD API
        ├── labels.ts       # ラベル CRUD API
        ├── import-export.ts # インポート/エクスポート API
        └── __tests__/      # サーバーテスト
```

## データモデル

### memos

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT (PK) | UUID |
| title | TEXT (NOT NULL) | メモのタイトル |
| body | TEXT (NOT NULL) | org-mode 形式の本文 |
| is_pinned | INTEGER (DEFAULT 0) | ピン留めフラグ |
| is_archived | INTEGER (DEFAULT 0) | アーカイブフラグ |
| created_at | TEXT (NOT NULL) | 作成日時 (ISO 8601) |
| updated_at | TEXT (NOT NULL) | 更新日時 (ISO 8601) |

### labels

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT (PK) | UUID |
| name | TEXT (NOT NULL, UNIQUE) | ラベル名 |

### memo_labels（中間テーブル）

| カラム | 型 | 説明 |
|---|---|---|
| memo_id | TEXT (FK → memos.id, CASCADE) | メモID |
| label_id | TEXT (FK → labels.id, CASCADE) | ラベルID |

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/memos` | メモ一覧（検索・ラベルフィルタ・アーカイブ含む） |
| POST | `/memos` | メモ作成 |
| POST | `/memos/generate-title` | 本文からタイトルを AI 生成（プレビュー用。生成不可時は `{ title: null }`） |
| GET | `/memos/:id` | メモ取得 |
| PUT | `/memos/:id` | メモ更新 |
| DELETE | `/memos/:id` | メモ削除（物理削除） |
| PATCH | `/memos/:id/pin` | ピン留め切り替え |
| PATCH | `/memos/:id/archive` | アーカイブ切り替え |
| GET | `/labels` | ラベル一覧 |
| POST | `/labels` | ラベル作成 |
| DELETE | `/labels/:id` | ラベル削除 |
| POST | `/import` | org テキストのインポート |
| GET | `/memos/:id/export` | 単一メモを .org 形式でエクスポート |
| GET | `/export` | ラベルで絞り込んだメモを ZIP でエクスポート |

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# マイグレーションファイルの生成（初回 or スキーマ変更時のみ）
npm run db:generate

# ローカル D1 にマイグレーションを適用
npm run db:migrate:local

# 開発サーバーの起動
npm run dev

# テストの実行
npm test
```

> **Note**: 新しくクローンしたら `npm install` → `npm run db:generate` → `npm run db:migrate:local` の順で実行してください。`drizzle.config.ts` の `out: "./migrations"` にSQLファイルが生成され、ローカルの D1 インスタンスにテーブルが作成されます。

## デプロイ

```bash
# ビルド
npm run build

# Cloudflare Workers にデプロイ
npm run deploy
```

## タイトルの自動生成（AI）

メモ作成・編集時に、タイトルを自分で入力する代わりに**本文の内容から AI で自動生成**できます。メモ編集画面の「AIで生成」ボタンを押すと、本文から短い日本語のタイトルが生成されます。また、`POST /memos` や `PUT /memos/:id` で `title` を空にした場合も、サーバー側で本文から自動生成します（手動入力された `title` がある場合はそちらを優先）。

接続には OpenAI 互換のチャット API（OpenCode Go エンドポイント）を使用し、次の 3 つの環境変数（Cloudflare Workers のバインディング）から接続情報を取得します。

| 環境変数 | 説明 |
|---|---|
| `OPENCODE_GO_API_KEY` | API キー（Authorization: Bearer に使用）。**シークレット** |
| `OPENCODE_GO_BASE_URL` | ベース URL（例: `https://opencode.ai/zen/go/v1`）。実際のエンドポイントは `<BASE_URL>/chat/completions` |
| `OPENCODE_GO_MODEL` | モデル名（例: `qwen3.7-max`） |

いずれかの変数が未設定の場合、あるいは LLM 呼び出しが失敗・タイムアウトした場合は、例外を投げることなく**既存の手動入力フローへ安全にフォールバック**します（タイトルが空のまま保存しようとすると `400 Title is required` になります）。

```bash
# ローカル開発: .dev.vars.example をコピーして実際の値を設定
cp .dev.vars.example .dev.vars

# 本番: シークレットは wrangler secret put で設定
wrangler secret put OPENCODE_GO_API_KEY
```

> **Note**: `OPENCODE_GO_BASE_URL` / `OPENCODE_GO_MODEL` は `wrangler.toml` の `[vars]` に既定値が設定されています。別のモデル等を使う場合は `.dev.vars` や `wrangler secret put` で上書きしてください。

## アーキテクチャ決定記録 (ADR)

- [D1 (SQLite) をデータストアに採用](docs/adr/0001-d1-as-datastore.md) — メモとラベルの多対多リレーションを自然に扱うため
- [メモ本文は生の org テキストを保存](docs/adr/0002-raw-org-text-storage.md) — AST 往復によるフォーマット崩れを防ぐため

## ライセンス

Private（プロプライエタリ）
