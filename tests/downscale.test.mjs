import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOURCE_BYTES,
  SOURCE_LIMIT,
  SOURCE_PIXELS,
  SOURCE_SIDE,
  WORKING_LIMIT,
  WORKING_SIDE,
  RESIZE_UNAVAILABLE,
  decodeBlob,
  dimensions,
  fitDimensions,
  fitsWorking,
  inspectBlob,
  inspectRaster,
  resizeDecodingAvailable,
} from "../src/import.js";
import { MAX_PIXELS } from "../src/engine.js";

const ANIMATED_LIMIT =
  "Animated images are not downscaled. Use at most 4,194,304 pixels and 8,192 pixels on either side.";

function u32be(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function u16le(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
function text(value) {
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
}
function chunk(type, data) {
  return concat([u32be(data.length), text(type), data, u32be(0)]);
}
function png(width, height, extra = []) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([
    text("\x89PNG\r\n\x1a\n"),
    chunk("IHDR", ihdr),
    ...extra,
  ]);
}
function actl() {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setUint32(0, 2);
  return chunk("acTL", data);
}
function exifTiff(orientation) {
  // Little-endian TIFF, one IFD, orientation short.
  const tiff = new Uint8Array(22);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  return tiff;
}
function jpeg(width, height, orientation) {
  const tiff = exifTiff(orientation);
  const payload = concat([text("Exif\0\0"), tiff]);
  const app = concat([u16be(payload.length + 2), payload]);
  const sof = new Uint8Array(8);
  const view = new DataView(sof.buffer);
  view.setUint16(0, 8);
  sof[2] = 8;
  view.setUint16(3, height);
  view.setUint16(5, width);
  return concat([
    Uint8Array.of(0xff, 0xd8),
    Uint8Array.of(0xff, 0xe1),
    app,
    Uint8Array.of(0xff, 0xc0),
    sof,
    Uint8Array.of(0xff, 0xd9),
  ]);
}
function u16be(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
}
function gif(width, height) {
  const b = text("GIF89a");
  const out = new Uint8Array(13);
  out.set(b);
  out[6] = width & 255;
  out[7] = (width >> 8) & 255;
  out[8] = height & 255;
  out[9] = (height >> 8) & 255;
  return out;
}
function webp(width, height, { animated = false, exif = null } = {}) {
  const payload = new Uint8Array(10);
  payload[0] = animated ? 2 : 0;
  const w = width - 1,
    h = height - 1;
  payload[4] = w & 255;
  payload[5] = (w >> 8) & 255;
  payload[6] = (w >> 16) & 255;
  payload[7] = h & 255;
  payload[8] = (h >> 8) & 255;
  payload[9] = (h >> 16) & 255;
  const parts = [chunk4("VP8X", payload)];
  if (exif) parts.push(chunk4("EXIF", exif));
  const body = concat(parts);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, 4 + body.length, true);
  return concat([text("RIFF"), size, text("WEBP"), body]);
}
function chunk4(type, data) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, true);
  const pad = data.length & 1 ? Uint8Array.of(0) : new Uint8Array();
  return concat([text(type), len, data, pad]);
}
function proposal(bytes) {
  const info = inspectRaster(bytes);
  assert.equal(info.proposal == null, false);
  return info;
}

test("working limits stay 4,194,304 pixels and 8,192 on a side", () => {
  assert.equal(MAX_PIXELS, 4194304);
  assert.equal(WORKING_SIDE, 8192);
  assert.deepEqual(dimensions(8192, 512), { width: 8192, height: 512 });
  assert.equal(fitsWorking(8192, 512), true);
  assert.throws(() => dimensions(8193, 1), new RegExp(WORKING_LIMIT));
  assert.throws(() => dimensions(8192, 513));
  assert.throws(() => dimensions(0, 1));
});

test("downscale rounds the spec scale down and clamps a side to one pixel", () => {
  assert.equal(SOURCE_SIDE, 16384);
  assert.equal(SOURCE_PIXELS, 16777216);
  assert.equal(SOURCE_BYTES, 16 * 1024 * 1024);
  assert.deepEqual(fitDimensions(4096, 4096), { width: 2048, height: 2048 });
  assert.deepEqual(fitDimensions(8192, 2048), { width: 4096, height: 1024 });
  assert.deepEqual(fitDimensions(8193, 100), { width: 8192, height: 99 });
  assert.equal(8192 * 99, 811008);
  assert.deepEqual(fitDimensions(16384, 1024), { width: 8192, height: 512 });
  assert.deepEqual(fitDimensions(3000, 2000), { width: 2508, height: 1672 });
  assert.equal(2508 * 1672 <= MAX_PIXELS, true);
  assert.deepEqual(fitDimensions(16384, 1), { width: 8192, height: 1 });
  assert.deepEqual(fitDimensions(9000, 100), { width: 8192, height: 91 });
  assert.deepEqual(fitDimensions(3000, 1500), { width: 2896, height: 1448 });
  assert.throws(() => fitDimensions(8192, 8192), /downscale/);
  assert.throws(() => fitDimensions(16385, 1), /downscale/);
  assert.throws(() => fitDimensions(5000, 4000), /downscale/);
  assert.deepEqual(fitDimensions(8192, 512), { width: 8192, height: 512 });
});

