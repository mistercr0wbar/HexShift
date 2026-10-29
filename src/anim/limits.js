// The animation prototype's own ceiling. It is not the still-image importer.
export const MAX_SIDE = 512;
export const MAX_FRAMES = 100;
export const MAX_INPUT = 16 * 1024 * 1024;
export const MAX_OWNED = 128 * 1024 * 1024;

export const LIMIT_INPUT = "Animation input is larger than 16 MiB.";
export const LIMIT_SIDE = "Animation is larger than 512 pixels on a side.";
export const LIMIT_FRAMES = "Animation has more than 100 frames.";
export const LIMIT_OWNED = "Animation buffers would exceed 128 MiB.";

export function assertEnvelope(width, height, frames, inputBytes) {
  if (inputBytes > MAX_INPUT) throw Error(LIMIT_INPUT);
  if (width > MAX_SIDE || height > MAX_SIDE) throw Error(LIMIT_SIDE);
  if (frames > MAX_FRAMES) throw Error(LIMIT_FRAMES);
  // Every published frame, the canvas, the disposal snapshot, and one patch.
  const canvas = width * height * 4;
  if (canvas * (frames + 3) > MAX_OWNED) throw Error(LIMIT_OWNED);
}

export class Budget {
  constructor() {
    this.used = 0;
    this.peak = 0;
    this.holds = new Set();
  }
  track(buffer) {
    const n = buffer.byteLength;
    if (this.used + n > MAX_OWNED) throw Error(LIMIT_OWNED);
    this.used += n;
    this.peak = Math.max(this.peak, this.used);
    this.holds.add(buffer);
    return buffer;
  }
  drop(buffer) {
    if (!buffer || !this.holds.has(buffer)) return;
    this.holds.delete(buffer);
    this.used -= buffer.byteLength;
  }
  release() {
    this.holds.clear();
    this.used = 0;
  }
}
