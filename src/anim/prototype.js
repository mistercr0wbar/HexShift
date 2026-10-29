// Standalone animation prototype. The still-image editor does not call this.
import { Budget, MAX_FRAMES, MAX_INPUT, MAX_OWNED, MAX_SIDE, assertEnvelope } from "./limits.js";
import { encodeGif, parseGif, rgbaToPalette } from "./gif.js";
import { blankCanvas, compositeGif, drawWebpFrame } from "./composite.js";
import { muxWebp, parseWebp, stripRiff, wrapStill } from "./webp.js";
import { codecMemory, decodeStill, encodeStill } from "./codec.js";

export { MAX_FRAMES, MAX_INPUT, MAX_OWNED, MAX_SIDE, codecMemory };
export const ENVELOPE = { maxSide: MAX_SIDE, maxFrames: MAX_FRAMES, maxInput: MAX_INPUT, maxOwned: MAX_OWNED };

let epoch = 0;

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw Error("Choose a GIF or WebP for the animation prototype.");
}

function looksGif(bytes) {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  );
}

function looksWebp(bytes) {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function inspectAnimation(input) {
  const bytes = bytesOf(input);
  if (bytes.byteLength > MAX_INPUT) throw Error("Animation input is larger than 16 MiB.");
  const parsed = looksGif(bytes) ? parseGif(bytes) : looksWebp(bytes) ? parseWebp(bytes) : null;
  if (!parsed) throw Error("Choose a GIF or WebP for the animation prototype.");
  const info = describe(parsed, bytes.byteLength);
  assertEnvelope(info.width, info.height, info.frames, bytes.byteLength);
  return info;
}

function describe(parsed, inputBytes) {
  return {
    format: parsed.format,
    width: parsed.width,
    height: parsed.height,
    frames: parsed.frames.length,
    animated: parsed.frames.length >= 2,
    containerAnimated: parsed.format === "webp" ? !!parsed.containerAnimated : parsed.frames.length >= 2,
    loop: parsed.loop,
    durationsMs: parsed.frames.map((frame) =>
      parsed.format === "gif" ? frame.delayCs * 10 : frame.durationMs,
    ),
    inputBytes,
  };
}

function throwIfStopped(signal, ticket) {
  if (signal?.aborted) {
    const error = new DOMException("Aborted", "AbortError");
    throw error;
  }
  if (ticket !== epoch) throw Error("Superseded.");
}

export async function decodeAnimation(input, options = {}) {
  const ticket = ++epoch;
  const bytes = bytesOf(input);
  const info = inspectAnimation(bytes);
  const parsed = info.format === "gif" ? parseGif(bytes) : parseWebp(bytes);
  const budget = new Budget();
  const owned = [];
  try {
    let pixels;
    if (info.format === "gif") {
      let index = 0;
      pixels = compositeGif(parsed, budget, () => {
        throwIfStopped(options.signal, ticket);
        options.onFrame?.({ index, width: info.width, height: info.height });
        index++;
      });
    } else {
      pixels = [];
      const canvas = budget.track(blankCanvas(info.width, info.height, parsed.background));
      let prev = null;
      for (let index = 0; index < parsed.frames.length; index++) {
        throwIfStopped(options.signal, ticket);
        const frame = parsed.frames[index];
        const image = await decodeStill(wrapStill(frame.payload));
        if (image.width !== frame.width || image.height !== frame.height)
          throw Error("This browser cannot decode that WebP frame.");
        const patch = budget.track(new Uint8ClampedArray(image.data));
        drawWebpFrame(canvas, info.width, info.height, parsed.background, prev, frame, patch);
        budget.drop(patch);
        pixels.push(budget.track(new Uint8ClampedArray(canvas)));
        options.onFrame?.({ index, width: info.width, height: info.height });
        prev = frame;
      }
      budget.drop(canvas);
    }
    throwIfStopped(options.signal, ticket);
    const frames = pixels.map((data, index) => ({
      index,
      width: info.width,
      height: info.height,
      durationMs: info.durationsMs[index],
      data,
    }));
    owned.push(...frames);
    const result = {
      ...info,
      frames,
      ownedBytes: budget.used,
      ownedPeak: budget.peak,
      close() {
        for (const frame of frames) frame.data = new Uint8ClampedArray();
        budget.release();
        result.ownedBytes = 0;
        result.closed = true;
      },
    };
    return result;
  } catch (error) {
    budget.release();
    throw error;
  }
}

export function samplePoint(decoded, x, y) {
  if (decoded.closed) throw Error("Animation buffers were released.");
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height)
    throw Error("Sample is outside the canvas.");
  return decoded.frames.map((frame) => {
    const i = (y * frame.width + x) * 4;
    return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
  });
}

export async function encodeAnimation(format, image, options = {}) {
  const ticket = ++epoch;
  const { width, height, frames, loop = 0 } = image;
  if (!frames?.length) throw Error("Animation has no frames.");
  assertEnvelope(width, height, frames.length, 0);
  for (const frame of frames) {
    if (frame.data.length !== width * height * 4) throw Error("Truncated animation.");
  }
  throwIfStopped(options.signal, ticket);
  if (format === "gif") {
    const { palette, transparent, planes } = rgbaToPalette(frames);
    return encodeGif({
      width,
      height,
      palette,
      background: transparent >= 0 ? transparent : 0,
      loop,
      frames: planes.map((indices, index) => ({
        indices,
        left: 0,
        top: 0,
        width,
        height,
        delayCs: Math.round((frames[index].durationMs || 0) / 10),
        disposal: frames[index].disposal ?? 1,
        transparent,
      })),
    });
  }
  if (format !== "webp") throw Error("Choose a GIF or WebP for the animation prototype.");
  if (frames.length === 1 && (frames[0].disposal ?? 0) === 0 && (frames[0].blend ?? 1) === 1) {
    return encodeStill(frames[0].data, width, height);
  }
  const encoded = [];
  for (let index = 0; index < frames.length; index++) {
    throwIfStopped(options.signal, ticket);
    const still = await encodeStill(frames[index].data, width, height);
    encoded.push({
      x: 0,
      y: 0,
      width,
      height,
      durationMs: frames[index].durationMs || 0,
      blend: frames[index].blend ?? 1,
      disposal: frames[index].disposal ?? 0,
      chunks: stripRiff(still),
    });
  }
  return muxWebp({
    width,
    height,
    loop,
    background: image.background ?? [0, 0, 0, 0],
    frames: encoded,
  });
}