test("static headers propose a fit, and animations are refused before that offer", () => {
  const wide = proposal(png(9000, 100));
  assert.deepEqual(wide.proposal, { width: 8192, height: 91 });
  assert.equal(wide.still, false);
  assert.equal(proposal(png(3000, 1500)).proposal.width, 2896);
  assert.equal(inspectRaster(png(8192, 512)).proposal, null);
  assert.throws(() => inspectRaster(png(16385, 10)), new RegExp(SOURCE_LIMIT));
  assert.throws(() => inspectRaster(png(5000, 4000)), /downscale/);
  assert.throws(() => inspectRaster(png(8192, 8192)), /downscale/);
  assert.throws(() => inspectRaster(png(9000, 100, [actl()])), new RegExp(ANIMATED_LIMIT));
  assert.throws(() => inspectRaster(png(20000, 20000, [actl()])), /not downscaled/);
  const still = inspectRaster(png(32, 32, [actl()]));
  assert.equal(still.still, true);
  assert.equal(still.animated, true);
  assert.equal(still.proposal, null);
  assert.throws(() => inspectRaster(gif(9000, 100)), /not downscaled/);
  const smallGif = inspectRaster(gif(8, 4));
  assert.equal(smallGif.still, true);
  assert.equal(smallGif.proposal, null);
  assert.equal(smallGif.type, "image/gif");
  assert.throws(() => inspectRaster(webp(9000, 100, { animated: true })), /not downscaled/);
  const moving = inspectRaster(webp(12, 8, { animated: true }));
  assert.equal(moving.still, true);
  assert.equal(moving.proposal, null);
  assert.equal(inspectRaster(webp(12, 8)).proposal, null);
  assert.equal(inspectRaster(webp(12, 8)).still, false);
});

test("EXIF orientations 5 to 8 swap the axes used for the offer", () => {
  for (const orientation of [5, 6, 7, 8]) {
    const info = inspectRaster(jpeg(100, 9000, orientation));
    assert.equal(info.width, 100);
    assert.equal(info.height, 9000);
    assert.equal(info.orientedWidth, 9000);
    assert.equal(info.orientedHeight, 100);
    assert.deepEqual(info.proposal, { width: 8192, height: 91 });
  }
  const upright = inspectRaster(jpeg(100, 9000, 1));
  assert.equal(upright.orientedWidth, 100);
  assert.equal(upright.orientedHeight, 9000);
  assert.deepEqual(upright.proposal, { width: 91, height: 8192 });
  const pngTurned = inspectRaster(png(20, 10, [chunk("eXIf", exifTiff(6))]));
  assert.equal(pngTurned.orientedWidth, 10);
  assert.equal(pngTurned.orientedHeight, 20);
  assert.equal(pngTurned.proposal, null);
  const webpTurned = inspectRaster(
    webp(100, 9000, { exif: concat([text("Exif\0\0"), exifTiff(6)]) }),
  );
  assert.deepEqual(webpTurned.proposal, { width: 8192, height: 91 });
  assert.throws(
    () => inspectRaster(jpeg(100, 9000, 6).subarray(0, 20)),
    /Truncated|Invalid|dimensions/,
  );
});

test("a proposal is not decoded until a resize choice is given", async () => {
  const bytes = png(9000, 100);
  const blob = new Blob([bytes], { type: "image/png" });
  const info = await inspectBlob(blob);
  assert.deepEqual(info.proposal, { width: 8192, height: 91 });
  await assert.rejects(() => decodeBlob(blob), new RegExp("4,194,304"));
  await assert.rejects(
    () => decodeBlob(blob, undefined, { resize: "smooth" }),
    (error) => error.message === RESIZE_UNAVAILABLE,
  );
  await assert.rejects(
    () => decodeBlob(blob, undefined, { resize: "nearest" }),
    (error) => error.message === RESIZE_UNAVAILABLE,
  );
  const oversized = new Blob([Uint8Array.of(1)]);
  Object.defineProperty(oversized, "size", { value: SOURCE_BYTES + 1 });
  await assert.rejects(() => inspectBlob(oversized), /16 MiB/);
  assert.equal(await resizeDecodingAvailable(), false);
});
