import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  rgbToHsl,
  hslToRgb,
  parseHex,
  hueDistance,
  rgbToOklch,
  oklchToRgb,
  deltasFor,
  anchorRemap,
  toHex,
} from "../src/colour.js";
import {
  MAX_POLYGON,
  prepare,
  processEdit,
  processImage,
  rasterPolygon,
  validateImage,
  validatePolygon,
  unmix,
} from "../src/engine.js";
import { History } from "../src/history.js";
import { inspectRaster, dimensions } from "../src/import.js";
import { outputName, losslessWebP, losslessPNG } from "../src/export.js";
import sharp from "sharp";
import sample from "../src/sample.js";
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
test("anchorRemap is monotonic, fixes 0 and 1, and lands the anchor exactly", () => {
  const values = [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1];
  for (const a of values)
    for (const t of values) {
      if (a > 0 && a < 1) assert.ok(Math.abs(anchorRemap(a, a, t) - t) < 1e-9);
      if (a > 0) assert.ok(Math.abs(anchorRemap(0, a, t)) < 1e-9 || t === 1);
      if (a < 1) assert.ok(Math.abs(anchorRemap(1, a, t) - 1) < 1e-9 || t === 0);
      let last = -Infinity;
      for (let v = 0; v <= 1.0000001; v += 1 / 64) {
        const out = anchorRemap(v, a, t);
        assert.ok(Number.isFinite(out) && out >= 0 && out <= 1, `${v} ${a} ${t}`);
        assert.ok(out >= last - 1e-9, `monotonic at ${v} ${a} ${t}`);
        last = out;
      }
    }
});
test("protected shift lands the sample exactly on the target and keeps shade order", async () => {
  const data = new Uint8ClampedArray([
    100, 0, 0, 255, 240, 0, 0, 255, 255, 120, 120, 255,
  ]);
  for (const model of ["oklch", "hsl"]) {
    const im = await prepare(3, 1, data),
      target = "#3366CC",
      p = {
        ...defaults(),
        model,
        shadeTol: 100,
        soft: 0,
        target,
        ...deltasFor([240, 0, 0], parseHex(target), model),
      },
      out = await processImage(im, p, [{ x: 1, y: 0 }], new Int8Array(3));
    assert.equal(out.capped, false);
    const got = parseHex(toHex(...out.pixels.slice(4, 7)));
    parseHex(target).forEach((v, k) => assert.ok(Math.abs(got[k] - v) <= 1));
    const L = (i) => rgbToOklch(...out.pixels.slice(i * 4, i * 4 + 3))[0];
    assert.ok(L(0) < L(1) && L(1) < L(2), model);
  }
});
test("manual lightness past white is flagged and still keeps order", async () => {
  const data = new Uint8ClampedArray([100, 0, 0, 255, 240, 0, 0, 255]),
    im = await prepare(2, 1, data);
  const out = await processImage(
    im,
    { ...defaults(), model: "hsl", dl: 100, shadeTol: 100, soft: 0 },
    [{ x: 0, y: 0 }],
    new Int8Array(2),
  );
  assert.equal(out.capped, true);
  assert.ok(out.pixels[0] <= out.pixels[4]);
});
test("near-white parts shift to one tint despite noisy hues", async () => {
  const data = new Uint8ClampedArray([
      250, 250, 252, 255, 251, 250, 250, 255, 244, 244, 244, 255,
    ]),
    im = await prepare(3, 1, data);
  for (const model of ["oklch", "hsl"]) {
    const p = {
        ...defaults(),
        model,
        soft: 0,
        target: "#FF4040",
        ...deltasFor([250, 250, 252], [255, 64, 64], model),
      },
      out = await processImage(im, p, [{ x: 0, y: 0 }], new Int8Array(3)),
      hues = [0, 1, 2].map((i) => rgbToHsl(...out.pixels.slice(i * 4, i * 4 + 3))[0]);
    for (const hue of hues) assert.ok(hueDistance(hue, hues[0]) < 4, model + hues);
  }
});
test("the built-in heart becomes one even colour, with no rim of red along its outline", async () => {
  const { data, info } = await sharp(
      Buffer.from(sample.split(",")[1], "base64"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    im = await prepare(info.width, info.height, new Uint8ClampedArray(data)),
    seed = { x: im.palette[0].x, y: im.palette[0].y },
    o = (seed.y * info.width + seed.x) * 4;
  // The app's own flow: click the main colour, then type a target.
  for (const target of ["#5865F2", "#248046", "#00D9FF"]) {
    const p = {
        ...defaults(),
        target,
        ...deltasFor([...data.subarray(o, o + 3)], parseHex(target), "oklch"),
      },
      out = await processImage(
        im,
        p,
        [seed],
        new Int8Array(info.width * info.height),
      ),
      hue = rgbToOklch(...parseHex(target))[2];
    let off = 0;
    for (let i = 0; i < out.pixels.length; i += 4) {
      if (out.pixels[i + 3] < 64) continue;
      const [, C, h] = rgbToOklch(...out.pixels.slice(i, i + 3));
      if (C > 0.04 && hueDistance(h, hue) > 8) off++;
    }
    assert.equal(off, 0, target);
  }
});
test("outline blends shift with the fill; other colours and soft fades are kept", async () => {
  // Blue | red fill | dark red blend (out of shade tolerance) | black outline,
  // then an orange that only soft hue tolerance partly selects.
  const data = new Uint8ClampedArray([
      0, 0, 255, 255, 255, 0, 0, 255, 40, 20, 20, 255, 0, 0, 0, 255, 255, 153,
      0, 255,
    ]),
    im = await prepare(5, 1, data),
    target = "#248046",
    p = {
      ...defaults(),
      target,
      ...deltasFor([255, 0, 0], parseHex(target), "oklch"),
    },
    out = await processImage(im, p, [{ x: 1, y: 0 }], new Int8Array(5)),
    hue = rgbToOklch(...parseHex(target))[2],
    px = (i) => [...out.pixels.slice(i * 4, i * 4 + 3)];
  assert.deepEqual(px(0), [0, 0, 255]);
  assert.equal(toHex(...px(1)), target);
  assert.ok(hueDistance(rgbToOklch(...px(2))[2], hue) < 8, String(px(2)));
  assert.deepEqual(px(3), [0, 0, 0]);
  // A pixel partly selected for its hue (the orange), or for its shade away
  // from any outline (a muted red fading from the fill inside the artwork),
  // keeps its partial weight: partway between itself and fully shifted.
  const fade = new Uint8ClampedArray([255, 0, 0, 255, 191, 64, 64, 255]),
    cases = [
      [im, data, out, 4, 1, 5],
      [
        await prepare(2, 1, fade),
        fade,
        await processImage(
          await prepare(2, 1, fade),
          p,
          [{ x: 0, y: 0 }],
          new Int8Array(2),
        ),
        1,
        0,
        2,
      ],
    ];
  for (const [image, source, result, i, seed, n] of cases) {
    const weight = result.mask[i],
      full = await processImage(
        image,
        { ...p, hueTol: 180, shadeTol: 100, soft: 0 },
        [{ x: seed, y: 0 }],
        new Int8Array(n),
      );
    assert.ok(weight > 0 && weight < 1, String(weight));
    for (let k = 0; k < 3; k++) {
      const o = i * 4 + k;
      assert.ok(
        Math.abs(
          result.pixels[o] -
            (source[o] + (full.pixels[o] - source[o]) * weight),
        ) <= 1,
        String([...result.pixels.slice(i * 4, i * 4 + 3)]),
      );
    }
  }
});
test("OKLCH matches reference values, round-trips and maps out-of-gamut colours", () => {
  const [L, C, h] = rgbToOklch(255, 0, 0);
  assert.ok(Math.abs(L - 0.62796) < 1e-3 && Math.abs(C - 0.25768) < 1e-3);
  assert.ok(Math.abs(h - 29.2339) < 0.05);
  for (const rgb of [
    [255, 0, 0],
    [18, 129, 47],
    [255, 200, 61],
    [120, 120, 120],
    [0, 0, 0],
    [255, 255, 255],
  ])
    assert.deepEqual(oklchToRgb(...rgbToOklch(...rgb)), rgb);
  const wide = oklchToRgb(0.7, 0.4, 250);
  assert.ok(wide.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.ok(Math.abs(rgbToOklch(...wide)[0] - 0.7) < 0.01);
});
test("perceptual hue rotation keeps brightness where HSL darkens", async () => {
  const data = new Uint8ClampedArray([255, 200, 61, 255]),
    im = await prepare(1, 1, data),
    before = rgbToOklch(255, 200, 61)[0],
    lightness = {};
  for (const model of ["oklch", "hsl"]) {
    const out = await processImage(
      im,
      { ...defaults(), model, protect: false, dh: -163, soft: 0 },
      [{ x: 0, y: 0 }],
      new Int8Array(1),
    );
    lightness[model] = rgbToOklch(...out.pixels.slice(0, 3))[0];
  }
  assert.ok(Math.abs(lightness.oklch - before) < 0.02);
  assert.ok(before - lightness.hsl > 0.1);
});
test("clean edges unmix the removed colour", () => {
  assert.deepEqual(unmix([255, 255, 255], [255, 255, 255]), [0, 0, 0, 0]);
  const [r, g, b, a] = unmix([255, 128, 128], [255, 255, 255]);
  assert.deepEqual([r, g, b], [255, 0, 0]);
  assert.ok(Math.abs(a - 0.5) < 0.01);
  for (const key of [
    [0, 255, 0],
    [0, 0, 0],
    [255, 255, 255],
  ]) {
    const out = unmix([100, 200, 50], key);
    assert.ok(out.every(Number.isFinite), String(key));
  }
  assert.deepEqual(unmix([10, 20, 30], [0, 0, 0]).slice(0, 3), [85, 170, 255]);
});
test("clean edges remove a white background without a pale halo", async () => {
  const data = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 128, 128, 255, 255, 0, 0, 255,
    ]),
    im = await prepare(3, 1, data),
    p = { ...defaults(), mode: "transparent", soft: 0 };
  const clean = await processImage(im, p, [{ x: 0, y: 0 }], new Int8Array(3));
  assert.equal(clean.pixels[3], 0);
  assert.ok(Math.abs(clean.pixels[7] - 128) <= 1);
  assert.deepEqual([...clean.pixels.slice(4, 7)], [255, 0, 0]);
  assert.deepEqual([...clean.pixels.slice(8)], [255, 0, 0, 255]);
  const plain = await processImage(
    im,
    { ...p, cleanEdges: false },
    [{ x: 0, y: 0 }],
    new Int8Array(3),
  );
  assert.equal(plain.pixels[3], 0);
  const feathered = await processImage(
    im,
    { ...p, feather: 1 },
    [{ x: 0, y: 0 }],
    new Int8Array(3),
  );
  // Partly removed white stays white (premultiplied blend), not grey.
  assert.deepEqual([...feathered.pixels.slice(0, 3)], [255, 255, 255]);
  assert.ok(feathered.pixels[3] > 0 && feathered.pixels[3] < 255);
  const brushOnly = await processImage(
    im,
    p,
    [],
    new Int8Array([0, 1, 0]),
  );
  assert.equal(brushOnly.pixels[7], 0);
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
function referenceInside(x, y, points) {
  const px = x + 0.5,
    py = y + 0.5,
    n = points.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = points[j].x + 0.5,
      ay = points[j].y + 0.5,
      bx = points[i].x + 0.5,
      by = points[i].y + 0.5,
      dx = bx - ax,
      dy = by - ay,
      len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      if (px === ax && py === ay) return true;
    } else {
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
      if (t >= -1e-9 && t <= 1 + 1e-9) {
        const qx = ax + t * dx,
          qy = ay + t * dy;
        if ((px - qx) ** 2 + (py - qy) ** 2 < 1e-10) return true;
      }
    }
    if ((ay > py) !== (by > py) && px < ax + ((py - ay) * dx) / dy)
      inside = !inside;
  }
  return inside;
}
test("a polygon covers its boundary and matches even-odd pixel centers", () => {
  const rect = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 1, y: 3 },
  ];
  const mask = rasterPolygon(6, 5, rect);
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 6; x++) {
      const on = x >= 1 && x <= 4 && y >= 1 && y <= 3;
      assert.equal(mask[y * 6 + x], on ? 1 : 0, x + "," + y);
    }
  const triangle = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
  ];
  const tri = rasterPolygon(6, 6, triangle);
  assert.equal(tri[0], 1);
  assert.equal(tri[2 * 6 + 2], 1);
  assert.equal(tri[1 * 6 + 1], 1);
  assert.equal(tri[2 * 6 + 3], 0);
  assert.equal(tri[4 * 6 + 4], 0);
  const shapes = [
    rect,
    triangle,
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
    [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
      { x: 3, y: 0 },
    ],
  ];
  for (const points of shapes) {
    const got = rasterPolygon(6, 6, points);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++)
        assert.equal(
          got[y * 6 + x],
          referenceInside(x, y, points) ? 1 : 0,
          x + "," + y,
        );
  }
  assert.throws(() => validatePolygon(rect.slice(0, 2), 6, 5), /polygon/);
  assert.throws(
    () =>
      validatePolygon(
        Array.from({ length: MAX_POLYGON + 1 }, (_, i) => ({
          x: i % 6,
          y: 0,
        })),
        6,
        5,
      ),
    /polygon/,
  );
});
test("a polygon limits one row, leaves other colours alone, and brushes still correct it", async () => {
  const w = 4,
    h = 2,
    red = [220, 30, 30],
    blue = [30, 60, 220],
    green = [0, 255, 0],
    yellow = [255, 255, 0],
    // R R B R
    // R R B B
    layout = [red, red, blue, red, red, red, blue, blue],
    data = new Uint8ClampedArray(w * h * 4);
  layout.forEach((rgb, i) => data.set([...rgb, 255], i * 4));
  const image = await prepare(w, h, data),
    polygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    redRow = {
      id: 1,
      seeds: [{ x: 0, y: 0 }],
      polygon,
      params: { ...defaults(), mode: "flat", soft: 0, target: "#00FF00" },
    },
    blueRow = {
      id: 2,
      seeds: [{ x: 2, y: 0 }],
      params: { ...defaults(), mode: "flat", soft: 0, target: "#FFFF00" },
    },
    labels = new Int8Array(w * h),
    rgb = (pixels, x, y) => [
      ...pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3),
    ];
  const out = await processEdit(image, [redRow, blueRow], labels, 0);
  assert.deepEqual([...labels], [0, 0, 0, 0, 0, 0, 0, 0]);
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    assert.deepEqual(rgb(out.pixels, x, y), green, "inside " + x + "," + y);
  assert.deepEqual(rgb(out.pixels, 3, 0), red);
  assert.deepEqual(rgb(out.pixels, 2, 0), yellow);
  assert.deepEqual(rgb(out.pixels, 2, 1), yellow);
  assert.deepEqual(rgb(out.pixels, 3, 1), yellow);
  const open = await processEdit(
    image,
    [{ ...redRow, polygon: undefined }, blueRow],
    new Int8Array(w * h),
    0,
  );
  assert.deepEqual(rgb(open.pixels, 3, 0), green);
  const covered = await processEdit(
    image,
    [
      {
        ...redRow,
        polygon: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 1 },
          { x: 0, y: 1 },
        ],
      },
      blueRow,
    ],
    new Int8Array(w * h),
    0,
  );
  assert.deepEqual(covered.pixels, open.pixels);
  const added = new Int8Array(w * h);
  added[3] = 1;
  const forced = await processEdit(image, [redRow, blueRow], added, 0);
  assert.deepEqual(rgb(forced.pixels, 3, 0), green);
  assert.deepEqual([...added], [0, 0, 0, 1, 0, 0, 0, 0]);
  const subtracted = new Int8Array(w * h);
  subtracted[0] = -1;
  const kept = await processEdit(image, [redRow, blueRow], subtracted, 0);
  assert.deepEqual(rgb(kept.pixels, 0, 0), red);
  assert.deepEqual(rgb(kept.pixels, 1, 0), green);
  assert.deepEqual(rgb(kept.pixels, 2, 0), yellow);
  const grid = new Uint8ClampedArray(9 * 4);
  for (let i = 0; i < 9; i++) grid.set([220, 30, 30, 255], i * 4);
  const gim = await prepare(3, 3, grid),
    clipped = await processEdit(
      gim,
      [
        {
          id: 1,
          seeds: [{ x: 0, y: 0 }],
          polygon: [
            { x: 0, y: 0 },
            { x: 0, y: 2 },
            { x: 0, y: 1 },
          ],
          params: {
            ...defaults(),
            mode: "flat",
            soft: 0,
            connected: true,
            target: "#00FF00",
          },
        },
      ],
      new Int8Array(9),
      0,
    ),
    cell = (x, y) => [...clipped.pixels.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 3)];
  assert.deepEqual(cell(0, 0), green);
  assert.deepEqual(cell(0, 2), green);
  assert.deepEqual(cell(1, 0), red);
  await assert.rejects(
    processEdit(
      image,
      [{ ...redRow, polygon: [{ x: 0, y: 0 }] }],
      new Int8Array(w * h),
      0,
    ),
    /polygon/,
  );
});
