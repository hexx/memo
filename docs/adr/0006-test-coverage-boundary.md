# テスト coverage の境界：ビジネスロジック・主要 UI・ルーティング契約を測り、sw/エントリ/ベンダー UI は測らない

sns-client の同種 ADR（hexx/sns-client docs/adr/0002-test-coverage-boundary.md、PR #5）に倣い、「必要十分」の線引きとして**自明でない壊れ方をする箇所**にテストを集中させる。カバレッジ数値目標は設けず、CI での閾値強制もしない（リスクベース採用）。

## 対象（＝十分とする範囲）

1. **純粋/ビジネスロジック**: `lib/org-serialize.ts`（org↔HTML/JSON 変換）、`lib/api.ts` のエラー処理、`server/lib/generateTitle.ts` のフォールバック契約（いずれも既存テストを維持）
2. **サーバールート**: `server/routes/` の memos / labels / import-export ハンドラ（既存テストを維持。インメモリ SQLite で検証）
3. **主要 UI コンポーネントと画面の配線契約**:
   - `components/MemoEditor.tsx` — 作成契約（title/body/labelIds が渡る）、実 TipTap を経由した org ラウンドトリップ、自動タイトルの 3 分岐（成功/null/throw、いずれもブロックしない）、ラベル配線、リンクのスキーマサニタイズ（XSS 防止）
   - `routes/index.tsx` / `archive.tsx` / `labels.tsx` / `memos/$memoId.tsx` — クエリ描画・ミューテーション発火・ダイアログ開閉の配線
4. **サーバのルーティング契約**: `server/app.ts` のマウント（`/api/memos` / `/api/labels` / `/api` import-export / `/api/health`）・`onError` による 500（内部エラー詳細を漏洩しない）・CORS の効き

## 意図的に測らないもの（ROI が低い）

- `public/sw.js`（Service Worker。プレーン JS で tsconfig 外）
- `src/main.tsx`（エントリポイント、自明）
- `src/routes/__root.tsx`（ナビ付きの薄い殻。ルーター破壊は全ルートテストで露出する）
- `src/components/ui/*`（shadcn/ui のベンダーコンポーネント）
- `src/lib/utils.ts`（6 行の `cn` ヘルパー）、`src/routeTree.gen.ts`（生成物）
- `scripts/generate-icons.mjs`（ビルドスクリプト）
- `src/server/index.ts`（worker エントリの薄い殻）、`src/server/db/*`（スキーマ/接続定義。挙動はルートテストがインメモリ SQLite 経由で間接検証）
- MemoEditor ツールバーの各マーク操作（TipTap 本体のテストになる）
- **E2E テスト**（Playwright＋wrangler dev＋D1 の基盤コストに対し、リスクベースの単体/統合テストで十分とみなす）

## テスト原則

- **環境分割**: vitest の既定環境は `node`（サーバ/純粋ロジック）を維持し、UI テストはファイル先頭の `// @vitest-environment jsdom` で指定する
- **モジュール境界でモック**: UI テストは `vi.mock("@/lib/api")` で API クライアントをモックし、**実サーバ（fetch）には一切接続しない**。フレームワーク（TanStack Router/Query、Radix、TipTap）はモックせず実体を動かし、実メモリルーター（`createMemoryHistory`）経由で描画する — major 破壊の検知が目的のため
- **jsdom スタブは環境ガード付き**: `tests/setup.ts` のスタブ（`Element.scrollTo` 等）には `typeof Element !== 'undefined'` ガードを付ける（node 環境のテストも setup を通るため）

## ADR 0005 との関係

ADR 0005（major アップデートを automerge しない）の根拠は「UI/コンポーネントのテストがない」ことだった。本 ADR の UI テストによりその前提は変化するが、automerge を有効化するかは別のポリシー判断であるため、0005 は変更せず、別途 issue で方針を再検討する。

## Considered Options

- **純粋ロジックのみ** — 却下：ADR 0005 の懸念（UI の major 破壊検知）に応えられず「十分」に届かない
- **主要 UI のみ（index.tsx + MemoEditor）に絞る** — 却下：各画面のミューテーション配線（アーカイブ解除、ラベル CRUD、詳細取得）は画面ごとに違う形で壊れ、追加コストが小さいため
- **全コード・E2E 含む** — 却下：sw / エントリ / ベンダー UI / ビルドスクリプトは ROI が低く過剰
- **カバレッジ数値目標を設ける** — 却下：リスクベースの線引きを歪め、測らないと決めた箇所へのテスト追加圧になる
