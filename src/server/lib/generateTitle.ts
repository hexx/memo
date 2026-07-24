// メモ本文からタイトルを AI で生成するユーティリティ。
//
// `@earendil-works/pi-ai`（https://github.com/earendil-works/pi/tree/main/packages/ai）の
// `openai-completions` API を createProvider() + Models コレクションの pi 標準抽象で利用し、
// OpenAI 互換の任意のエンドポイントから短い日本語のタイトルを 1 つ生成する。
// Cloudflare Workers でもそのまま動作する。
//
// 接続情報は次の 3 つの環境変数（Cloudflare Workers のバインディング）から取得する。
//   - AI_API_KEY  : API キー（Authorization: Bearer に使用）。秘匿値
//   - AI_BASE_URL : ベース URL（例: https://opencode.ai/zen/go/v1）
//   - AI_MODEL    : モデル名（例: deepseek-v4-flash）。未設定時は既定値を使用
//
// いずれかの必須変数が未設定の場合、または呼び出しが失敗した場合は
// null を返し、呼び出し側で「既存の手動入力フロー」へ安全にフォールバックする。

import { contentText, createModels, createProvider } from "@earendil-works/pi-ai";
import type { Context, Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export interface AIBindings {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "deepseek-v4-flash"; // OpenCode Go エンドポイント向けの既定モデル
const MAX_BODY_CHARS = 2000; // LLM へ送る本文の最大文字数
const MAX_TITLE_CHARS = 50; // 生成タイトルの最大文字数

// 任意の OpenAI 互換エンドポイントを pi-ai の Models 抽象に乗せるためのプロバイダ ID。
const PROVIDER_ID = "org-memo";

// 任意の OpenAI 互換エンドポイントに使う固定の既定メタデータ。
// cost は未知なので 0、reasoning は使わないので false（thinking を有効化せず、
// system プロンプトは system ロールで送られる）。compat は pi-ai が baseUrl から
// 自動検出する（例: opencode.ai 経由なら supportsStore:false 等が正しく付く）。
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

/**
 * 固定の既定メタデータから、指定のモデル ID と接続先を持つモデルを組み立てます。
 * compat は設定せず、pi-ai の baseUrl 自動検出に任せます。
 */
function buildModel(baseUrl: string, modelId: string): Model<"openai-completions"> {
  return { ...fallbackModel, id: modelId, name: modelId, baseUrl };
}

/**
 * 環境バインディングから pi-ai の Models コレクションとモデルを組み立てます。
 * 認証は AI_API_KEY をリクエストごとに明示渡しし（process.env に依存しない）、
 * Cloudflare Workers のバインディング経由でも動作します。
 */
function createAi(baseUrl: string, apiKey: string, modelId: string) {
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

/**
 * system プロンプトと user プロンプトを OpenAI 互換エンドポイントへ非ストリーミングで送信し、
 * 生成テキストを返します。
 *
 * pi-ai は API エラー時に throw せず stopReason: 'error' のメッセージを返すため、
 * ここで throw に変換して呼び出し側の catch によるフォールバック経路に乗せます。
 */
async function completeText(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  prompt: string
): Promise<string> {
  const { models, model } = createAi(baseUrl, apiKey, modelId);

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

export async function generateTitle(
  body: string,
  env: AIBindings
): Promise<string | null> {
  const apiKey = env.AI_API_KEY?.trim();
  const baseUrl = env.AI_BASE_URL?.trim();

  // 必須の 2 変数が揃わなければ生成不可 → フォールバック
  if (!apiKey || !baseUrl) return null;

  const content = (body || "").trim();
  if (!content) return null;

  const truncated =
    content.length > MAX_BODY_CHARS
      ? content.slice(0, MAX_BODY_CHARS) + "…"
      : content;

  const modelId = env.AI_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const raw = await completeText(
      baseUrl,
      apiKey,
      modelId,
      // 先頭の /no_think は DeepSeek 系推論モデルのソフトスイッチ。
      // タイトル生成は単純タスクのため推論（思考）を無効化し、レイテンシと
      // 思考テキストの混入を抑止する。
      "/no_think あなたはメモアプリのタイトルを作成するアシスタントです。与えられたメモ本文から、内容を端的に表す短い日本語のタイトルを1つだけ生成してください。20文字程度とし、句読点や引用符は不要です。説明や補足は書かず、タイトル文字列のみを出力してください。",
      truncated
    );

    if (!raw) return null;

    // 前後の引用符・空白を除去し、長すぎる場合は切り詰める
    // （ASCII の " ' と、和文の 「 『 ” ’ 等に対応）
    const cleaned = raw.replace(/^["'「『“”‘’]+|["'」』“”‘’]+$/g, "").trim();
    return cleaned.slice(0, MAX_TITLE_CHARS) || null;
  } catch (err) {
    // ネットワークエラー・タイムアウト等はすべてフォールバック（デバッグ用に記録）
    console.warn(
      "generateTitle failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
