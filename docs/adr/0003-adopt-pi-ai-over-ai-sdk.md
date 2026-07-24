# LLM 層に ai-sdk ではなく pi-ai を採用する

タイトル自動生成の LLM 層を Vercel AI SDK（`ai` / `@ai-sdk/openai-compatible`）から `@earendil-works/pi-ai` に置き換える。動機は機能拡張ではなく **pi エコシステムへの統一**である。任意の OpenAI 互換エンドポイント（`AI_BASE_URL`）という本アプリの前提と、`generateTitle` の null フォールバック契約は維持する。

## 決定内容

- pi-ai の `createProvider()` + `Models` コレクションを使う（pi 標準の抽象に乗せる）。API は `openai-completions`（lazy import）、非ストリーミング（`models.complete`）。
- モデルのメタデータは**固定の既定値**（`reasoning: false` / `cost: 0` / `input: ['text']` 等）を使う。`compat` は明示せず pi-ai の `baseUrl` 自動検出に任せる（opencode.ai 経路なら `supportsStore: false` 等が自動で付く）。
- 認証は `AI_API_KEY` をリクエストごとに明示渡しする（`process.env` に依存しない。Workers バインディング対応）。
- pi-ai は API エラー時に throw せず `stopReason: 'error'` のメッセージを返すため、本アプリ側で throw に変換し、従来の try/catch による null フォールバック経路に乗せる。
- **rss-reader の同種 PR（hexx/rss-reader#283）との違い**: 向こうは環境変数不足時に throw する（`requireEnv`）が、本アプリは AI 未設定でもアプリを使えることが仕様のため、不足時は従来どおり `null` を返す。

## Considered Options

- **ai-sdk を維持**: 普及度は高いが、エコシステム統一の目的を満たさない。
- **pi-ai の API 直接呼び出し（`Models` を使わない）**: コードは最少だが pi らしい抽象に乗らず、統一の旨味が薄い。
- **`AI_PROVIDER` + 組み込みカタログから実メタデータを借用**: 不採用。未使用プロバイダの SDK までバンドルに引き込まれ約 524〜900K 膨張する（rss-reader での実測）。本アプリは Cloudflare Workers デプロイでバンドルサイズのペナルティが大きく、かつ reasoning 非使用・コスト表示なしで実利が薄い（YAGNI）。
