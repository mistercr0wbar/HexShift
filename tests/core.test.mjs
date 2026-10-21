import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  rgbToHsl,
  hslToRgb,
  parseHex,
  hueDistance,
} from "../src/colour.js";
import { prepare, processImage, validateImage } from "../src/engine.js";
import { History } from "../src/history.js";
import { inspectRaster, dimensions } from "../src/import.js";
import { outputName, losslessWebP, losslessPNG } from "../src/export.js";
import sharp from "sharp";
const fixture = () =>
  new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 128, 255, 0, 0, 255, 120, 120, 120, 255,
  ]);
test("colour conversion, short hex, and hue wraparound", () => {
  assert.deepEqual(parseHex("#aF0"), [170, 255, 0]);
  assert.equal(parseHex("url(x)"), null);
  assert.equal(hueDistance(359, 1), 2);
  for (const rgb of [
    [255, 0, 0],
    [0, 255, 255],
    [18, 129, 47],
    [120, 120, 120],
  ])
    assert.deepEqual(hslToRgb(...rgbToHsl(...rgb)), rgb);
});
test("flat replacement is exact, keeps unselected pixels and alpha", async () => {
  const data = fixture(),
    im = await prepare(4, 1, data),
    p = { ...defaults(), mode: "flat", target: "#12AB34", soft: 0 };
  const out = await processImage(im, p, [{ x: 0, y: 0 }], new Int8Array(4));
  assert.deepEqual([...out.pixels.slice(0, 4)], [18, 171, 52, 255]);
  assert.deepEqual(out.pixels.slice(4, 8), data.slice(4, 8));
  assert.equal(out.pixels[15], 255);
  assert.deepEqual(out.pixels.slice(12), data.slice(12));
});
test("connected restriction, brush override, and transparency", async () => {
  const im = await prepare(4, 1, fixture()),
    p = { ...defaults(), mode: "transparent", connected: true, soft: 0 };
  const overrides = new Int8Array([0, 1, 0, -1]);
  const out = await processImage(im, p, [{ x: 0, y: 0 }], overrides);
  assert.deepEqual([...out.pixels.slice(0, 8)], Array(8).fill(0));
  assert.equal(out.pixels[11], 255);
  assert.equal(out.pixels[15], 255);
});
test("grey selection cannot leak into colour selection", async () => {
  const im = await prepare(4, 1, fixture()),
    out = await processImage(
      im,
      { ...defaults(), mode: "flat", shadeTol: 100, hueTol: 180 },
      [{ x: 3, y: 0 }],
      new Int8Array(4),
    );
  assert.equal(out.count, 1);
});
test("shading protection caps clipping and preserves lightness ordering", async () => {
  const data = new Uint8ClampedArray([100, 0, 0, 255, 240, 0, 0, 255]),
    im = await prepare(2, 1, data);
  const out = await processImage(
    im,
    { ...defaults(), dl: 100, ds: -100, shadeTol: 100, soft: 0 },
    [{ x: 0, y: 0 }],
    new Int8Array(2),
  );
  assert.equal(out.capped, true);
  assert.ok(out.pixels[0] < out.pixels[4]);
});
test("feather blends boundary and preserves alpha", async () => {
  const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 255, 128, 0, 0, 255, 255,
    ]),
    im = await prepare(3, 1, data),
    out = await processImage(
      im,
      { ...defaults(), mode: "flat", soft: 0, feather: 1, target: "#00FF00" },
      [{ x: 0, y: 0 }],
      new Int8Array(3),
    );
  assert.ok(out.mask[1] > 0 && out.mask[1] < 1);
  assert.equal(out.pixels[7], 128);
});
test("all long processing can be cancelled and parameters are bounded", async () => {
  await assert.rejects(
    prepare(
      4,
      1,
      fixture(),
      async () => {},
      () => true,
    ),
    /Cancelled/,
  );
  assert.throws(
    () => validateImage(8193, 1, new Uint8ClampedArray(8193 * 4)),
    /Invalid/,
  );
  const im = await prepare(4, 1, fixture());
  await assert.rejects(
    processImage(im, { ...defaults(), feather: 9 }, [], new Int8Array(4)),
    /parameter/,
  );
  await assert.rejects(
    processImage(im, defaults(), [], new Int8Array([0, 0, 2, 0])),
    /override/,
  );
});
test("history restores metadata, mask, pixels, redo and budget", () => {
  const history = new History(2, 10000),
    state = { pixels: fixture(), overrides: new Int8Array(4), meta: { v: 1 } },
    next = {
      pixels: state.pixels.slice(),
      overrides: new Int8Array([1, 0, 0, 0]),
      meta: { v: 2 },
    };
  next.pixels[0] = 33;
  history.record(state, next, "edit");
  const undo = history.move(next);
  assert.deepEqual(undo.meta, { v: 1 });
  assert.equal(next.pixels[0], 255);
  assert.equal(next.overrides[0], 0);
  assert.equal(history.move(next, true).meta.v, 2);
  assert.equal(next.pixels[0], 33);
  for (let i = 0; i < 5; i++)
    history.record(
      { ...state, meta: { v: i } },
      { ...state, meta: { v: i + 1 } },
      "change",
    );
  assert.equal(history.undoEntries.length, 2);
  assert.ok(history.bytes <= 10000);
});
test("input preflight uses signatures and rejects huge/truncated headers", () => {
  assert.throws(() => inspectRaster(new Uint8Array([1, 2, 3])), /Choose/);
  const png = new Uint8Array(33),
    dv = new DataView(png.buffer);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  dv.setUint32(8, 13);
  png.set([73, 72, 68, 82], 12);
  dv.setUint32(16, 128);
  dv.setUint32(20, 128);
  assert.equal(inspectRaster(png).width, 128);
  dv.setUint32(16, 999999);
  assert.throws(() => inspectRaster(png), /large/);
  assert.throws(() => dimensions(Infinity, 1), /large/);
});
test("filenames cannot introduce paths, executable suffixes or reserved device names", () => {
  assert.equal(outputName("CON.png"), "image-CON-shifted.png");
  assert.equal(
    outputName("../evil.exe", "webp", "#00FFAA"),
    ".._evil-00ffaa.webp",
  );
  assert.ok(!outputName("hello\u202Eexe.png").includes("\u202E"));
});
test("lossless WebP header has bounded dimensions and exact container length", async () => {
  const bytes = new Uint8Array(
    await (await losslessWebP(4, 1, fixture())).arrayBuffer(),
  );
  assert.equal(inspectRaster(bytes).width, 4);
  assert.equal(inspectRaster(bytes).height, 1);
});
test("reference WebP decoder preserves every RGBA byte, including hidden RGB", async () => {
  for (const [width, height] of [
    [4, 1],
    [17, 13],
    [128, 128],
  ]) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = (i * 73 + Math.floor(i / 7)) % 256;
    const blob = await losslessWebP(width, height, pixels),
      decoded = await sharp(Buffer.from(await blob.arrayBuffer()))
        .ensureAlpha()
        .raw()
        .toBuffer();
    assert.deepEqual([...decoded], [...pixels]);
  }
});
test("reference PNG decoder preserves every RGBA byte without canvas alpha rounding", async () => {
  const pixels = new Uint8ClampedArray([
    123, 77, 33, 88, 20, 10, 60, 0, 255, 25, 80, 254,
  ]);
  const blob = await losslessPNG(3, 1, pixels),
    decoded = await sharp(Buffer.from(await blob.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer();
  assert.deepEqual([...decoded], [...pixels]);
});
