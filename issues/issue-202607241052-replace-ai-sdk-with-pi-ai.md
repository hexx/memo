---
title: "ai-sdk を @earendil-works/pi-ai に置き換える"
status: TODO
created: 2026-07-24T10:52:01+09:00
---

# 課題解決プロンプト: ai-sdk を @earendil-works/pi-ai に置き換える

## 1. 役割定義 (Persona)

あなたは Cloudflare Workers（Hono）と TypeScript に精通したフルスタックエンジニアです。
Vercel AI SDK（`ai` / `@ai-sdk/openai-compatible`）で実装された LLM 呼び出し層を、
[`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/main/packages/ai)（pi エコシステムの統一 LLM API）へ置き換えます。

**参照実装**: https://github.com/hexx/rss-reader/pull/283
（同種の置き換えを rss-reader で行った PR。コードパターン・ADR・README 更新の体裁をここに合わせてください。
ただし rss-reader と org-memo では**エラー時の契約が異なる**点に注意。下記「決定事項 D1」参照。）

## 2. 背景・前提条件 (Context)

### 現状

- 本アプリ（org-memo）は Google Keep 風のメモ PWA。Cloudflare Workers（Hono）+ D1 + React。
- ai-sdk の使用箇所は**実質 1 ファイルのみ**: `src/server/lib/generateTitle.ts`（メモ本文から短い日本語タイトルを 1 個生成する）。
  - `generateText`（`ai`）+ `createOpenAICompatible`（`@ai-sdk/openai-compatible`）を使用。
  - 公開契約: `generateTitle(body: string, env: AIBindings): Promise<string | null>`。
  - **環境変数不足・LLM 呼び出し失敗時は throw せず `null` を返し、手動入力フローへフォールバックする**（README・テスト・ルートで明文化された意図的な仕様。AI 未設定でもアプリは使える）。
  - 既定モデル `deepseek-v4-flash`、system プロンプト先頭に `/no_think`（DeepSeek 系ソフトスイッチ）、本文 2000 字截断、タイトル 50 字上限、前後の引用符除去。
- 環境変数（Workers バインディング）: `AI_API_KEY`（secret）/ `AI_BASE_URL` / `AI_MODEL`。
  `wrangler.toml` の `[vars]` に `AI_BASE_URL = "https://opencode.ai/zen/go/v1"` と `AI_MODEL = "deepseek-v4-flash"` の既定あり。
- 依存: `package.json` の `"ai": "^7.0.31"` と `"@ai-sdk/openai-compatible": "^3.0.12"`。他で使用箇所なし（grep 確認済み）。
- テスト: `src/server/lib/__tests__/generateTitle.test.ts` と `src/server/routes/__tests__/memosAutoTitle.test.ts`。
  両者とも `vi.stubGlobal("fetch", ...)` で **素の JSON（`chat.completion`）応答**を返す方式。
- 既存 ADR: `docs/adr/0001-d1-as-datastore.md`、`docs/adr/0002-raw-org-text-storage.md` → 新規は **0003**。
- `CONTEXT.md`（ドメイン用語集）が存在する。

### pi-ai について確認済みの事実（v0.81.1 時点）

- ルートエクスポート: `createProvider`, `createModels`, `contentText`, 型 `Model<Api>`, `Context`。
- lazy エクスポート: `@earendil-works/pi-ai/api/openai-completions.lazy` が `openAICompletionsApi()` を提供する。
  これ経由でのみ import すると、他プロバイダ SDK がバンドルに引き込まれない。
- `models.complete(model, context): Promise<AssistantMessage>`（非ストリーミング呼び出し。内部では SSE ストリームを消費する）。
- `Model<'openai-completions'>` の必須フィールド: `id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `input`, `cost`（`{input, output, cacheRead, cacheWrite}`）, `contextWindow`, `maxTokens`。`compat` は省略可（**省略すると baseUrl から自動検出**。例: `opencode.ai` 経路では `supportsStore: false` 等が自動で付く）。
- pi-ai は API エラー時に throw せず `stopReason: 'error'`（または `'aborted'`）+ `errorMessage` の `AssistantMessage` を返す。
- 内部実装は `openai` SDK v6（fetch ベース。global fetch を使うので `vi.stubGlobal` が効く）。**5xx・接続エラーは SDK が自動リトライする（既定 2 回、バックオフ付き）。401 等の認証エラーはリトライされない。**
- `reasoning: false` のモデルでは system プロンプトは `system` ロールで送られる（`developer` ではない）。

### 決定事項（ユーザーと合意済み。変更しないこと）

- **D1（公開契約の維持）**: `generateTitle` のシグネチャと「絶対に throw せず `null` でフォールバックする」挙動は維持する。環境変数の事前チェック（`AI_API_KEY` / `AI_BASE_URL` 不足 → `null`）も残す。参照 PR の `requireEnv`（throw）方式は採用しない。
- **D2（抽象レベル）**: `createProvider()` + `createModels()` の pi 標準抽象に乗せる（`models.complete` で呼ぶ）。認証は `auth.resolve()` で `AI_API_KEY` をリクエストごとに解決し、`process.env` に依存しない（Workers バインディング対応）。
- **D3（メタデータ）**: モデルのメタデータは**固定の既定値**（`reasoning: false` / `cost: 0` / `input: ['text']` / `contextWindow: 128_000` / `maxTokens: 4096`）。カタログ（`providers/all` 等）からは借用しない（Workers バンドルが約 524〜900K 膨張するため。固定既定値なら約 148K 相当）。`compat` は明示せず baseUrl 自動検出に委ねる。
- **D4（外部仕様の維持）**: 環境変数 3 種・既定モデル `deepseek-v4-flash`・`wrangler.toml` の `[vars]`・`.dev.vars.example`・`/no_think` プレフィックス・2000 字截断・50 字上限・引用符除去は**すべて維持**。変更するのはコード・テスト・README/wrangler.toml のコメント・依存関係・ドキュメントのみ。
- **D5（テスト）**: global fetch スタブ方式を維持（新規依存なし）。フィクスチャを **SSE ストリーム応答**へ書き換える。エラー系は **401 応答**を使う（リトライされず高速）。リクエストボディのアサーション（`model` 名、opencode.ai 経路で `store` フィールド非送出、`system` ロール）を追加。ネットワークエラー時の null フォールバック検証は「fetch が throw」ケース 1 件を残す（SDK リトライで約 1〜2 秒かかるのは許容）。
- **D6（検証ゲート）**: 下記「完了条件」の 3 つをハードゲート、ライブスモークをユーザー最終確認とする。バンドルが失敗・異常膨張した場合は独断で workaround せず報告して再協議する。
- **D7（ドキュメント）**: ADR 0003 新規作成、`CONTEXT.md` に「Auto Title」用語追加、README と `wrangler.toml` コメント更新。これらは**コード変更と同じ PR で反映**する。
- **D8（依存）**: `ai` と `@ai-sdk/openai-compatible` を削除、`@earendil-works/pi-ai` を `^0.81.1` で追加。Renovate 設定の変更不要。

## 3. 解決すべきゴール (Goal & Objective)

- [ ] `package.json`: `ai` と `@ai-sdk/openai-compatible` を削除し、`@earendil-works/pi-ai: ^0.81.1` を追加。`npm install` で lockfile 再生成。
- [ ] `src/server/lib/generateTitle.ts` を pi-ai で再実装（詳細は下記 4 節）。公開契約と生成挙動は不変。
- [ ] `src/server/lib/__tests__/generateTitle.test.ts` を SSE フィクスチャ方式へ書き換え + リクエストボディ検証を追加。
- [ ] `src/server/routes/__tests__/memosAutoTitle.test.ts` の `mockFetchOnce` も SSE 方式へ書き換え（env なしのフォールバック系ケースはそのまま）。
- [ ] `docs/adr/0003-adopt-pi-ai-over-ai-sdk.md` を新規作成（文案は 5 節）。
- [ ] `CONTEXT.md` の Language セクションに「Auto Title」用語を追加（文案は 5 節）。
- [ ] `README.md`「タイトルの自動生成（AI）」節の「Vercel AI SDK（`generateText` / `createOpenAICompatible`）」記述を pi-ai（`openai-completions` API）へ置換。環境変数表・フォールバック説明は維持。ADR リストに 0003 を追加。
- [ ] `wrangler.toml` の AI 関連コメント「Vercel AI SDK」言及を pi-ai へ更新（`[vars]` の値は不変）。
- [ ] `.dev.vars.example` は変更しない。

## 4. 実装詳細

### 4.1 `generateTitle.ts` の骨格（参照 PR を org-memo の契約に適合させたもの）

```ts
import { contentText, createModels, createProvider } from "@earendil-works/pi-ai";
import type { Context, Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export interface AIBindings {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_BODY_CHARS = 2000;
const MAX_TITLE_CHARS = 50;

// 任意の OpenAI 互換エンドポイントを pi-ai の Models 抽象に乗せるためのプロバイダ ID。
const PROVIDER_ID = "org-memo";

// 固定の既定メタデータ。cost は未知なので 0、reasoning は使わないので false
// （thinking を有効化せず、system プロンプトは system ロールで送られる）。
// compat は pi-ai が baseUrl から自動検出する（opencode.ai 経由なら supportsStore:false 等）。
const fallbackModel: Model<"openai-completions"> = {
  id: DEFAULT_MODEL,
  name: DEFAULT_MODEL,
  api: "openai-completions",
  provider: PROVIDER_ID,
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
};

function buildModel(baseUrl: string, modelId: string): Model<"openai-completions"> {
  return { ...fallbackModel, id: modelId, name: modelId, baseUrl };
}

function createAi(env: AIBindings, baseUrl: string, apiKey: string, modelId: string) {
  const model = buildModel(baseUrl, modelId);
  const provider = createProvider<"openai-completions">({
    id: PROVIDER_ID,
    name: "Org Memo AI",
    baseUrl,
    auth: {
      apiKey: {
        name: "AI API key",
        resolve: () => Promise.resolve({ auth: { apiKey }, source: "AI_API_KEY" }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}

// pi-ai は API エラー時も throw せず stopReason: 'error' のメッセージを返すため、
// ここで throw に変換して従来の catch によるフォールバック経路に乗せる。
async function completeText(
  env: AIBindings, baseUrl: string, apiKey: string, modelId: string,
  systemPrompt: string, prompt: string,
): Promise<string> {
  const { models, model } = createAi(env, baseUrl, apiKey, modelId);
  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };
  const result = await models.complete(model, context);
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error(result.errorMessage ?? `AI request failed: ${result.stopReason}`);
  }
  return contentText(result.content).trim();
}

export async function generateTitle(body: string, env: AIBindings): Promise<string | null> {
  const apiKey = env.AI_API_KEY?.trim();
  const baseUrl = env.AI_BASE_URL?.trim();

  // 必須の 2 変数が揃わなければ生成不可 → フォールバック（従来契約の維持）
  if (!apiKey || !baseUrl) return null;

  const content = (body || "").trim();
  if (!content) return null;

  const truncated = content.length > MAX_BODY_CHARS ? content.slice(0, MAX_BODY_CHARS) + "…" : content;
  const modelId = env.AI_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const raw = await completeText(
      env, baseUrl, apiKey, modelId,
      "/no_think あなたはメモアプリのタイトルを作成するアシスタントです。…（現行のプロンプトをそのまま維持）",
      truncated,
    );
    if (!raw) return null;
    const cleaned = raw.replace(/^["'「『“”‘’]+|["'」』“”‘’]+$/g, "").trim();
    return cleaned.slice(0, MAX_TITLE_CHARS) || null;
  } catch (err) {
    console.warn("generateTitle failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
```

注意点:
- 現行ファイル冒頭の設計コメント（環境変数説明・フォールバック説明）は pi-ai に合わせて文言更新しつつ残す。
- system プロンプト本文は現行のものを**一字一句維持**する（`/no_think` 含む）。
- `createProvider` / `createModels` の型・引数は pi-ai のバージョンで変わり得る。`tsc` を通して実物に合わせること（参照 PR のコードが一次情報）。

### 4.2 テストの書き換え

SSE フィクスチャのヘルパー例（両テストファイルに配置。現状どおりファイルごとのローカルヘルパーでよい）:

```ts
function sseResponse(content: string, model = "test-model"): Response {
  const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model };
  const delta = { ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
  const stop = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  const body = `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(stop)}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
