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
| entry_date | TEXT NULL | 日記の日付（`YYYY-MM-DD`）。UNIQUE。日記以外は NULL。「日記」節を参照 |
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
| GET | /memos | メモ一覧（検索クエリ、ラベルフィルタ、アーカイブ含む。`diary=0` で日記以外、`diary=1` で日記のみ） |
| POST | /memos | メモ作成（日記は `POST /diaries` を使う） |
| GET | /diaries | 日記一覧（検索クエリ、ラベルフィルタ、`archived`、`date`。日付降順） |
| POST | /diaries | 日記作成（`entryDate` 省略時はサーバーが Asia/Tokyo の今日を割り当て） |
| GET | /memos/:id | ID 指定でメモ取得 |
| PUT | /memos/:id | メモ更新（日記の日付変更は `entryDate` を指定） |
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
4. タイトル = `metadata.TITLE` があればそれ、なければ本文の先頭行（日記でどちらもない場合は既定タイトル = 日付）
5. ラベル = 収集したすべての見出しタグ → labels テーブルで検索または作成（find-or-create）→ memo_labels で紐付け
6. メモの行を作成する。`metadata.DATE` があれば日記として作成する（同じ日付の日記が既にあれば 409 で拒否）

## エクスポートフロー

1. DB からメモを取得する
2. 生の本文テキストの先頭に `#+TITLE: {title}` と `#+FILETAGS: {label1:label2}` を付与する（日記は `#+DATE: {entry_date}` も付与し、ファイル名は `{entry_date}.org` にする）
3. `.org` ファイルのダウンロードとして返す

複数メモのエクスポート: ラベルで絞り込み、個別の .org ファイルを作成して zip にまとめる。

## 日記

日記は特定の日付に紐づくメモであり（ADR 0009）、専用の「日記ビュー」で扱う。データとしては memos テーブルの行で、`entry_date` を持つ。

### 仕様

- 日記の日付は暦日（`YYYY-MM-DD`、時刻・タイムゾーンなし）。作成タイムスタンプとは独立
- 1 日につき最大 1 つ。UNIQUE 制約で強制する（SQLite は NULL を複数許容するため通常メモには影響しない）
- 「今日」はサーバーが `Asia/Tokyo` 固定で決定する（ADR 0010）。未来日は拒否する
- タイトルは日付が既定（`YYYY-MM-DD (木)` の形式）。ユーザーが編集したタイトルは尊重する。日付変更時、タイトルが旧既定値と一致する場合のみ新日付へ追従する。空タイトルで保存された場合は日付で再補完する
- 空本文でも保存できる（既存メモと同じ）
- ピン留めは日記では扱わない（日付降順を崩さないため）
- 日記の削除はメモと同じ物理削除
- 日記の検索は既存メモと同じ（タイトルまたは本文への部分一致）

### 画面

| 画面 | パス | 内容 |
|---|---|---|
| ホーム | `/` | 日記を表示しない（一覧・検索・ラベルフィルタすべてで除外） |
| 日記ビュー | `/diary` | 日記を日付降順で表示。検索・ラベルフィルタ付き。アーカイブ済みは既定非表示 |
| 日記の詳細・編集 | `/memos/:id`（既存を再利用） | 日記のときだけ日付ピッカーを表示。「← 戻る」と削除後の遷移先は `/diary` |
| アーカイブ | `/archive` | 全メモ（日記含む）を表示。日記には日付を併記 |

日記ビューの「日記を書く」ボタンは作成ダイアログ（既存 `MemoEditor` の日記モード）を開く。日付ピッカーの既定と最大は今日、タイトル既定は日付。日付を変えたときタイトルが旧既定値のままなら新日付に追従させる。同日の日記が既にある場合は作成せず、既存の詳細画面を開く。

### 日付の扱い

- クライアントは日付ピッカーの初期表示用にのみ `Asia/Tokyo` の今日を JS で計算する
- サーバーは受け取った日付の形式・実在日付・未来日・重複を検証する
- `Asia/Tokyo` の今日は `Date.now() + 9h` を UTC として切り出す（日本は DST なしのため固定オフセットで正しい）

### org 連携

- エクスポート: 日記には `#+DATE: YYYY-MM-DD` を付与する。ファイル名はタイトルに依存せず `YYYY-MM-DD.org`
- インポート: `#+DATE:` があれば日記として取り込む。`#+TITLE:` も本文の先頭行もなければ既定タイトル（日付）を使う。同じ日付の日記が既にあれば 409 で拒否し、上書きしない
- 通常メモの入出力形式は変更しない

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
