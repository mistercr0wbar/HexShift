import test from "node:test";
import assert from "node:assert/strict";
import {
  compositeOutline,
  distanceField,
  outline,
  outlineLayer,
  outlineMask,
  resize,
  finish,
  outlineRadius,
  shrinkSilhouette,
  strokeKey,
} from "../src/output.js";
let seed = 11;
const random = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
test("distance field matches brute force on random shapes", async () => {
  for (const [w, h] of [
    [1, 1],
    [9, 4],
    [31, 23],
    [2, 50],
  ]) {
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inside[i] = random() < 0.06 ? 1 : 0;
    inside[Math.floor(random() * w * h)] = 1;
    const field = await distanceField(inside, w, h);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++)
        if (inside[j])
          best = Math.min(
            best,
            ((i % w) - (j % w)) ** 2 +
              (Math.floor(i / w) - Math.floor(j / w)) ** 2,
          );
      assert.equal(field[i], best);
    }
  }
});
// A 10x10 transparent canvas with an opaque red 4x4 square in the middle.
function square(size = 10, from = 3, to = 7) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = from; y < to; y++)
    for (let x = from; x < to; x++)
      pixels.set([255, 0, 0, 255], (y * size + x) * 4);
  return pixels;
}
test("outline keeps opaque artwork and paints a stroke around it", async () => {
  const pixels = square(),
    out = await outline(pixels, 10, 10, { widthPct: 20, rgb: [255, 255, 255] });
  assert.equal(outlineRadius(10, 10, 20), 2);
  // A radius of 2 needs 3 px of margin; the square has 3, so no growth.
  assert.equal(out.width, 10);
  assert.equal(out.height, 10);
  for (let i = 0; i < 100; i++)
    if (pixels[i * 4 + 3] === 255)
      assert.deepEqual(
        [...out.pixels.slice(i * 4, i * 4 + 4)],
        [255, 0, 0, 255],
      );
  const at = (x, y) => [
    ...out.pixels.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4),
  ];
  assert.deepEqual(at(2, 5), [255, 255, 255, 255]);
  // Two pixels out is the stroke's anti-aliased rim: half coverage.
  assert.deepEqual(at(1, 5), [255, 255, 255, 128]);
  assert.equal(out.pixels[3], 0);
});
test("outline grows the canvas only where the artwork is too close to the edge", async () => {
  const pixels = square(10, 0, 4),
    out = await outline(pixels, 10, 10, { widthPct: 20, rgb: [0, 0, 0] });
  assert.equal(out.width, 13);
  assert.equal(out.height, 13);
  assert.deepEqual(
    [...out.pixels.slice((3 * 13 + 3) * 4, (3 * 13 + 4) * 4)],
    [255, 0, 0, 255],
  );
});
test("outline refuses to exceed the export pixel limit", async () => {
  const size = 2048,
    pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  await assert.rejects(
    outline(pixels, size, size, { widthPct: 5, rgb: [0, 0, 0] }),
    /4,194,304/,
  );
});
test("outline refuses to exceed the encoders' 8,192-pixel side limit", async () => {
  const pixels = new Uint8ClampedArray(8192 * 4).fill(255);
  await assert.rejects(
    outline(pixels, 8192, 1, { widthPct: 0.5, rgb: [0, 0, 0] }),
    /8,192 pixels on a side/,
  );
});
test("reduced previews keep the outline of thin features", async () => {
  // A one-pixel opaque line on 64x64 fades to alpha 64 when shrunk to 16x16.
  const size = 64,
    line = new Uint8ClampedArray(size * size * 4);
  for (let x = 8; x < 56; x++) line.set([255, 0, 0, 255], (32 * size + x) * 4);
  const small = resize(line, size, size, 16, 16),
    plain = await finish(small, 16, 16, {
      outline: { widthPct: 10, colour: "#FFFFFF" },
    }),
    kept = await finish(
      small,
      16,
      16,
      { outline: { widthPct: 10, colour: "#FFFFFF" } },
      undefined,
      shrinkSilhouette(line, size, size, 16, 16),
    );
  const white = (image) => {
    let n = 0;
    for (let i = 0; i < image.length; i += 4)
      if (image[i] === 255 && image[i + 1] === 255 && image[i + 3] === 255) n++;
    return n;
  };
  assert.equal(white(plain.pixels), 0);
  assert.ok(white(kept.pixels) > 10);
});
test("resize averages premultiplied, so transparent neighbours don't darken", () => {
  const pair = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual([...resize(pair, 2, 1, 1, 1)], [255, 0, 0, 128]);
  const flat = new Uint8ClampedArray(7 * 5 * 4);
  for (let i = 0; i < 35; i++) flat.set([18, 171, 52, 200], i * 4);
  const down = resize(flat, 7, 5, 3, 2),
    up = resize(flat, 7, 5, 16, 11);
  for (const image of [down, up])
    for (let i = 0; i < image.length; i += 4)
      assert.deepEqual([...image.slice(i, i + 4)], [18, 171, 52, 200]);
  const clear = resize(new Uint8ClampedArray(16), 2, 2, 1, 1);
  assert.deepEqual([...clear], [0, 0, 0, 0]);
});
test("the stroke's mask plus a colour is exactly the exported outline", async () => {
  // Soft edges and a part-transparent rim, so the maths is not all 0 and 255.
  const size = 24,
    pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 11.5, y - 11.5);
      if (d < 9)
        pixels.set(
          [200, 30, 90, Math.round(255 * Math.min(1, 10 - d))],
          (y * size + x) * 4,
        );
    }
  for (const widthPct of [0.5, 4, 15]) {
    const mask = await outlineMask(pixels, size, size, widthPct),
      rgb = [18, 171, 52],
      composed = compositeOutline(pixels, size, size, mask, rgb),
      direct = await outline(pixels, size, size, { widthPct, rgb });
    assert.deepEqual(composed.pixels, direct.pixels);
    assert.equal(composed.width, mask.width);
    assert.equal(composed.height, mask.height);
    // The stroke alone, with the artwork drawn over it (source-over), is
    // what the export holds.
    const layer = outlineLayer(mask, rgb);
    assert.equal(layer.length, mask.width * mask.height * 4);
    for (let i = 0; i < mask.coverage.length; i++) {
      assert.deepEqual([...layer.subarray(i * 4, i * 4 + 3)], rgb);
      assert.equal(layer[i * 4 + 3], Math.round(mask.coverage[i] * 255));
    }
  }
});
test("the mask says where the stroke falls and how far the canvas grows", async () => {
  // The square from 0 to 4 touches the top and left edges.
  const pixels = square(10, 0, 4),
    mask = await outlineMask(pixels, 10, 10, 20);
  assert.equal(mask.width, 13);
  assert.equal(mask.height, 13);
  assert.equal(mask.left, 3);
  assert.equal(mask.top, 3);
  const at = (x, y) =>
    mask.coverage[(y + mask.top) * mask.width + x + mask.left];
  assert.equal(at(1, 1), 1); // under the artwork
  assert.equal(at(-1, 0), 1); // one pixel out, on the grown part
  assert.equal(at(-2, 0), 0.5); // the rim, two pixels out
  assert.equal(at(-3, 0), 0); // beyond it, still on the canvas
  // Nothing to draw: no width, or nothing opaque.
  assert.equal(await outlineMask(pixels, 10, 10, 0), null);
  assert.equal(await outlineMask(new Uint8ClampedArray(400), 10, 10, 20), null);
  // The same limits as an export.
  await assert.rejects(
    outlineMask(new Uint8ClampedArray(8192 * 4).fill(255), 8192, 1, 0.5),
    /8,192 pixels on a side/,
  );
});
test("the stroke key follows the shape of the artwork and ignores its colours", () => {
  const pixels = square(),
    key = strokeKey(pixels);
  // Recolouring the artwork, or changing alpha between two opaque values,
  // leaves the stroke where it was.
  const recoloured = pixels.slice();
  for (let i = 0; i < recoloured.length; i += 4)
    if (recoloured[i + 3]) recoloured.set([0, 255, 0, 200], i);
  assert.equal(strokeKey(recoloured), key);
  // Making a pixel see-through (below 128) or drawing a new one moves it.
  const thinner = pixels.slice();
  thinner[(5 * 10 + 5) * 4 + 3] = 100;
  assert.notEqual(strokeKey(thinner), key);
  const fainter = pixels.slice();
  fainter[(0 * 10 + 0) * 4 + 3] = 5;
  assert.notEqual(strokeKey(fainter), key);
  assert.notEqual(strokeKey(new Uint8ClampedArray(400)), key);
  assert.notEqual(
    strokeKey(new Uint8ClampedArray(404)),
    strokeKey(new Uint8ClampedArray(400)),
  );
});
test("finish without settings returns the export unchanged", async () => {
  const pixels = square(),
    out = await finish(pixels, 10, 10);
  assert.equal(out.pixels, pixels);
  const off = await finish(pixels, 10, 10, {
    outline: { widthPct: 4, colour: "not a colour" },
  });
  assert.equal(off.pixels, pixels);
});
