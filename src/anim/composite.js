import { gifIndices } from "./gif.js";

function copyCanvas(src) {
  return new Uint8ClampedArray(src);
}

function fillRect(canvas, width, x, y, w, h, color) {
  for (let row = 0; row < h; row++) {
    const yy = y + row;
    for (let col = 0; col < w; col++) {
      const i = (yy * width + x + col) * 4;
      canvas[i] = color[0];
      canvas[i + 1] = color[1];
      canvas[i + 2] = color[2];
      canvas[i + 3] = color[3];
    }
  }
}

// Spec integer blend, sRGB, not linear light. srcA 0 leaves dst unchanged.
function blendOver(canvas, i, r, g, b, a) {
  if (a === 0) return;
  if (a === 255) {
    canvas[i] = r;
    canvas[i + 1] = g;
    canvas[i + 2] = b;
    canvas[i + 3] = 255;
    return;
  }
  const dstA = canvas[i + 3];
  const inv = 1 - a / 255;
  const outA = a + dstA * inv;
  if (outA === 0) {
    canvas[i] = canvas[i + 1] = canvas[i + 2] = canvas[i + 3] = 0;
    return;
  }
  canvas[i] = Math.round((r * a + canvas[i] * dstA * inv) / outA);
  canvas[i + 1] = Math.round((g * a + canvas[i + 1] * dstA * inv) / outA);
  canvas[i + 2] = Math.round((b * a + canvas[i + 2] * dstA * inv) / outA);
  canvas[i + 3] = Math.round(outA);
}

function paint(canvas, width, height, patch, x, y, pw, ph, blend) {
  if (x < 0 || y < 0 || x + pw > width || y + ph > height)
    throw Error("Truncated animation.");
  for (let row = 0; row < ph; row++) {
    for (let col = 0; col < pw; col++) {
      const s = (row * pw + col) * 4;
      const d = ((y + row) * width + x + col) * 4;
      if (blend)
        blendOver(canvas, d, patch[s], patch[s + 1], patch[s + 2], patch[s + 3]);
      else {
        canvas[d] = patch[s];
        canvas[d + 1] = patch[s + 1];
        canvas[d + 2] = patch[s + 2];
        canvas[d + 3] = patch[s + 3];
      }
    }
  }
}

export function compositeGif(parsed, budget, check) {
  const { width, height, frames, background, global } = parsed;
  const bgColor = backgroundColor(global, background);
  const canvas = budget.track(new Uint8ClampedArray(width * height * 4));
  const published = [];
  let pending = null;
  for (const frame of frames) {
    check?.();
    if (pending?.disposal === 2)
      fillRect(canvas, width, pending.x, pending.y, pending.w, pending.h, pending.clear);
    if (pending?.disposal === 3) {
      paint(canvas, width, height, pending.snap, pending.x, pending.y, pending.w, pending.h, false);
      budget.drop(pending.snap);
    }
    // Unspecified disposal matches do-not-dispose. Restore-previous keeps the rect from before the draw.
    const disposal = frame.disposal === 0 ? 1 : frame.disposal;
    let snap = null;
    if (disposal === 3) {
      snap = budget.track(new Uint8ClampedArray(frame.width * frame.height * 4));
      for (let row = 0; row < frame.height; row++) {
        for (let col = 0; col < frame.width; col++) {
          const d = (row * frame.width + col) * 4;
          const s = ((frame.top + row) * width + frame.left + col) * 4;
          snap[d] = canvas[s];
          snap[d + 1] = canvas[s + 1];
          snap[d + 2] = canvas[s + 2];
          snap[d + 3] = canvas[s + 3];
        }
      }
    }
    const indices = gifIndices(frame);
    const patch = budget.track(new Uint8ClampedArray(indices.length * 4));
    const palette = frame.palette;
    for (let n = 0; n < indices.length; n++) {
      const color = indices[n];
      if (color === frame.transparent) continue;
      const p = n * 4;
      const c = color * 3;
      if (c + 2 >= palette.length) throw Error("Truncated animation.");
      patch[p] = palette[c];
      patch[p + 1] = palette[c + 1];
      patch[p + 2] = palette[c + 2];
      patch[p + 3] = 255;
    }
    paint(canvas, width, height, patch, frame.left, frame.top, frame.width, frame.height, false);
    budget.drop(patch);
    published.push(budget.track(copyCanvas(canvas)));
    pending = {
      disposal,
      x: frame.left,
      y: frame.top,
      w: frame.width,
      h: frame.height,
      clear: frame.transparent >= 0 ? [0, 0, 0, 0] : bgColor,
      snap,
    };
  }
  if (pending?.snap) budget.drop(pending.snap);
  budget.drop(canvas);
  return published;
}

function backgroundColor(global, index) {
  if (!global || index * 3 + 2 >= global.length) return [0, 0, 0, 0];
  return [global[index * 3], global[index * 3 + 1], global[index * 3 + 2], 255];
}

export function blankCanvas(width, height, color) {
  const canvas = new Uint8ClampedArray(width * height * 4);
  fillRect(canvas, width, 0, 0, width, height, color);
  return canvas;
}

export function drawWebpFrame(canvas, width, height, background, prev, frame, patch) {
  if (prev?.disposal === 1)
    fillRect(canvas, width, prev.x, prev.y, prev.width, prev.height, background);
  if (patch.length !== frame.width * frame.height * 4)
    throw Error("This browser cannot decode that WebP frame.");
  paint(canvas, width, height, patch, frame.x, frame.y, frame.width, frame.height, frame.blend === 0);
}