```

- 成功系: `vi.stubGlobal("fetch", vi.fn(async (_url, init) => { captured = JSON.parse(init.body); return sseResponse("テストタイトル"); }))` のように**リクエストボディをキャプチャ**する。
  - openai SDK が `fetch(url, init)` 形式で呼ぶ前提。もし `Request` オブジェクト単体で渡す実装だった場合は `new Request` 対応に読み替えること。
- 追加アサーション:
  - `captured.model` が指定モデル（既定テストでは `deepseek-v4-flash`）であること
  - `AI_BASE_URL` に `https://opencode.ai/...` を使ったケースで `captured` に **`store` プロパティが存在しない**こと（compat 自動検出の回帰防止）
  - `captured.messages[0].role === "system"` かつ `developer` ロールのメッセージが存在しないこと
- エラー系:
  - 環境変数不足 → `null`（既存ケースを維持）
  - **401 応答**（`{"error":{"message":"invalid api key"}}`, `content-type: application/json`）→ `null`（SDK がリトライしないので高速）
  - 「fetch が throw」→ `null` を 1 件残す（SDK リトライで 1〜2 秒かかる。必要ならそのテストだけ `it` のタイムアウトを伸ばす）
  - 空文字生成（SSE の content が空）→ `null`
- 既存の「既定モデル使用」「50 字截断」「引用符除去」「2000 字截断」等のケースは SSE 化して維持する。
- `memosAutoTitle.test.ts` の `mockFetchOnce` も `sseResponse` へ置換。env なしフォールバック（400 / `{title: null}`）のケースはネットワークを叩かないのでそのまま。

