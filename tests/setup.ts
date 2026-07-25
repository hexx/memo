import "@testing-library/jest-dom/vitest";

// jsdom に無い API のスタブ。
// ※ node 環境（サーバ/純粋ロジックのテスト）にもこの setup は読み込まれ、
//    node には Element 自体が存在しないため、必ず環境ガードを挟む
//    （ガードがないと ReferenceError で node テストまで道連れで落ちる）。
// Radix Dialog の react-remove-scroll が window.scrollTo を呼ぶ。
// jsdom は window.scrollTo を「呼ぶと Not implemented を吐く関数」として定義するため、
// 有無ではなく無条件で no-op に上書きする（node 環境には window 自体がないためガード）。
if (typeof window !== "undefined") {
  window.scrollTo = (): void => {};
}

if (typeof Element !== "undefined") {
  // jsdom は Element.scrollTo / scrollIntoView を未実装
  // （Radix メニューのスクロールや UI 側の scrollTo が使用）
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = (): void => {};
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = (): void => {};
  }
  // Radix の DropdownMenu/Dialog がポインターキャプチャ API を参照する
  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = (): boolean => false;
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = (): void => {};
  }
  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture = (): void => {};
  }
}

// jsdom の Range は getClientRects / getBoundingClientRect を未実装。
// TipTap (ProseMirror) が scrollToSelection 時にこれらを呼ぶため、
// ゼロサイズの矩形を返すスタブが必要。
if (typeof Range !== "undefined") {
  const emptyRect = {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  Range.prototype.getClientRects = (): DOMRectList =>
    ({
      length: 0,
      item: (): null => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = (): DOMRect => emptyRect;
}

// Radix 由来で必要になる場合があるオブザーバーの no-op 実装
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
