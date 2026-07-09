import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { orgToHtml, docToOrg } from "../org-serialize";

describe("orgToHtml", () => {
  it("見出しを h1 に変換する", () => {
    expect(orgToHtml("* Hello")).toBe("<h1>Hello</h1>");
    expect(orgToHtml("** Sub")).toBe("<h2>Sub</h2>");
  });

  it("段落を p に変換し、インライン装飾をマップする", () => {
    expect(orgToHtml("plain text")).toBe("<p>plain text</p>");
    expect(orgToHtml("hello *bold* and /italic/")).toBe(
      "<p>hello <strong>bold</strong> and <em>italic</em></p>"
    );
    expect(orgToHtml("+gone+")).toBe("<p><s>gone</s></p>");
  });

  it("リストを ul/ol に変換する", () => {
    expect(orgToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(orgToHtml("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("インデント付きリストを入れ子構造に変換する", () => {
    expect(orgToHtml("- parent\n  - child")).toBe(
      "<ul><li>parent<ul><li>child</li></ul></li></ul>"
    );
  });

  it("行末のバックスラッシュを <br/> に変換する", () => {
    expect(orgToHtml("a\\\nb")).toContain("<br/>");
  });

  it("コードブロックを pre/code に変換する（内容を保持）", () => {
    const out = orgToHtml("#+BEGIN_SRC ts\nconst a = 1;\n#+END_SRC");
    expect(out).toBe('<pre><code class="language-ts">const a = 1;</code></pre>');
  });

  it("#+BEGIN_QUOTE を blockquote に変換する", () => {
    expect(orgToHtml("#+BEGIN_QUOTE\nhello\n#+END_QUOTE")).toBe(
      "<blockquote><p>hello</p></blockquote>"
    );
  });

  it("水平線 ----- を hr に変換する", () => {
    expect(orgToHtml("-----")).toBe("<hr/>");
  });

  it("説明なしリンク [[url]] を変換する", () => {
    expect(orgToHtml("[[https://x.com]]")).toBe(
      '<p><a href="https://x.com">https://x.com</a></p>'
    );
  });

  it("リンクの説明内のインライン装飾を変換する", () => {
    expect(orgToHtml("[[https://x.com][*site*]]")).toBe(
      '<p><a href="https://x.com"><strong>site</strong></a></p>'
    );
  });

  it("#+ ディレクティブ行は編集モデルに含めない", () => {
    expect(orgToHtml("#+TITLE: Foo\nbody text")).toBe("<p>body text</p>");
    expect(orgToHtml("#+FILETAGS: :work:")).toBe("");
  });

  it("入れ子のインライン装飾を正しく変換する", () => {
    expect(orgToHtml("*bold /italic/*")).toBe(
      "<p><strong>bold <em>italic</em></strong></p>"
    );
  });
});

describe("docToOrg", () => {
  it("見出し・太字・リスト・コード・リンクを org に変換する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1;" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "site",
              marks: [{ type: "link", attrs: { href: "https://x.com" } }],
            },
          ],
        },
      ],
    };

    const expected = [
      "** Title",
      "",
      "plain *bold*",
      "",
      "- one",
      "",
      "#+BEGIN_SRC ts",
      "const a = 1;",
      "#+END_SRC",
      "",
      "[[https://x.com][site]]",
    ].join("\n");

    expect(docToOrg(doc)).toBe(expected);
  });

  it("リンクマークを [[url][desc]] で出力する（太字と組み合わせ）", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "site",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "https://x.com" } },
              ],
            },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("[[https://x.com][*site*]]");
  });

  it("装飾内の区切り文字をエスケープする", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "cost is 2*3", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("*cost is 2\\*3*");
  });

  it("順序ありリストは 1. で出力する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "b" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("1. a\n1. b");
  });

  it("blockquote を #+BEGIN_QUOTE で出力する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "hello" }] },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("#+BEGIN_QUOTE\nhello\n#+END_QUOTE");
  });

  it("水平線を ----- で出力する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "horizontalRule" }],
    };
    expect(docToOrg(doc)).toBe("-----");
  });

  it("入れ子リストにインデントを付与する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "parent" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "child" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("- parent\n  - child");
  });

  it("hardBreak をバックスラッシュ改行で出力する", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toContain("\\");
  });

  it("複数の装飾を正しい順序でラップする", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "italic" }, { type: "bold" }],
            },
          ],
        },
      ],
    };
    expect(docToOrg(doc)).toBe("*/x/*");
  });
});