## 5. ドキュメント文案

### 5.1 `docs/adr/0003-adopt-pi-ai-over-ai-sdk.md`

```md
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
```

### 5.2 `CONTEXT.md` 追加用語（Language セクション末尾）

```md
**Auto Title**:
本文から AI が生成するメモのタイトル。ユーザーがタイトルを空にして保存しようとしたとき、または編集画面の「AIで生成」ボタンで得られる。生成できない場合（AI 未設定・失敗）は常に手動入力へフォールバックし、Memo の作成を妨げない。
_Avoid_: AI title, generated title
```

### 5.3 README 差分方針

「タイトルの自動生成（AI）」節の 1 段落を次へ置換:

> 接続には [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/main/packages/ai) の `openai-completions` API を使用し、OpenAI 互換の任意のエンドポイント（OpenCode Go 等）を呼び出します。`opencode.ai` 経路は pi-ai が自動で互換設定（`store` フィールドを送らない等）を判別します。次の 3 つの環境変数（Cloudflare Workers のバインディング）から接続情報を取得します。

環境変数表・フォールバックの説明・`wrangler secret put` の手順は維持。ADR リストに 0003 を追加。

### 5.4 `wrangler.toml`

コメント `# AI によるタイトル自動生成（OpenAI 互換エンドポイント / Vercel AI SDK）` を `# AI によるタイトル自動生成（OpenAI 互換エンドポイント / @earendil-works/pi-ai）` へ。`[vars]` の値は不変。

