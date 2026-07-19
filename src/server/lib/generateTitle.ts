// メモ本文からタイトルを AI で生成するユーティリティ。
//
// Vercel AI SDK（`ai` の generateText）と `@ai-sdk/openai-compatible` の
// createOpenAICompatible を使用し、OpenAI 互換の任意のエンドポイントから
// 短い日本語のタイトルを 1 つ生成する。Cloudflare Workers でもそのまま動作する。
//
// 接続情報は次の 3 つの環境変数（Cloudflare Workers のバインディング）から取得する。
//   - AI_API_KEY  : API キー（Authorization: Bearer に使用）。秘匿値
//   - AI_BASE_URL : ベース URL（例: https://opencode.ai/zen/go/v1）
//   - AI_MODEL    : モデル名（例: qwen3.7-max）。未設定時は既定値を使用
//
// いずれかの必須変数が未設定の場合、または呼び出しが失敗した場合は
// null を返し、呼び出し側で「既存の手動入力フロー」へ安全にフォールバックする。

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export interface AIBindings {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "qwen3.7-max"; // OpenCode Go エンドポイント向けの既定モデル
const MAX_BODY_CHARS = 2000; // LLM へ送る本文の最大文字数
const MAX_TITLE_CHARS = 50; // 生成タイトルの最大文字数

function createAiProvider(env: AIBindings) {
  return createOpenAICompatible({
    apiKey: env.AI_API_KEY ?? "",
    baseURL: env.AI_BASE_URL ?? "",
    name: "opencode-go",
  });
}

function getChatModel(env: AIBindings) {
  const modelId = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  return createAiProvider(env).chatModel(modelId);
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

  try {
    const result = await generateText({
      model: getChatModel(env),
      system:
        "あなたはメモアプリのタイトルを作成するアシスタントです。与えられたメモ本文から、内容を端的に表す短い日本語のタイトルを1つだけ生成してください。20文字程度とし、句読点や引用符は不要です。説明や補足は書かず、タイトル文字列のみを出力してください。",
      prompt: truncated,
    });

    const raw = result.text.trim();
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
