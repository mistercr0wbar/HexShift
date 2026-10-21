export function outputName(name, format = "png", target = "shifted") {
  let stem =
    String(name)
      .replace(/\.[^.]*$/, "")
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 80) || "image";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem))
    stem = "image-" + stem;
  const tag = /^#[\da-f]{6}$/i.test(target)
    ? target.slice(1).toLowerCase()
    : "shifted";
  return stem + "-" + tag + "." + (format === "webp" ? "webp" : "png");
}
// Browser Canvas WebP encoders are lossy, even at quality=1. Use a small VP8L
// literal encoder for genuinely lossless, alpha-preserving WebP without a codec dependency.
export async function losslessWebP(width, height, pixels) {
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
    if ((i & 262143) === 0) await new Promise((r) => setTimeout(r, 0));
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
export async function encode(pixels, width, height, format = "png") {
  return format === "webp"
    ? losslessWebP(width, height, pixels)
    : losslessPNG(width, height, pixels);
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const out = new Uint8Array(data.length + 12),
    v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++)
    crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  v.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
export async function losslessPNG(width, height, pixels) {
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
  if (typeof CompressionStream !== "function")
    throw Error(
      "Lossless export needs a current browser with CompressionStream support.",
    );
  const rows = new Uint8Array(pixels.length + height);
  for (let y = 0; y < height; y++) {
    if ((y & 127) === 0) await new Promise((r) => setTimeout(r, 0));
    rows.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  }
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