## 6. 完了条件（検証方法）

ハードゲート（すべて必須）:

1. `npm test` が緑（書き換えた SSE テスト含む）
2. `npx wrangler deploy --dry-run --outdir=dist-check` が成功し、サーバーバンドルのサイズが妥当（数百 KB 程度。MB 級に膨れていたらカタログ混入を疑い、報告して再協議する）
3. `npm run build`（クライアントの vite ビルド）が成功

ソフトゲート（ユーザー最終確認）:

4. 実 `.dev.vars`（本物の `AI_API_KEY`）で `npm run dev:api` を起動し、`POST /memos/generate-title`（または同等のルート）が opencode-go / deepseek-v4-flash に対して実際にタイトルを返すこと

その他:

- `tsc`（型チェック）が通ること
- `package.json` / lockfile から `ai`・`@ai-sdk/openai-compatible` が完全に消えていること（`npm ls ai` で確認）
- README・CONTEXT.md・ADR・wrangler.toml コメントが更新されていること

## 7. 補足

- 参照 PR の一次情報: https://patch-diff.githubusercontent.com/raw/hexx/rss-reader/pull/283.diff
- pi-ai の API 詳細は `node_modules/@earendil-works/pi-ai/dist/*.d.ts`（`models.d.ts`, `types.d.ts`, `api/openai-completions.lazy.d.ts`）が確実。
- PR タイトル案: 「ai-sdk を @earendil-works/pi-ai に置き換え」（参照 PR と同体裁）。
