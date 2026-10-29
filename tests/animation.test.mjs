import "../src/anim/codec-node.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodeGif } from "../src/anim/gif.js";
import { muxWebp, stripRiff } from "../src/anim/webp.js";
import { inspectRaster } from "../src/import.js";
import {
  decodeAnimation,
  encodeAnimation,
  inspectAnimation,
  samplePoint,
  codecMemory,
  MAX_INPUT,
} from "../src/anim/prototype.js";

function solid(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return data;
}

function pixel(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
}

test("a two-frame GIF round-trips, and one frame is not an animation", async () => {
  const width = 4;
  const height = 2;
  const red = solid(width, height, [220, 20, 20, 255]);
  const blue = solid(width, height, [20, 20, 220, 255]);
  blue.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
  const gif = await encodeAnimation("gif", {
    width,
    height,
    loop: 0,
    frames: [
      { data: red, durationMs: 100 },
      { data: blue, durationMs: 200 },
    ],
  });
  const info = inspectAnimation(gif);
  assert.equal(info.animated, true);
  assert.equal(info.frames, 2);
  assert.equal(info.loop, 0);
  assert.deepEqual(info.durationsMs, [100, 200]);
  const decoded = await decodeAnimation(gif);
  assert.deepEqual(pixel(decoded.frames[0], 0, 0), [220, 20, 20, 255]);
  assert.deepEqual(pixel(decoded.frames[1], 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(decoded.frames[1], 3, 1), [20, 20, 220, 255]);
  assert.deepEqual(samplePoint(decoded, 3, 1), [
    [220, 20, 20, 255],
    [20, 20, 220, 255],
  ]);
  assert.deepEqual(samplePoint(decoded, 3, 1), samplePoint(decoded, 3, 1));
  const once = await encodeAnimation("gif", {
    width: 1,
    height: 1,
    frames: [{ data: solid(1, 1, [1, 2, 3, 255]), durationMs: 0 }],
  });
  assert.equal(inspectAnimation(once).animated, false);
  const sharpGif = await sharp(gif, { animated: true, pages: -1 }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(sharpGif.info.channels, 4);
  assert.equal(sharpGif.data[0], 220);
  decoded.close();
  assert.throws(() => samplePoint(decoded, 0, 0), /released/);
});

test("GIF disposal clears only the previous rectangle", async () => {
  const palette = Uint8Array.from([0, 0, 0, 200, 0, 0, 0, 0, 200]);
  const red = new Uint8Array(8);
  red.fill(1);
  const blue = new Uint8Array([0, 0, 2, 2]);
  const gif = encodeGif({
    width: 4,
    height: 2,
    palette,
    background: 0,
    loop: 0,
    frames: [
      { indices: red, left: 0, top: 0, width: 4, height: 2, delayCs: 5, disposal: 2, transparent: 0 },
      { indices: blue, left: 2, top: 0, width: 2, height: 2, delayCs: 5, disposal: 1, transparent: 0 },
    ],
  });
  const decoded = await decodeAnimation(gif);
  assert.deepEqual(pixel(decoded.frames[0], 0, 0), [200, 0, 0, 255]);
  assert.deepEqual(pixel(decoded.frames[1], 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(decoded.frames[1], 3, 1), [0, 0, 200, 255]);
  decoded.close();
});

test("an interlaced GIF matches the plain frame", async () => {
  const palette = Uint8Array.from([9, 8, 7, 1, 2, 3]);
  const indices = Uint8Array.from([0, 1, 0, 1, 1, 0, 1, 0]);
  const plain = encodeGif({
    width: 4,
    height: 2,
    palette,
    frames: [{ indices, left: 0, top: 0, width: 4, height: 2, transparent: -1, disposal: 1 }],
  });
  const laced = encodeGif({
    width: 4,
    height: 2,
    palette,
    frames: [{ indices, left: 0, top: 0, width: 4, height: 2, transparent: -1, disposal: 1, interlaced: true }],
  });
  const a = await decodeAnimation(plain);
  const b = await decodeAnimation(laced);
  assert.deepEqual([...a.frames[0].data], [...b.frames[0].data]);
  a.close();
  b.close();
});

test("WebP keeps partial frames, blend, and a still file is not an animation", async () => {
  const width = 4;
  const height = 2;
  const red = solid(width, height, [255, 0, 0, 255]);
  const green = solid(width, height, [0, 255, 0, 128]);
  const file = await encodeAnimation("webp", {
    width,
    height,
    loop: 0,
    frames: [
      { data: red, durationMs: 40, disposal: 0, blend: 1 },
      { data: green, durationMs: 40, disposal: 0, blend: 0 },
    ],
  });
  const info = inspectAnimation(file);
  assert.equal(info.format, "webp");
  assert.equal(info.animated, true);
  assert.equal(info.containerAnimated, true);
  assert.equal(info.loop, 0);
  const decoded = await decodeAnimation(file);
  assert.deepEqual(pixel(decoded.frames[0], 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(decoded.frames[1], 1, 1), [127, 128, 0, 255]);
  const still = await encodeAnimation("webp", {
    width: 2,
    height: 2,
    frames: [{ data: solid(2, 2, [0, 0, 255, 128]), durationMs: 0 }],
  });
  const stillInfo = inspectAnimation(still);
  assert.equal(stillInfo.animated, false);
  assert.equal(stillInfo.containerAnimated, false);
  const codec = await codecMemory();
  assert.equal(codec.libwebp, "1.1.0");
  assert.equal(codec.decoderHeapBytes > 0, true);
  assert.equal(decoded.ownedPeak < 128 * 1024 * 1024, true);
  assert.equal(codec.decoderHeapBytes > decoded.ownedPeak, true);
  decoded.close();
});

test("limits, cancellation, and a superseded decode do not publish", async () => {
  const wide = await encodeAnimation("gif", {
    width: 8,
    height: 1,
    frames: [{ data: solid(8, 1, [1, 1, 1, 255]) }],
  });
  wide[6] = 1;
  wide[7] = 2;
  assert.throws(() => inspectAnimation(wide), /512/);
  const huge = new Uint8Array(MAX_INPUT + 1);
  huge.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assert.throws(() => inspectAnimation(huge), /16 MiB/);
  const gif = await encodeAnimation("gif", {
    width: 2,
    height: 2,
    frames: [
      { data: solid(2, 2, [1, 0, 0, 255]), durationMs: 10 },
      { data: solid(2, 2, [0, 1, 0, 255]), durationMs: 10 },
    ],
  });
  const signal = AbortSignal.abort();
  await assert.rejects(decodeAnimation(gif, { signal }), /Abort/);
  let second;
  const first = decodeAnimation(gif, {
    onFrame() {
      second = decodeAnimation(gif);
    },
  });
  await assert.rejects(first, /Superseded/);
  const ok = await second;
  assert.equal(ok.frames.length, 2);
  ok.close();
  await assert.rejects(
    encodeAnimation("gif", { width: 1, height: 1, frames: [{ data: solid(1, 1, [1, 2, 3, 128]) }] }),
    /partial transparency/,
  );
  await assert.rejects(
    encodeAnimation("gif", {
      width: 1,
      height: 1,
      frames: Array.from({ length: 101 }, () => ({ data: solid(1, 1, [1, 2, 3, 255]) })),
    }),
    /100 frames/,
  );
});

test("restore-previous puts the covered rectangle back", async () => {
  const palette = Uint8Array.from([9, 0, 0, 200, 0, 0, 0, 0, 200, 0, 180, 0]);
  const red = new Uint8Array(4).fill(1);
  const blue = Uint8Array.from([2, 2]);
  const green = Uint8Array.from([3]);
  const gif = encodeGif({
    width: 2,
    height: 2,
    palette,
    frames: [
      { indices: red, left: 0, top: 0, width: 2, height: 2, disposal: 1, transparent: -1 },
      { indices: blue, left: 0, top: 0, width: 2, height: 1, disposal: 3, transparent: -1 },
      { indices: green, left: 1, top: 1, width: 1, height: 1, disposal: 1, transparent: -1 },
    ],
  });
  const decoded = await decodeAnimation(gif);
  assert.deepEqual(pixel(decoded.frames[1], 0, 0), [0, 0, 200, 255]);
  assert.deepEqual(pixel(decoded.frames[2], 0, 0), [200, 0, 0, 255]);
  assert.deepEqual(pixel(decoded.frames[2], 1, 1), [0, 180, 0, 255]);
  decoded.close();
});

test("a partial WebP frame clears only the disposed rectangle", async () => {
  const red = await encodeAnimation("webp", {
    width: 4,
    height: 2,
    frames: [{ data: solid(4, 2, [255, 0, 0, 255]) }],
  });
  const blue = await encodeAnimation("webp", {
    width: 2,
    height: 2,
    frames: [{ data: solid(2, 2, [0, 0, 255, 255]) }],
  });
  const file = muxWebp({
    width: 4,
    height: 2,
    loop: 1,
    background: [0, 0, 0, 0],
    frames: [
      { x: 0, y: 0, width: 4, height: 2, durationMs: 20, blend: 1, disposal: 1, chunks: stripRiff(red) },
      { x: 2, y: 0, width: 2, height: 2, durationMs: 20, blend: 1, disposal: 0, chunks: stripRiff(blue) },
    ],
  });
  const decoded = await decodeAnimation(file);
  assert.deepEqual(pixel(decoded.frames[0], 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(decoded.frames[1], 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(decoded.frames[1], 3, 1), [0, 0, 255, 255]);
  decoded.close();
});

test("the still-image importer still opens a two-frame GIF as a still", async () => {
  const gif = await encodeAnimation("gif", {
    width: 2,
    height: 2,
    frames: [
      { data: solid(2, 2, [1, 2, 3, 255]) },
      { data: solid(2, 2, [4, 5, 6, 255]) },
    ],
  });
  const info = inspectRaster(gif);
  assert.equal(info.type, "image/gif");
  assert.equal(info.still, true);
  assert.equal(info.proposal, null);
});
