# デザイン

## スタック

| レイヤー | 選択 |
|---|---|
| ランタイム | Cloudflare Workers |
| API サーバー | Hono |
| データベース | Cloudflare D1 (SQLite) |
| フロントエンドフレームワーク | React (TanStack Router + TanStack Query) |
| ビルドツール | Vite |
| UI コンポーネント | shadcn/ui |
| Org パース | org-toolkit (hexx/org-toolkit) |
| プロジェクト構成 | 単一パッケージ（`src/server/` + `src/client/`） |

## データモデル

### memos

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT NOT NULL | 本文の先頭行。インポート時は `#+TITLE:` |
| body | TEXT NOT NULL | 生の org テキスト |
| is_pinned | INTEGER NOT NULL DEFAULT 0 | 真偽値フラグ |
| is_archived | INTEGER NOT NULL DEFAULT 0 | 真偽値フラグ |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

### labels

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL UNIQUE | ユーザーが作成したラベル名 |

### memo_labels

| カラム | 型 | 備考 |
|---|---|---|
| memo_id | TEXT FK → memos(id) | 削除時に CASCADE |
| label_id | TEXT FK → labels(id) | 削除時に CASCADE |

主キー: (memo_id, label_id)

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | /memos | メモ一覧（検索クエリ、ラベルフィルタ、アーカイブ含む） |
| POST | /memos | メモ作成 |
| GET | /memos/:id | ID 指定でメモ取得 |
| PUT | /memos/:id | メモ更新 |
| DELETE | /memos/:id | メモ削除（物理削除） |
| PATCH | /memos/:id/pin | ピン切り替え |
| PATCH | /memos/:id/archive | アーカイブ切り替え |
| GET | /labels | ラベル一覧 |
| POST | /labels | ラベル作成 |
| DELETE | /labels/:id | ラベル削除 |
| POST | /import | org テキストのインポート（multipart または JSON ボディ） |
| GET | /memos/:id/export | 単一メモを .org としてエクスポート |
| GET | /export | 絞り込んだメモを zip としてエクスポート（クエリ: label） |

## インポートフロー

1. org テキストを受け取る（ファイルアップロードまたは貼り付け）
2. 生の org テキストを `body` として保存する
3. `org-toolkit` でパースする: メタデータから `TITLE` を抽出し、`walk()` ですべての見出しタグを収集する
4. タイトル = `metadata.TITLE` があればそれ、なければ本文の先頭行
5. ラベル = 収集したすべての見出しタグ → labels テーブルで検索または作成（find-or-create）→ memo_labels で紐付け
6. メモの行を作成する

## エクスポートフロー

1. DB からメモを取得する
2. 生の本文テキストの先頭に `#+TITLE: {title}` と `#+FILETAGS: {label1:label2}` を付与する
3. `.org` ファイルのダウンロードとして返す

複数メモのエクスポート: ラベルで絞り込み、個別の .org ファイルを作成して zip にまとめる。

## PWA

- Service Worker キャッシュによるオフライン読み取り専用対応
- オフライン書き込みは非対応（競合解決の複雑さを回避）

### 画面回転

- インストール済み PWA（Android / Chrome）の画面回転は **OS の回転設定に従う**。システムの回転ロックが ON の間は回転せず、OFF のときのみ回転する。
- 実装上の制約: Web App Manifest に `orientation` キーを**宣言しない**こと。`"orientation": "any"` を宣言すると Chrome (Android) はシステムの回転ロックを上書きして常に回転可能になる（既知の挙動）。`"portrait"` 等を宣言すると今度は向きが強制ロックされ、WCAG 1.3.4 (Orientation) の観点でも問題がある。キー自体を省略するのが正しい。
- レイアウト: 横画面ではメモグリッドがブレークポイント（`sm:` 以上）に応じて自動で複数列になり、エディタは中央寄せのまま。回転に追従する追加実装は不要。
- 対象範囲: インストール済み PWA（モバイル）。ブラウザタブでは manifest の orientation は読まれず常にシステム準拠となるため対象外（検証のみ）。
- 非保証事項:
  - Chrome on Android の既知バグにより、一部の端末/バージョン（Android 13 系など）ではキー省略後も回転しない・挙動が不安定なことがある。Chrome 側の問題のため本アプリからは回避しない。
  - iOS Safari は manifest の orientation メンバーをサポートしないため影響なし。
  - デスクトップは画面回転の概念が適用されないため対象外。

## Org 記法のサポート

見出し（`*`）、順不同リスト（`-`, `+`）、順序付きリスト（`1.`）、太字（`*bold*`）、イタリック（`/italic/`）、取り消し線（`+strikethrough+`）、コードブロック（`#+BEGIN_SRC`）、リンク（`[[url][description]]`）。
