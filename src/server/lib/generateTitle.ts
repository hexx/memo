// メモ本文からタイトルを AI で生成するユーティリティ。
//
// OpenAI 互換のチャット API（OpenCode Go エンドポイント）を呼び出し、
// 与えられた本文から短い日本語のタイトルを 1 つ生成する。
//
// 接続情報は次の 3 つの環境変数（Cloudflare Workers のバインディング）から取得する。
//   - OPENCODE_GO_API_KEY  : API キー（Authorization: Bearer に使用）
//   - OPENCODE_GO_BASE_URL : ベース URL（例: https://opencode.ai/zen/go/v1）
//   - OPENCODE_GO_MODEL    : モデル名（例: qwen3.7-max）
//
// いずれかの変数が未設定の場合、または呼び出しが失敗・タイムアウトした場合は
// null を返し、呼び出し側で「既存の手動入力フロー」へ安全にフォールバックする。

export interface OpenCodeGoBindings {
  OPENCODE_GO_API_KEY?: string;
  OPENCODE_GO_BASE_URL?: string;
  OPENCODE_GO_MODEL?: string;
}

const MAX_BODY_CHARS = 2000; // LLM へ送る本文の最大文字数
const TIMEOUT_MS = 15_000; // LLM 呼び出しのタイムアウト
const MAX_TITLE_CHARS = 50; // 生成タイトルの最大文字数

export async function generateTitle(
  body: string,
  env: OpenCodeGoBindings
): Promise<string | null> {
  const apiKey = env.OPENCODE_GO_API_KEY?.trim();
  const baseUrl = env.OPENCODE_GO_BASE_URL?.trim();
  const model = env.OPENCODE_GO_MODEL?.trim();

  // 3 つの環境変数が揃わなければ生成不可 → フォールバック
  if (!apiKey || !baseUrl || !model) return null;

  const content = (body || "").trim();
  if (!content) return null;

  const truncated =
    content.length > MAX_BODY_CHARS
      ? content.slice(0, MAX_BODY_CHARS) + "…"
      : content;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 64,
        messages: [
          {
            role: "system",
            content:
              "あなたはメモアプリのタイトルを作成するアシスタントです。与えられたメモ本文から、内容を端的に表す短い日本語のタイトルを1つだけ生成してください。20文字程度とし、句読点や引用符は不要です。説明や補足は書かず、タイトル文字列のみを出力してください。",
          },
          {
            role: "user",
            content: truncated,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    // 前後の引用符・空白を除去し、長すぎる場合は切り詰める
    // （ASCII の " ' と、和文の 「 『 ” ’ 等に対応）
    const cleaned = raw.replace(/^["'「『“‘]+|["'」』”’]+$/g, "").trim();
    return cleaned.slice(0, MAX_TITLE_CHARS) || null;
  } catch (err) {
    // ネットワークエラー・タイムアウト等はすべてフォールバック（デバッグ用に記録）
    console.warn(
      "generateTitle failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
