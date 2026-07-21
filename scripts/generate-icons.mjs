/**
 * Org Memo — PWA アイコン生成スクリプト
 *
 * 外部画像ライブラリに依存せず、純粋な Node.js (zlib) で PNG をラスタライズする。
 * デザイン: ダークな丸角背景 + 折り目付きメモカード + org-mode の `*` ブレットと見出し/本文バー。
 *
 * 使い方: node scripts/generate-icons.mjs
 * 出力先: public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png,
 *         public/apple-touch-icon.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/* ------------------------------------------------------------------ */
/* PNG エンコーダ                                                      */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** size×size の RGBA (Uint8Array) を PNG バッファに変換する */
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 1行ごとにフィルタバイト(0=None)を先頭に付与
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* ラスタライザ（4x スーパーサンプリングでアンチエイリアス）            */
/* ------------------------------------------------------------------ */

const SS = 4;
const D = 512; // 設計空間のサイズ

function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
    255,
  ];
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function triSign(px, py, a, b) {
  return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
}

function inTriangle(px, py, a, b, c) {
  const d1 = triSign(px, py, a, b);
  const d2 = triSign(px, py, b, c);
  const d3 = triSign(px, py, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

/**
 * アイコンを描画して RGBA バッファを返す。
 * @param {number} size 出力ピクセルサイズ
 * @param {number} contentScale コンテンツの縮小率（maskable 用にセーフゾーンへ収める）
 */
function renderIcon(size, contentScale = 1) {
  const grid = size * SS;
  const px = new Uint8Array(grid * grid * 4); // 透明で初期化

  // 設計座標 → グリッド座標
  const g = (v) => (v / D) * grid;
  // コンテンツ座標をアイコン中心基準でスケーリング
  const s = (v) => D / 2 + (v - D / 2) * contentScale;

  /** 述語関数と色で領域を塗りつぶす（後勝ち） */
  function paint(x0, y0, x1, y1, color, predicate) {
    const gx0 = Math.max(0, Math.floor(g(x0)));
    const gy0 = Math.max(0, Math.floor(g(y0)));
    const gx1 = Math.min(grid, Math.ceil(g(x1)));
    const gy1 = Math.min(grid, Math.ceil(g(y1)));
    for (let gy = gy0; gy < gy1; gy++) {
      const dy = ((gy + 0.5) / grid) * D;
      for (let gx = gx0; gx < gx1; gx++) {
        const dx = ((gx + 0.5) / grid) * D;
        if (predicate(dx, dy)) {
          const i = (gy * grid + gx) * 4;
          px[i] = color[0];
          px[i + 1] = color[1];
          px[i + 2] = color[2];
          px[i + 3] = color[3];
        }
      }
    }
  }

  const C = {
    bg: hex("#171717"),
    sheet: hex("#fafafa"),
    fold: hex("#c9c9c9"),
    ink: hex("#171717"),
    inkSoft: hex("#a6a6a6"),
  };

  /* 1. 背景（maskable でも全面を覆う） */
  paint(0, 0, D, D, C.bg, (x, y) => inRoundedRect(x, y, 0, 0, D, D, 112));

  /* 2. メモカード（右上を斜めにカット） */
  const sh = { x0: s(136), y0: s(104), x1: s(376), y1: s(408), r: 18 * contentScale };
  const cut = 64 * contentScale;
  const cutTri = [
    [s(376) - cut, s(104)],
    [s(376), s(104)],
    [s(376), s(104) + cut],
  ];
  paint(sh.x0, sh.y0, sh.x1, sh.y1, C.sheet, (x, y) =>
    inRoundedRect(x, y, sh.x0, sh.y0, sh.x1, sh.y1, sh.r) &&
    !inTriangle(x, y, cutTri[0], cutTri[1], cutTri[2])
  );

  /* 3. 折り目フラップ */
  const flap = [
    [s(376) - cut, s(104)],
    [s(376), s(104) + cut],
    [s(376) - cut, s(104) + cut],
  ];
  paint(
    flap[0][0],
    flap[0][1],
    flap[1][0],
    flap[2][1],
    C.fold,
    (x, y) => inTriangle(x, y, flap[0], flap[1], flap[2])
  );

  /* 4. org-mode の `*` ブレット（3本線のアスタリスク） */
  const ast = { cx: s(192), cy: s(196), half: 28 * contentScale, w: 6.5 * contentScale };
  const angles = [90, 30, 150].map((a) => (a * Math.PI) / 180);
  for (const t of angles) {
    const ex = Math.cos(t) * ast.half;
    const ey = Math.sin(t) * ast.half;
    const ax = ast.cx - ex;
    const ay = ast.cy - ey;
    const bx = ast.cx + ex;
    const by = ast.cy + ey;
    paint(
      Math.min(ax, bx) - ast.w,
      Math.min(ay, by) - ast.w,
      Math.max(ax, bx) + ast.w,
      Math.max(ay, by) + ast.w,
      C.ink,
      (x, y) => distToSegment(x, y, ax, ay, bx, by) <= ast.w
    );
  }

  /* 5. 見出しバー（太く濃く） */
  const h1 = { x0: s(232), y0: s(182), x1: s(336), y1: s(210) };
  paint(h1.x0, h1.y0, h1.x1, h1.y1, C.ink, (x, y) =>
    inRoundedRect(x, y, h1.x0, h1.y0, h1.x1, h1.y1, 14 * contentScale)
  );

  /* 6. 本文バー（細く薄く、幅に変化） */
  const bars = [
    { x0: 176, y0: 252, x1: 336, y1: 272 },
    { x0: 176, y0: 296, x1: 316, y1: 316 },
    { x0: 176, y0: 340, x1: 330, y1: 360 },
  ];
  for (const b of bars) {
    const r = { x0: s(b.x0), y0: s(b.y0), x1: s(b.x1), y1: s(b.y1) };
    paint(r.x0, r.y0, r.x1, r.y1, C.inkSoft, (x, y) =>
      inRoundedRect(x, y, r.x0, r.y0, r.x1, r.y1, 10 * contentScale)
    );
  }

  /* ダウンスケール（SS×SS ブロック平均） */
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        gc = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * grid + (x * SS + sx)) * 4;
          r += px[i];
          gc += px[i + 1];
          b += px[i + 2];
          a += px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(gc / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 出力                                                                */
/* ------------------------------------------------------------------ */

const targets = [
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.88 },
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
];

for (const t of targets) {
  const rgba = renderIcon(t.size, t.scale);
  writeFileSync(join(OUT_DIR, t.file), encodePNG(t.size, rgba));
  console.log(`✓ ${t.file} (${t.size}x${t.size})`);
}
