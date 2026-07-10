import type { JSONContent } from "@tiptap/core";
import {
  parseInline,
  stringify,
  createRoot,
  createParagraph,
  createPlainText,
  createBold,
  createItalic,
  createLink,
  createList,
  createHorizontalRule,
  createHardBreak,
} from "org-toolkit";
import type {
  InlineNode,
  LinkNode,
  Root as OrgRoot,
  List as OrgList,
  ListItem as OrgListItem,
  Block as OrgBlock,
  SourceRange,
} from "org-toolkit";

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
 * org-toolkit の最新版は以下をネイティブに提供するようになったため、自前の
 * インライントークナイザやエスケープ処理は廃止し、org-toolkit の AST を活用する:
 * - `parseInline`: インラインのみをパースする公開 API
 * - `stringify`: 装飾内の区切り文字をエスケープ（round-trip 安全）
 * - ネストリスト・水平線(-----)・ハード改行(行末 \) の表現
 *
 * 維持するのは TipTap 固有の HTML 規約のみの薄いマッピング層:
 * - 見出しは `*` の直後に空白が必要（org-mode と同様に `*bold` は見出しにならない）
 * - `#+TITLE:` などのディレクティブ行は編集モデルに持ち込まない
 * - 取り消し線は `<s>`、水平線は `<hr/>`、ハード改行は `<br/>` にマップ
 * - 引用ブロックは `<blockquote><p>...</p></blockquote>` にマップ
 */

// ---------------------------------------------------------------------------
// インライン変換（org AST → HTML）
// ---------------------------------------------------------------------------

/** org-toolkit が生成する AST 上の zero-length 位置（合成ノード用）。 */
const SYNTHETIC_POSITION: SourceRange = {
  start: { index: 0, line: 1, column: 1 },
  end: { index: 0, line: 1, column: 1 },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** org-toolkit のインライン AST を TipTap が読める HTML に変換する。 */
function renderInlineNodes(nodes: ReadonlyArray<InlineNode>): string {
  return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "bold":
      return `<strong>${renderInlineNodes(node.children)}</strong>`;
    case "italic":
      return `<em>${renderInlineNodes(node.children)}</em>`;
    case "underline":
      return `<u>${renderInlineNodes(node.children)}</u>`;
    case "strike-through":
      return `<s>${renderInlineNodes(node.children)}</s>`;
    case "code":
    case "verbatim":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "link":
      return renderLink(node);
    case "hard-break":
      return "<br/>";
    case "footnote-reference":
      return `[fn:${escapeHtml(node.label)}]`;
    case "timestamp":
      // タイムスタンプは TipTap の編集モデルに保持しない
      return "";
    default:
      return "";
  }
}

function renderLink(node: LinkNode): string {
  const href = escapeHtml(node.url);
  const inner = node.description
    ? renderInlineNodes(node.description)
    : escapeHtml(node.url);
  return `<a href="${href}">${inner}</a>`;
}

// ---------------------------------------------------------------------------
// org テキスト → HTML（TipTap の setContent 用）
// ---------------------------------------------------------------------------

/** 入れ子リストを再帰的に <ul>/<ol> へ変換する。 */
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
          ? `${renderInlineNodes(parseInline(l.slice(0, -1)))}<br/>`
          : renderInlineNodes(parseInline(l))
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

    // 見出し: * ~ ******（* の直後は空白必須）
    const heading = line.match(/^(\*+)\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 6);
      blocks.push(`<h${level}>${renderInlineNodes(parseInline(heading[2]))}</h${level}>`);
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
        if (m) items.push({ indent: m[1].length, html: renderInlineNodes(parseInline(m[2])) });
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
        if (m) items.push({ indent: m[1].length, html: renderInlineNodes(parseInline(m[2])) });
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

/** TipTap のインラインコンテンツを org のインライン AST に変換する。 */
function inlineNodesFromTiptap(content?: JSONContent[]): InlineNode[] {
  if (!content) return [];
  const out: InlineNode[] = [];
  for (const node of content) out.push(...inlineNodeFromTiptap(node));
  return out;
}

function inlineNodeFromTiptap(node: JSONContent): InlineNode[] {
  if (node.type === "text") return [textToOrgInline(node)];
  if (node.type === "hardBreak") return [createHardBreak()];
  // 未知のインラインノードは子要素をインラインとして抽出
  if (node.content) return inlineNodesFromTiptap(node.content);
  return [];
}

