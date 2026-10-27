import { makePause } from "./yield.js";
// A file name stem with no path, control or bidi characters and no Windows
// device name.
export function safeStem(name) {
  const stem =
    String(name)
      .replace(/\.[^.]*$/, "")
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 80) || "image";
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)
    ? "image-" + stem
    : stem;
}
export function outputName(
  name,
  format = "png",
  target = "shifted",
  suffix = "",
) {
  const stem = safeStem(name);
  const tag = /^#[\da-f]{6}$/i.test(target)
    ? target.slice(1).toLowerCase()
    : "shifted";
  const ext = format === "zip" ? "zip" : /^webp/.test(format) ? "webp" : "png",
    extra = /^[\w-]{1,32}$/.test(suffix) ? "-" + suffix : "";
  return stem + "-" + tag + extra + "." + ext;
}
// Rounded up, so a file is never shown smaller than it is.
export function formatBytes(n) {
  if (n < 1024) return n + " bytes";
  const [v, unit] = n < 1048576 ? [n / 1024, "KB"] : [n / 1048576, "MB"];
  return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)) + " " + unit;
}
// Browser Canvas WebP encoders are lossy, even at quality=1. Use a small VP8L
// literal encoder for genuinely lossless, alpha-preserving WebP without a codec dependency.
export async function losslessWebP(width, height, pixels) {
  checkDimensions(width, height, pixels);
  const pause = makePause();
  const bytes = new Uint8Array(pixels.length + 512);
  let acc = 0,
    bits = 0,
    length = 0;
  const put = (value, count) => {
    acc |= value << bits;
    bits += count;
    while (bits >= 8) {
      bytes[length++] = acc & 255;
      acc >>>= 8;
      bits -= 8;
    }
  };
  put(0, 1);
  put(0, 1);
  put(0, 1); // no transform, cache, or meta Huffman image
  // Five canonical Huffman trees: green alphabet (280), red, blue, alpha, distance.
  // A complete 256-symbol eight-bit tree, described by a two-symbol code-length tree.
  function tree(size) {
    put(0, 1);
    put(8, 4); // 12 code-length lengths in WebP order
    const order = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8];
    for (const s of order) put(s === 0 || s === 8 ? 1 : 0, 3);
    put(0, 1);
    for (let i = 0; i < size; i++) put(i < 256 ? 1 : 0, 1);
  }
  tree(280);
  tree(256);
  tree(256);
  tree(256);
  put(1, 1);
  put(0, 1);
  put(0, 1);
  put(0, 1); // simple one-symbol distance tree, symbol 0
  const reverse = (v) => {
    v = ((v & 85) << 1) | ((v >>> 1) & 85);
    v = ((v & 51) << 2) | ((v >>> 2) & 51);
    return ((v & 15) << 4) | (v >>> 4);
  };
  for (let i = 0; i < pixels.length; i += 4) {
    if ((i & 262143) === 0) await pause();
    put(reverse(pixels[i + 1]), 8);
    put(reverse(pixels[i]), 8);
    put(reverse(pixels[i + 2]), 8);
    put(reverse(pixels[i + 3]), 8);
  }
  if (bits) bytes[length++] = acc;
  const size = 5 + length,
    pad = size & 1,
    out = new Uint8Array(20 + size + pad),
    v = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0);
  v.setUint32(4, out.length - 8, true);
  out.set([87, 69, 66, 80, 86, 80, 56, 76], 8);
  v.setUint32(16, size, true);
  out[20] = 47;
  v.setUint32(21, (width - 1) | ((height - 1) << 14) | (1 << 28), true);
  out.set(bytes.subarray(0, length), 25);
  return new Blob([out], { type: "image/webp" });
}
export const WEBP_UNAVAILABLE =
  "Small WebP files can't be made in this browser. Use Chrome, Edge or Firefox, or the Hex Shift Windows app.";
let webpSupport;
export function canEncodeWebP() {
  if (webpSupport === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupport;
}
// Lossy WebP from the browser's own encoder, at the highest quality whose file
// fits `limit`. File size falls with quality, so bisection finds it in a few
// encodes; 0.9 is tried first because most stickers fit there.
export async function smallWebP(width, height, pixels, limit = Infinity) {
  checkDimensions(width, height, pixels);
  if (!canEncodeWebP()) throw Error(WEBP_UNAVAILABLE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Canvas is unavailable.");
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  const at = (quality) =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob?.type === "image/webp"
            ? resolve(blob)
            : reject(Error(WEBP_UNAVAILABLE)),
        "image/webp",
        quality,
      ),
    );
  try {
    let blob = await at(0.9);
    if (blob.size <= limit) return blob;
    let lo = 0,
      hi = 0.9,
      best = null;
    for (let i = 0; i < 6; i++) {
      const quality = (lo + hi) / 2;
      blob = await at(quality);
      if (blob.size <= limit) {
        best = blob;
        lo = quality;
      } else hi = quality;
    }
    if (!best && (blob = await at(0)).size <= limit) best = blob;
    if (!best)
      throw Error(
        "This image can't be made smaller than " +
          formatBytes(limit) +
          " as a WebP. Try a simpler image.",
      );
    return best;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
export async function encode(pixels, width, height, format = "png", limit) {
  if (format === "webp-small") return smallWebP(width, height, pixels, limit);
  return format === "webp"
    ? losslessWebP(width, height, pixels)
    : losslessPNG(width, height, pixels);
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
// CRC-32 as used by PNG and ZIP.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(data.length + 12),
    v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  v.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
function checkDimensions(width, height, pixels) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 4194304 ||
    pixels.length !== width * height * 4
  )
    throw Error("Invalid export dimensions.");
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
// PNG scanline filters, chosen per row by libpng's heuristic: the smallest sum
// of the filtered bytes read as signed values. Flat colour and smooth shading
// become runs of small numbers, which deflate much better than raw pixels.
async function filterRows(pixels, width, height, pause) {
  const stride = width * 4,
    out = new Uint8Array((stride + 1) * height),
    trial = Array.from({ length: 5 }, () => new Uint8Array(stride)),
    none = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    if ((y & 63) === 0) await pause();
    const cur = pixels.subarray(y * stride, (y + 1) * stride),
      up = y ? pixels.subarray((y - 1) * stride, y * stride) : none,
      [raw, sub, above, avg, pae] = trial;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0,
        b = up[i],
        c = i >= 4 ? up[i - 4] : 0,
        x = cur[i];
      raw[i] = x;
      sub[i] = x - a;
      above[i] = x - b;
      avg[i] = x - ((a + b) >> 1);
      pae[i] = x - paeth(a, b, c);
    }
    let best = 0,
      bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const row = trial[f];
      let score = 0;
      for (let i = 0; i < stride && score < bestScore; i++)
        score += row[i] < 128 ? row[i] : 256 - row[i];
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    out[y * (stride + 1)] = best;
    out.set(trial[best], y * (stride + 1) + 1);
  }
  return out;
}
export async function losslessPNG(width, height, pixels) {
  checkDimensions(width, height, pixels);
  if (typeof CompressionStream !== "function")
    throw Error(
      "Lossless export needs a current browser with CompressionStream support.",
    );
  const rows = await filterRows(pixels, width, height, makePause());
  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13),
    v = new DataView(header.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", compressed),
      chunk("IEND", new Uint8Array()),
    ],
    { type: "image/png" },
  );
}
