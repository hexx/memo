# ライブラリ一斉バージョンアップ計画（2026-07）

## 背景・動機

Renovate で minor/patch は automerge されているが、major だけが積み上がり、最新との差が開いていた。技術的負債を清算し、メンテナンス性を回復する。あわせて major を溜めない運用ルールを定める。

## スコープ

`npm outdated` で major の遅れがあるパッケージのうち、**TypeScript 7 を除くすべて**を今回上げる。

| クラスタ | 内容 | 備考 |
|---|---|---|
| F: 軽量 | uuid 10→14, @cloudflare/workers-types 4→5, @earendil-works/pi-ai 0.82 | API 変更の確認程度 |
| D: Cloudflare | wrangler 3→4 | wrangler.toml の互換確認 |
| E: DB | drizzle-orm 0.36→0.45, drizzle-kit 0.28→0.31 | マイグレーション生成の差分確認 |
| B: UI | react / react-dom 18→19, @types/react(-dom) 19, Radix, Tiptap 3.29 | ランタイム・ref 周りの破壊的変更 |
| A: ビルド | vite 5→8, @vitejs/plugin-react 4→6, vitest, @tanstack/router-vite-plugin | 連鎖的に版本を揃える |
| C: CSS | tailwindcss 3→4（+ postcss/autoprefixer 構成の見直し） | CSS の全面移行。見た目への影響大 |

### 見送り

- **better-sqlite3 12→13**: v13 はインストール時にソースビルド（node-gyp）が必要で、C ツールチェーン（make/g++）の無い環境では `npm install` 自体が失敗する。テスト（`tests/helpers.ts`）が依存しているため、ビルド環境の整備が先。今回は ^12 に据え置き。
- **TypeScript 5→7**: tsgo（Go 実装）の 7.0.x が出たばかりで、Vite/vitest/drizzle-kit 等のツールチェーンが追いついていない可能性が高い。「清算」のつもりが新たな不安定要因になるため見送り。5.9 のまま。
- `org-toolkit`（git 依存・コミット固定）は対象外。

## 実行方針

- **1 本の PR に全クラスタをまとめて実行**する（F→D→E→B→A→C の順で同一ブランチに積み上げる）。
- 壊れたらその場で直す。シングルユーザーの個人プロジェクトなので実害は小さい。

## 検証

CI（oxlint + vitest + build）は UI を検証できないため、**マージ前に以下を手動でスモークテスト**する：

- [ ] メモの作成・編集・削除
- [ ] ピン留め / ピン解除
- [ ] アーカイブ / アーカイブ解除、アーカイブビュー表示
- [ ] ラベルの付与・フィルタリング
- [ ] org インポート（`.org` アップロード / テキスト貼り付け、`#+TITLE:`・`#+FILETAGS:`）
- [ ] org エクスポート（単体 / ラベル絞り込み zip）
- [ ] 自動タイトル（AI 生成 + 失敗時フォールバック）
- [ ] PWA 表示・オフライン動作
- [ ] `npm run dev`（wrangler dev + vite 同時起動）が正常

## 今後の運用ルール

- Renovate の設定は現状維持（minor/patch = automerge、major = 手動 PR）。詳細は [ADR-0005](./adr/0005-no-automerge-for-major-updates.md)。
- **major PR は溜めずに週次で処理する**。
