import type { JSONContent } from "@tiptap/core";

/**
 * org-mode テキストと TipTap(ProseMirror) のドキュメントモデルを相互変換する。
 *
 * 設計方針（docs/adr/0002-raw-org-text-storage.md に準拠）:
 * - 保存時は TipTap の JSON → org テキストへシリアライズし、生の org テキストとして
 *   API に送信する（既存の保存/読み込みフローはそのまま）。
 * - 読み込み時は既存の org テキスト → TipTap が解釈できる HTML へデシリアライズする。
 *
 * サポートする要素は CONTEXT.md の「Org notation」に合わせる:
 * 見出し、順序なし/ありリスト、太字、イタリック、取り消し線、コードブロック、リンク。
 * （下線(underline) は StarterKit が提供するため編集可能だが、org では `_text_` にマップする）
 *
 * 注意: このモジュールはブラウザバンドルに含まれるため、Node 組み込みに依存する
 * org-toolkit の index エントリは使用せず、軽量な自前パーサーを採用している。
 */

// ---------------------------------------------------------------------------
// インライン変換（org 記法 → HTML）
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseInline(text: string): string {
  const wrap = (delim: string, inner: string): string => {
    switch (delim) {
      case "*":
        return `<strong>${inner}</strong>`;
      case "/":
        return `<em>${inner}</em>`;
      case "+":
        return `<s>${inner}</s>`;
      case "_":
        return `<u>${inner}</u>`;
      case "=":
      case "~":
        return `<code>${inner}</code>`;
      default:
        return inner;
    }
  };

  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];

    // リンク: [[url][desc]] または [[url]]
    if (c === "[" && text[i + 1] === "[") {
      const end = text.indexOf("]]", i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        const m = inner.match(/^([^\]]+)\]\[([^\]]*)$/);
        if (m) {
          out += `<a href="${escapeHtml(m[1])}">${parseInline(m[2])}</a>`;
          i = end + 2;
          continue;
        }
        // 説明なしリンク [[url]]
        const bare = inner.match(/^([^\]]+)$/);
        if (bare) {
          out += `<a href="${escapeHtml(bare[1])}">${escapeHtml(bare[1])}</a>`;
          i = end + 2;
          continue;
        }
      }
    }

    // インライン装飾: * / + _ = ~ （再帰で入れ子も許容。= ~ は verbatim のため内部を解析しない）
    if (c === "*" || c === "/" || c === "+" || c === "_" || c === "=" || c === "~") {
      const close = text.indexOf(c, i + 1);
      if (close !== -1) {
        const inner = text.slice(i + 1, close);
        if (inner.length > 0 && inner.indexOf(c) === -1) {
          const innerHtml =
            c === "=" || c === "~" ? escapeHtml(inner) : parseInline(inner);
          out += wrap(c, innerHtml);
          i = close + 1;
          continue;
        }
      }
    }

    // バックスラッシュは org のエスケープ文字。次の1文字をリテラルとして扱う
    if (c === "\\") {
      const next = text[i + 1];
      if (next !== undefined) {
        out += escapeHtml(next);
        i += 2;
        continue;
      }
      out += "\\\\";
      i++;
      continue;
    }

    out += escapeHtml(c);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// org テキスト → HTML（TipTap の setContent 用）
// ---------------------------------------------------------------------------

/**
 * 既存の org テキストを TipTap が読み込める HTML に変換する。
 * パースできない特殊な構文は段落テキストとして取り込む（フォールバック）。
 */
function buildList(
  items: { indent: number; html: string }[],
  kind: "unordered" | "ordered"
): string {
  const render = (
    start: number,
    baseIndent: number
  ): { html: string; next: number } => {
    const tag = kind === "ordered" ? "ol" : "ul";
    let html = `<${tag}>`;
    let i = start;
    while (i < items.length && items[i].indent >= baseIndent) {
      const item = items[i];
      let liInner = item.html;
      i++;
      if (i < items.length && items[i].indent > item.indent) {
        const child = render(i, items[i].indent);
        liInner += child.html;
        i = child.next;
      }
      html += `<li>${liInner}</li>`;
    }
    html += `</${tag}>`;
    return { html, next: i };
  };
  return render(0, items[0]?.indent ?? 0).html;
}

function parseBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length) {
      // 行末の \ は org のハード改行 → <br/>
      const parts = paragraphBuf.map((l) =>
        l.endsWith("\\")
          ? `${parseInline(l.slice(0, -1))}<br/>`
          : parseInline(l)
      );
      blocks.push(`<p>${parts.join(" ")}</p>`);
      paragraphBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // コードブロック: #+BEGIN_SRC ... #+END_SRC
    const beginSrc = line.match(/^#\+BEGIN_SRC(.*)$/);
    if (beginSrc) {
      flushParagraph();
      const lang = beginSrc[1].trim();
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("#+END_SRC")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // END_SRC をスキップ
      blocks.push(
        `<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    // 引用ブロック: #+BEGIN_QUOTE ... #+END_QUOTE
    if (/^#\+BEGIN_QUOTE\s*$/.test(line)) {
      flushParagraph();
      const inner: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("#+END_QUOTE")) {
        inner.push(lines[i]);
        i++;
      }
      i++; // END_QUOTE をスキップ
      blocks.push(`<blockquote>${parseBlocks(inner).join("")}</blockquote>`);
      continue;
    }

    // 見出し: * ~ ******
    const heading = line.match(/^(\*+)\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 6);
      blocks.push(`<h${level}>${parseInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // 水平線: -----
    if (/^-{5,}$/.test(line)) {
      flushParagraph();
      blocks.push("<hr/>");
      i++;
      continue;
    }

    // 順序なしリスト: - / + （インデントによる入れ子対応）
    if (/^\s*[-+]\s+/.test(line)) {
      flushParagraph();
      const items: { indent: number; html: string }[] = [];
      while (i < lines.length && /^\s*[-+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-+]\s+(.*)$/);
        if (m) items.push({ indent: m[1].length, html: parseInline(m[2]) });
        i++;
      }
      blocks.push(buildList(items, "unordered"));
      continue;
    }

    // 順序ありリスト: 1. / 2. （インデントによる入れ子対応）
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: { indent: number; html: string }[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
        if (m) items.push({ indent: m[1].length, html: parseInline(m[2]) });
        i++;
      }
      blocks.push(buildList(items, "ordered"));
      continue;
    }

    // ディレクティブ行（#+TITLE: 等）やコメント行（# ）は編集モデルに持ち込まない
    if (line.startsWith("#+") || line.startsWith("# ")) {
      flushParagraph();
      i++;
      continue;
    }

    // 空行は段落の区切り
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    // その他は段落の一部として連結（org では改行＝半角スペース）
    paragraphBuf.push(line.trim());
    i++;
  }
  flushParagraph();

  return blocks;
}

/**
 * 既存の org テキストを TipTap が読み込める HTML に変換する。
 * パースできない特殊な構文は段落テキストとして取り込む（フォールバック）。
 */
export function orgToHtml(org: string): string {
  if (!org || !org.trim()) return "";
  return parseBlocks(org.split("\n")).join("");
}

// ---------------------------------------------------------------------------
// TipTap JSON → org テキスト（保存用）
// ---------------------------------------------------------------------------

type Mark = { type: string; attrs?: Record<string, unknown> };

function applyMarks(text: string, marks: Mark[]): string {
  // コード(=...=) は他の装飾を内包できないため最優先。内部の = もエスケープ
  if (marks.some((m) => m.type === "code"))
    return `=${text.replace(/=/g, "\\=")}=`;
  let out = text;
  // 外側から順にラップする。内側の区切り文字をエスケープしてラウンドトリップを保つ
  if (marks.some((m) => m.type === "underline"))
    out = `_${out.replace(/_/g, "\\_")}_`;
  if (marks.some((m) => m.type === "strike"))
    out = `+${out.replace(/\+/g, "\\+")}+`;
  if (marks.some((m) => m.type === "italic"))
    out = `/${out.replace(/\//g, "\\/")}/`;
  if (marks.some((m) => m.type === "bold"))
    out = `*${out.replace(/\*/g, "\\*")}*`;
  // リンクは TipTap では text のマーク。説明内の `]` をエスケープ
  if (marks.some((m) => m.type === "link")) {
    const linkMark = marks.find((m) => m.type === "link");
    const url = String(linkMark?.attrs?.href ?? "");
    const desc = out.replace(/\]/g, "\\]");
    out = `[[${url}][${desc}]]`;
  }
  return out;
}

function textNodeToOrg(node: JSONContent): string {
  const text = node.text ?? "";
  return applyMarks(text, (node.marks ?? []) as Mark[]);
}

function inlineNodesToOrg(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return nodes.map(inlineToOrg).join("");
}

function inlineToOrg(node: JSONContent): string {
  if (node.type === "text") return textNodeToOrg(node);
  if (node.type === "hardBreak") return "\\\n";
  // リンクは TipTap では text のマークとして表現されるため、
  // text ノードの marks 経由で applyMarks 内で処理される
  return inlineNodesToOrg(node.content);
}

function listItemToOrg(li: JSONContent, indent: string, marker: string): string {
  const inner = (li.content ?? [])
    .map((n) => {
      if (n.type === "paragraph") return inlineNodesToOrg(n.content);
      // 入れ子リストは1段深くインデント
      const block = nodeToOrg(n, indent + "  ");
      return block ?? "";
    })
    .filter((s) => s !== null)
    .join("\n");
  return `${indent}${marker} ${inner}`;
}

function nodeToOrg(node: JSONContent, indent = ""): string | null {
  switch (node.type) {
    case "paragraph":
      return inlineNodesToOrg(node.content);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const stars = "*".repeat(level);
      return `${stars} ${inlineNodesToOrg(node.content)}`;
    }
    case "bulletList":
      return (node.content ?? [])
        .map((li) => listItemToOrg(li, indent, "-"))
        .join("\n");
    case "orderedList":
      // org は自動採番されるため全 item を "1." で出力
      return (node.content ?? [])
        .map((li) => listItemToOrg(li, indent, "1."))
        .join("\n");
    case "codeBlock": {
      const lang = node.attrs?.language ? ` ${String(node.attrs.language)}` : "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return `#+BEGIN_SRC${lang}\n${code}\n#+END_SRC`;
    }
    case "blockquote": {
      const inner = (node.content ?? [])
        .map((n) => nodeToOrg(n))
        .filter((x): x is string => x !== null)
        .join("\n\n");
      return `#+BEGIN_QUOTE\n${inner}\n#+END_QUOTE`;
    }
    case "horizontalRule":
      return "-----";
    default:
      // 未知のブロックはインラインとして抽出
      return inlineNodesToOrg(node.content);
  }
}

/**
 * TipTap のドキュメント(JSONContent)を org テキストにシリアライズする。
 */
export function docToOrg(doc: JSONContent): string {
  const blocks: string[] = [];
  for (const node of doc.content ?? []) {
    const block = nodeToOrg(node);
    if (block !== null) blocks.push(block);
  }
  // 空の段落は空文字として扱い、ブロック間は空行で区切る
  const text = blocks.join("\n\n");
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}
