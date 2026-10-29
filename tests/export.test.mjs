import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import sharp from "sharp";
import { crc32, formatBytes, losslessPNG, outputName } from "../src/export.js";
import { svgLength } from "../src/import.js";
import { finish, fit } from "../src/output.js";
import { PRESETS, formatsFor, outputsFor } from "../src/presets.js";
import { deliver } from "../src/deliver.js";
import { zip } from "../src/zip.js";
let seed = 7;
const random = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const raw = async (blob) =>
  sharp(Buffer.from(await blob.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
// A w × h image: a soft diagonal gradient with a flat disc and a transparent margin.
function artwork(w, h) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4,
        inDisc =
          (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 3) ** 2;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      pixels.set(
        inDisc
          ? [240, 60, 90, 255]
          : [(x * 255) / w, (y * 255) / h, 128, 200 + ((x + y) % 50)],
        o,
      );
    }
  return pixels;
}
// Reads a ZIP back by its central directory, checking each local header.
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  const count = v.getUint16(end + 10, true),
    files = [];
  let at = v.getUint32(end + 16, true);
  assert.equal(at + v.getUint32(end + 12, true), end);
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const flags = v.getUint16(at + 8, true),
      method = v.getUint16(at + 10, true),
      crc = v.getUint32(at + 16, true),
      size = v.getUint32(at + 20, true),
      nameLength = v.getUint16(at + 28, true),
      offset = v.getUint32(at + 42, true),
      name = new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      );
    assert.equal(flags, 0x0800);
    assert.equal(method, 0);
    assert.equal(v.getUint32(offset, true), 0x04034b50);
    assert.equal(v.getUint32(offset + 14, true), crc);
    assert.equal(v.getUint16(offset + 26, true), nameLength);
    const start = offset + 30 + nameLength,
      data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc);
    files.push({ name, data });
    at += 46 + nameLength;
  }
  return files;
}
test("CRC-32 matches the standard check value and Node's zlib", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (const n of [0, 1, 255, 4096]) {
    const bytes = Uint8Array.from({ length: n }, () => random() * 256);
    assert.equal(crc32(bytes), zlib.crc32(bytes));
  }
});
test("filtered PNG decodes to the exact pixels and is smaller than unfiltered", async () => {
  for (const [w, h] of [
    [1, 1],
    [5, 3],
    [96, 64],
  ]) {
    const pixels = artwork(w, h),
      blob = await losslessPNG(w, h, pixels),
      { data, info } = await raw(blob);
    assert.equal(info.width, w);
    assert.equal(info.height, h);
    assert.deepEqual([...data], [...pixels]);
    if (w < 96) continue;
    const rows = new Uint8Array((w * 4 + 1) * h);
    for (let y = 0; y < h; y++)
      rows.set(
        pixels.subarray(y * w * 4, (y + 1) * w * 4),
        y * (w * 4 + 1) + 1,
      );
    assert.ok(
      blob.size < zlib.deflateSync(rows).length,
      "filters make the file smaller",
    );
  }
});
test("ZIP stores every file intact under unique UTF-8 names", async () => {
  const files = [
    { name: "héart-112px.png", blob: new Blob([new Uint8Array([1, 2, 3])]) },
    { name: "héart-112px.png", blob: new Blob([new Uint8Array([4])]) },
    { name: "../evil/name.png", blob: new Blob([new Uint8Array(0)]) },
  ];
  const archive = await zip(files, new Date(2026, 9, 27, 13, 45, 30)),
    entries = unzip(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(archive.type, "application/zip");
  assert.deepEqual(
    entries.map((e) => e.name),
    ["héart-112px.png", "héart-112px (2).png", "_evil_name.png"],
  );
  assert.deepEqual(
    entries.map((e) => [...e.data]),
    [[1, 2, 3], [4], []],
  );
  await assert.rejects(zip([]), /Invalid ZIP/);
});
test("fit scales the longest side to the box and centres it on a square", () => {
  const w = 30,
    h = 15,
    red = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) red.set([255, 0, 0, 255], i * 4);
  const loose = fit(red, w, h, 12, false);
  assert.deepEqual([loose.width, loose.height], [12, 6]);
  const square = fit(red, w, h, 12, true);
  assert.deepEqual([square.width, square.height], [12, 12]);
  const alphaAt = (x, y) => square.pixels[(y * 12 + x) * 4 + 3];
  assert.equal(alphaAt(6, 0), 0);
  assert.equal(alphaAt(6, 2), 0);
  assert.equal(alphaAt(6, 3), 255);
  assert.equal(alphaAt(6, 8), 255);
  assert.equal(alphaAt(6, 9), 0);
  assert.deepEqual(
    [...square.pixels.subarray((6 * 12 + 6) * 4, (6 * 12 + 7) * 4)],
    [255, 0, 0, 255],
  );
});
test("presets give each platform's dimensions, limits and formats", () => {
  const plans = Object.fromEntries(
    PRESETS.map((p) => [p.id, outputsFor(p.id, 300, 150, { format: "webp" })]),
  );
  const dims = (id) => plans[id].map((o) => [o.width, o.height, o.format]);
  assert.deepEqual(dims("original"), [[300, 150, "webp"]]);
  assert.deepEqual(dims("discord-emoji"), [[128, 128, "png"]]);
  assert.deepEqual(dims("discord-sticker"), [[320, 320, "png"]]);
  assert.deepEqual(dims("slack-emoji"), [[128, 128, "png"]]);
  assert.deepEqual(dims("twitch-emotes"), [
    [112, 112, "png"],
    [56, 56, "png"],
    [28, 28, "png"],
  ]);
  assert.deepEqual(dims("telegram-sticker"), [[512, 256, "webp"]]);
  assert.deepEqual(dims("telegram-emoji"), [[100, 100, "webp"]]);
  assert.deepEqual(dims("whatsapp-sticker"), [
    [512, 512, "webp-small"],
    [96, 96, "png"],
  ]);
  assert.deepEqual(dims("youtube-emoji"), [[48, 48, "png"]]);
  assert.equal(plans["slack-emoji"][0].limit, 128 * 1024);
  assert.equal(plans["whatsapp-sticker"][0].limit, 100 * 1024);
  assert.equal(plans["discord-sticker"][0].enlarged, true);
  assert.deepEqual(
    formatsFor(PRESETS.find((p) => p.id === "twitch-emotes")),
    [],
  );
  for (const [custom, box] of [
    [64, 64],
    [1, 16],
    [99999, 2048],
    [NaN, 512],
  ])
    assert.equal(outputsFor("custom", 300, 150, { custom })[0].width, box);
  assert.deepEqual(
    outputsFor("unknown", 3, 2).map((o) => o.width),
    [3],
  );
});
test("deliver runs outline, fit and encoding for every output of a pack", async () => {
  const pixels = artwork(60, 40),
    files = await deliver(pixels, 60, 40, {
      size: "twitch-emotes",
      outline: { widthPct: 5, colour: "#FFFFFF" },
    });
  assert.deepEqual(
    files.map((f) => f.suffix),
    ["112px", "56px", "28px"],
  );
  for (const f of files) {
    const { info } = await raw(f.blob);
    assert.deepEqual([info.width, info.height], [f.box, f.box]);
    assert.equal(f.blob.type, "image/png");
  }
  const copy = await deliver(
    pixels,
    60,
    40,
    { size: "twitch-emotes" },
    undefined,
    {
      first: true,
      format: "png",
    },
  );
  assert.equal(copy.length, 1);
});
test("output names carry the preset, and sizes read in KB and MB", () => {
  assert.equal(
    outputName("heart.svg", "png", "#5865F2", "discord-emoji"),
    "heart-5865f2-discord-emoji.png",
  );
  assert.equal(
    outputName("heart", "webp-small", "#5865F2", "sticker"),
    "heart-5865f2-sticker.webp",
  );
  assert.equal(
    outputName("heart", "zip", "#5865F2", "twitch-emotes"),
    "heart-5865f2-twitch-emotes.zip",
  );
  assert.equal(
    outputName("heart", "png", "#5865F2", "../x"),
    "heart-5865f2.png",
  );
  assert.equal(formatBytes(900), "900 bytes");
  assert.equal(formatBytes(4301), "4.3 KB");
  assert.equal(formatBytes(262144), "256 KB");
  assert.equal(formatBytes(262145), "257 KB");
  assert.equal(formatBytes(1048576), "1 MB");
});
// 2×2 pixel art: four flat colours, no anti-aliasing.
function pixelArt() {
  const pixels = new Uint8ClampedArray(2 * 2 * 4),
    colours = [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 180, 0, 255],
      [255, 220, 0, 255],
    ];
  colours.forEach((colour, i) => pixels.set(colour, i * 4));
  return pixels;
}
// 6×5 with a transparent margin and a 2×2 block at (2, 1). The last pixel of
// the block is only partly opaque, so trim must keep it.
function transparentMargin() {
  const w = 6,
    h = 5,
    pixels = new Uint8ClampedArray(w * h * 4),
    put = (x, y, colour) => pixels.set(colour, (y * w + x) * 4);
  put(2, 1, [200, 10, 10, 255]);
  put(3, 1, [10, 200, 10, 255]);
  put(2, 2, [10, 10, 200, 255]);
  put(3, 2, [200, 200, 10, 200]);
  return { w, h, pixels };
}
test("nearest neighbour keeps pixel-art blocks and smooth does not", async () => {
  const pixels = pixelArt(),
    nearest = await deliver(pixels, 2, 2, {
      size: "custom",
      custom: 16,
      format: "png",
      scale: "nearest",
    }),
    { data, info } = await raw(nearest[0].blob);
  assert.deepEqual([info.width, info.height], [16, 16]);
  const at = (x, y) =>
    [...data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  for (const [sx, sy, colour] of [
    [0, 0, [255, 0, 0, 255]],
    [1, 0, [0, 0, 255, 255]],
    [0, 1, [0, 180, 0, 255]],
    [1, 1, [255, 220, 0, 255]],
  ])
    for (let dy = 0; dy < 8; dy++)
      for (let dx = 0; dx < 8; dx++)
        assert.deepEqual(at(sx * 8 + dx, sy * 8 + dy), colour);
  const smooth = await deliver(pixels, 2, 2, {
    size: "custom",
    custom: 16,
    format: "png",
    scale: "smooth",
  });
  assert.notDeepEqual([...(await raw(smooth[0].blob)).data], [...data]);
});
test("trim removes a transparent margin and leaves the bytes alone when off", async () => {
  const { w, h, pixels } = transparentMargin(),
    off = await deliver(pixels, w, h, { size: "original", format: "png" }),
    explicit = await deliver(pixels, w, h, {
      size: "original",
      format: "png",
      trim: false,
      padding: 0,
      scale: "smooth",
    });
  assert.deepEqual(
    new Uint8Array(await off[0].blob.arrayBuffer()),
    new Uint8Array(await explicit[0].blob.arrayBuffer()),
  );
  assert.deepEqual(
    [(await raw(off[0].blob)).info.width, (await raw(off[0].blob)).info.height],
    [w, h],
  );
  const trimmed = await raw(
    (
      await deliver(pixels, w, h, {
        size: "original",
        format: "png",
        trim: true,
      })
    )[0].blob,
  );
  assert.deepEqual([trimmed.info.width, trimmed.info.height], [2, 2]);
  assert.deepEqual([...trimmed.data.subarray(0, 4)], [200, 10, 10, 255]);
  assert.deepEqual([...trimmed.data.subarray(12, 16)], [200, 200, 10, 200]);
  const blank = new Uint8ClampedArray(4 * 4);
  const kept = await finish(blank, 4, 4, { trim: true });
  assert.deepEqual([kept.width, kept.height], [4, 4]);
});
test("padding adds a transparent border around the finished picture", async () => {
  const pixels = pixelArt(),
    padded = await raw(
      (
        await deliver(pixels, 2, 2, {
          size: "original",
          format: "png",
          padding: 2,
        })
      )[0].blob,
    );
  assert.deepEqual([padded.info.width, padded.info.height], [6, 6]);
  assert.equal(padded.data[3], 0);
  assert.deepEqual(
    [...padded.data.subarray((2 * 6 + 2) * 4, (2 * 6 + 2) * 4 + 4)],
    [255, 0, 0, 255],
  );
  await assert.rejects(
    () => finish(pixels, 2, 2, { padding: 4096 }),
    /padding/i,
  );
});
test("trim frames the outline, not only the artwork", async () => {
  const w = 32,
    h = 32,
    pixels = new Uint8ClampedArray(w * h * 4);
  pixels.set([255, 0, 0, 255], (16 * w + 16) * 4);
  const settings = { outline: { widthPct: 8, colour: "#0000FF" } },
    loose = await finish(pixels, w, h, settings),
    tight = await finish(pixels, w, h, { ...settings, trim: true });
  assert.ok(tight.width < loose.width && tight.height < loose.height);
  const alpha = (image, x, y) => image.pixels[(y * image.width + x) * 4 + 3];
  let top = false,
    bottom = false,
    left = false,
    right = false;
  for (let x = 0; x < tight.width; x++) {
    if (alpha(tight, x, 0) > 0) top = true;
    if (alpha(tight, x, tight.height - 1) > 0) bottom = true;
  }
  for (let y = 0; y < tight.height; y++) {
    if (alpha(tight, 0, y) > 0) left = true;
    if (alpha(tight, tight.width - 1, y) > 0) right = true;
  }
  assert.equal(top && bottom && left && right, true);
  let red = false,
    blue = false;
  for (let i = 0; i < tight.pixels.length; i += 4) {
    if (tight.pixels[i] > 200 && tight.pixels[i + 2] < 40) red = true;
    if (tight.pixels[i + 2] > 200 && tight.pixels[i] < 40) blue = true;
  }
  assert.equal(red && blue, true);
});
test("a scaled export with framing off matches the same export with the fields set off", async () => {
  const pixels = artwork(24, 16),
    settings = {
      size: "discord-emoji",
      format: "png",
      outline: { widthPct: 4, colour: "#FFFFFF" },
    },
    plain = await deliver(pixels, 24, 16, settings),
    off = await deliver(pixels, 24, 16, {
      ...settings,
      trim: false,
      padding: 0,
      scale: "smooth",
    });
  assert.equal(plain.length, off.length);
  for (let i = 0; i < plain.length; i++) {
    assert.deepEqual(
      new Uint8Array(await plain[i].blob.arrayBuffer()),
      new Uint8Array(await off[i].blob.arrayBuffer()),
    );
  }
});
test("SVG lengths accept absolute units and fractions only", () => {
  assert.equal(svgLength("32.5"), 32.5);
  assert.equal(svgLength(" 24px "), 24);
  assert.equal(svgLength("12pt"), 16);
  assert.equal(svgLength("1in"), 96);
  assert.equal(svgLength("2.54cm"), 96);
  assert.equal(svgLength("1e2"), 100);
  for (const bad of [
    "",
    null,
    "100%",
    "2em",
    "-5",
    "1e400",
    "calc(1px)",
    "5 px x",
  ])
    assert.ok(Number.isNaN(svgLength(bad)), String(bad));
});