/**
 * テキストノード（マーク付き）を org のインライン AST に変換する。
 * マークは org の優先順位 code > underline > strike > italic > bold > link で
 * ネストさせ、外側から順にラップする（既存の round-trip と同じ順序）。
 */
function textToOrgInline(node: JSONContent): InlineNode {
  const text = node.text ?? "";
  const marks = (node.marks ?? []) as Mark[];
  const has = (t: string) => marks.some((m) => m.type === t);

  // code(=...=) は他の装飾を内包できないため最優先
  if (has("code")) {
    return { type: "code", value: text, position: SYNTHETIC_POSITION };
  }

  let inner: InlineNode[] = [createPlainText(text)];
  if (has("underline"))
    inner = [{ type: "underline", children: inner, position: SYNTHETIC_POSITION }];
  if (has("strike"))
    inner = [{ type: "strike-through", children: inner, position: SYNTHETIC_POSITION }];
  if (has("italic")) inner = [createItalic(inner)];
  if (has("bold")) inner = [createBold(inner)];
  if (has("link")) {
    const url = String(marks.find((m) => m.type === "link")?.attrs?.href ?? "");
    inner = [createLink(url, inner)];
  }
  return inner[0]!;
}

/** TipTap のブロックコンテンツを org のブロック AST に変換する。 */
function blocksFromTiptap(content?: JSONContent[]): OrgRoot["children"] {
  const out: OrgRoot["children"][number][] = [];
  for (const node of content ?? []) {
    const block = blockFromTiptap(node);
    if (block) out.push(block);
  }
  return out;
}

function blockFromTiptap(
  node: JSONContent
): OrgRoot["children"][number] | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        level: Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6),
        tags: [],
        properties: {},
        children: inlineNodesFromTiptap(node.content),
        position: SYNTHETIC_POSITION,
      };
    case "paragraph":
      return createParagraph(inlineNodesFromTiptap(node.content));
    case "bulletList":
      return buildListFromTiptap("unordered", node.content);
    case "orderedList":
      return buildListFromTiptap("ordered", node.content);
    case "codeBlock": {
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      const block: OrgBlock = {
        type: "block",
        blockName: "SRC",
        parameters: lang,
        content: `\n${code}\n`,
        position: SYNTHETIC_POSITION,
      };
      return block;
    }
    case "blockquote": {
      const inner = stringify(createRoot({}, blocksFromTiptap(node.content)));
      const block: OrgBlock = {
        type: "block",
        blockName: "QUOTE",
        parameters: "",
        content: `\n${inner}\n`,
        position: SYNTHETIC_POSITION,
      };
      return block;
    }
    case "horizontalRule":
      return createHorizontalRule();
    default:
      // 未知のブロックは段落として抽出
      return createParagraph(inlineNodesFromTiptap(node.content));
  }
}

/** TipTap のリストアイテムを org の list-item AST に変換する。
 * `kind` は所属するリストの種別で、marker の既定値（順序ありは `1.`、なしは `-`）を決める。
 * 最終的な marker は createList でも正規化されるが、意図を明確にするためここで設定する。 */
function listItemFromTiptap(
  item: JSONContent,
  kind: "unordered" | "ordered"
): OrgListItem {
  const para = (item.content ?? []).find((c) => c.type === "paragraph");
  const nested = (item.content ?? []).filter(
    (c) => c.type === "bulletList" || c.type === "orderedList"
  );
  const subList =
    nested.length > 0
      ? buildListFromTiptap(
          nested[0]!.type === "orderedList" ? "ordered" : "unordered",
          nested[0]!.content
        )
      : undefined;

  return {
    type: "list-item",
    marker: kind === "ordered" ? "1." : "-",
    checkbox: null,
    children: inlineNodesFromTiptap(para?.content),
    position: SYNTHETIC_POSITION,
    ...(subList ? { subList } : {}),
  };
}

/** TipTap のリスト（順序なし/あり）を org の list AST に変換する。 */
function buildListFromTiptap(
  kind: "unordered" | "ordered",
  items?: JSONContent[]
): OrgList {
  return createList(kind, (items ?? []).map((item) => listItemFromTiptap(item, kind)));
}

/**
 * TipTap のドキュメント(JSONContent)を org テキストにシリアライズする。
 * 装飾内の区切り文字エスケープは org-toolkit の stringify が担う。
 */
export function docToOrg(doc: JSONContent): string {
  const root = createRoot({}, blocksFromTiptap(doc.content));
  return stringify(root);
}
