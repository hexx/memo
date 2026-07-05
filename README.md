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

# 開発サーバーの起動
npm run dev

# ローカル DB マイグレーション
npm run db:migrate:local

# テストの実行
npm test
```

## デプロイ

```bash
# ビルド
npm run build

# Cloudflare Workers にデプロイ
npm run deploy
```

## アーキテクチャ決定記録 (ADR)

- [D1 (SQLite) をデータストアに採用](docs/adr/0001-d1-as-datastore.md) — メモとラベルの多対多リレーションを自然に扱うため
- [メモ本文は生の org テキストを保存](docs/adr/0002-raw-org-text-storage.md) — AST 往復によるフォーマット崩れを防ぐため

## ライセンス

Private（プロプライエタリ）
