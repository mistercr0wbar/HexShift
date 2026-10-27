import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import sharp from "sharp";
import { crc32, formatBytes, losslessPNG, outputName } from "../src/export.js";
import { svgLength } from "../src/import.js";
import { fit } from "../src/output.js";
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
