import { clamp, parseHex } from "./colour.js";
import { MAX_PIXELS } from "./engine.js";
import { fitted } from "./presets.js";
// Finite stand-in for "no inside pixel yet": Infinity - Infinity would be NaN
// in the parabola intersections below.
const FAR = 1e20;
// Felzenszwalb–Huttenlocher exact squared distance transform along one line.
function line(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let p = v[k],
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * (q - p));
    while (s <= z[k]) {
      p = v[--k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * (q - p));
    }
    v[++k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
// Squared Euclidean distance from every pixel to the nearest `inside` pixel.
export async function distanceField(inside, w, h, yieldFn = async () => {}) {
  const out = new Float64Array(w * h),
    size = Math.max(w, h),
    f = new Float64Array(size),
    d = new Float64Array(size),
    v = new Int32Array(size),
    z = new Float64Array(size + 1);
  for (let i = 0; i < w * h; i++) out[i] = inside[i] ? 0 : FAR;
  for (let x = 0; x < w; x++) {
    if ((x & 63) === 0) await yieldFn();
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    line(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    if ((y & 63) === 0) await yieldFn();
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    line(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}
// Outline radius in pixels for a width given as a percentage of the longest side.
export const outlineRadius = (w, h, widthPct) =>
  (Math.max(w, h) * widthPct) / 100;
// Where the stroke falls: its coverage (0 to 1) at every pixel of the canvas it
// needs, around the silhouette (alpha >= 128, or a given `silhouette` mask of
// the same size). The canvas grows only where the transparent margin is
// narrower than the stroke, by `left` and `top` at the origin. Returns null
// when there is nothing to draw. The colour is added later (compositeOutline,
// outlineLayer), so the viewer keeps this and only recolours it.
export async function outlineMask(pixels, w, h, widthPct, silhouette, yieldFn) {
  const r = outlineRadius(w, h, widthPct);
  if (!(r > 0)) return null;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (pixels[(y * w + x) * 4 + 3]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (maxX < 0) return null;
  const reach = Math.ceil(r + 0.5),
    left = Math.max(0, reach - minX),
    top = Math.max(0, reach - minY),
    W = w + left + Math.max(0, reach - (w - 1 - maxX)),
    H = h + top + Math.max(0, reach - (h - 1 - maxY));
  if (W * H > MAX_PIXELS || W > 8192 || H > 8192)
    throw Error(
      "The outline would make the image larger than 4,194,304 pixels or 8,192 pixels on a side. Use a thinner outline or a smaller image.",
    );
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    const row = (y + top) * W + left;
    if (silhouette) inside.set(silhouette.subarray(y * w, (y + 1) * w), row);
    else
      for (let x = 0; x < w; x++)
        inside[row + x] = pixels[(y * w + x) * 4 + 3] >= 128 ? 1 : 0;
  }
  const dist = await distanceField(inside, W, H, yieldFn),
    coverage = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++)
    coverage[i] = clamp(r + 0.5 - Math.sqrt(dist[i]), 0, 1);
  return { coverage, width: W, height: H, left, top };
}
// Paints the stroke of `rgb` under the artwork, on the mask's canvas.
export function compositeOutline(pixels, w, h, mask, rgb) {
  const { coverage, width: W, height: H, left, top } = mask,
    art = new Uint8ClampedArray(W * H * 4),
    out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++)
    art.set(
      pixels.subarray(y * w * 4, (y + 1) * w * 4),
      ((y + top) * W + left) * 4,
    );
  for (let i = 0; i < W * H; i++) {
    const o = i * 4,
      lineA = coverage[i],
      artA = art[o + 3] / 255,
      a = artA + lineA * (1 - artA);
    if (!a) continue;
    for (let c = 0; c < 3; c++)
      out[o + c] = Math.round(
        (art[o + c] * artA + rgb[c] * lineA * (1 - artA)) / a,
      );
    out[o + 3] = Math.round(a * 255);
  }
  return { pixels: out, width: W, height: H };
}
// Paints an anti-aliased stroke of `rgb` around the silhouette, under the
// artwork: the export's outline.
export async function outline(
  pixels,
  w,
  h,
  { widthPct, rgb, silhouette },
  yieldFn,
) {
  const mask = await outlineMask(pixels, w, h, widthPct, silhouette, yieldFn);
  return mask
    ? compositeOutline(pixels, w, h, mask, rgb)
    : { pixels, width: w, height: h };
}
// The stroke alone as an image, for the viewer to draw behind the artwork: the
// outline colour at the stroke's coverage. The artwork drawn over it gives the
// same pixels as compositeOutline.
export function outlineLayer(mask, rgb) {
  const { coverage, width, height } = mask,
    out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < coverage.length; i++) {
    const o = i * 4;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
    out[o + 3] = Math.round(coverage[i] * 255);
  }
  return out;
}
// What the stroke depends on in the artwork: which pixels are inside it (alpha
// 128 or more) and which are drawn at all (any alpha). Recolouring leaves the
// key alone, so a recolour never recomputes the stroke.
export function strokeKey(pixels) {
  let a = 2166136261,
    b = 5381;
  for (let i = 3; i < pixels.length; i += 4) {
    const v = pixels[i] >= 128 ? 2 : pixels[i] ? 1 : 0;
    a = Math.imul(a ^ v, 16777619);
    b = (Math.imul(b, 33) + v) | 0;
  }
  return a + ":" + b + ":" + pixels.length;
}
// For each output index along one axis: the source indices and weights.
// Shrinking averages the exact covered area; enlarging interpolates linearly.
function taps(from, to) {
  const scale = from / to,
    list = [];
  for (let i = 0; i < to; i++) {
    const t = [];
    if (scale >= 1) {
      const a = i * scale,
        b = (i + 1) * scale;
      for (let s = Math.floor(a); s < Math.min(from, Math.ceil(b)); s++) {
        const cover = Math.min(b, s + 1) - Math.max(a, s);
        if (cover > 0) t.push(s, cover / scale);
      }
    } else {
      const c = clamp((i + 0.5) * scale - 0.5, 0, from - 1),
        s = Math.floor(c),
        f = c - s;
      t.push(s, 1 - f);
      if (f > 0) t.push(s + 1, f);
    }
    list.push(t);
  }
  return list;
}
// Resamples in premultiplied alpha, so fully transparent neighbours never
// darken or tint edges. Deterministic (no canvas), so tests match browsers.
export function resize(pixels, w, h, ow, oh) {
  if (ow === w && oh === h) return pixels;
  const pre = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = pixels[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) pre[i * 4 + c] = pixels[i * 4 + c] * a;
    pre[i * 4 + 3] = pixels[i * 4 + 3];
  }
  const tx = taps(w, ow),
    ty = taps(h, oh),
    mid = new Float32Array(ow * h * 4),
    out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < ow; x++) {
      const t = tx[x];
      for (let k = 0; k < t.length; k += 2)
        for (let c = 0; c < 4; c++)
          mid[(y * ow + x) * 4 + c] += pre[(y * w + t[k]) * 4 + c] * t[k + 1];
    }
  const acc = new Float32Array(4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const t = ty[y];
      acc.fill(0);
      for (let k = 0; k < t.length; k += 2)
        for (let c = 0; c < 4; c++)
          acc[c] += mid[(t[k] * ow + x) * 4 + c] * t[k + 1];
      const o = (y * ow + x) * 4,
        a = Math.round(acc[3]);
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++)
        out[o + c] = Math.round(acc[c] / (acc[3] / 255));
      out[o + 3] = a;
    }
  return out;
}
// The silhouette (alpha >= 128) of a full-size image at a smaller size: an
// output pixel is inside if any source pixel it covers is. Shrinking the image
// first would fade thin lines below the threshold and drop their outline.
export function shrinkSilhouette(pixels, w, h, ow, oh) {
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) {
    const oy = Math.min(oh - 1, Math.floor((y * oh) / h));
    for (let x = 0; x < w; x++)
      if (pixels[(y * w + x) * 4 + 3] >= 128)
        out[oy * ow + Math.min(ow - 1, Math.floor((x * ow) / w))] = 1;
  }
  return out;
}
// Scales the image so its longest side is `box`, then (with `pad`) centres it
// on a transparent box × box square. Matches `fitted()` in presets.js.
export function fit(pixels, w, h, box, pad) {
  const { width, height } = fitted(w, h, box, false),
    scaled = resize(pixels, w, h, width, height);
  if (!pad || (width === box && height === box))
    return { pixels: scaled, width, height };
  const out = new Uint8ClampedArray(box * box * 4),
    left = (box - width) >> 1,
    top = (box - height) >> 1;
  for (let y = 0; y < height; y++)
    out.set(
      scaled.subarray(y * width * 4, (y + 1) * width * 4),
      ((y + top) * box + left) * 4,
    );
  return { pixels: out, width: box, height: box };
}
// The export pipeline: what is saved, copied and shown in the output preview.
// `silhouette` lets a reduced preview keep the full-size outline shape.
export async function finish(pixels, w, h, settings = {}, yieldFn, silhouette) {
  let out = { pixels, width: w, height: h };
  const rgb = settings.outline && parseHex(settings.outline.colour);
  if (rgb && settings.outline.widthPct > 0)
    out = await outline(
      out.pixels,
      out.width,
      out.height,
      { widthPct: settings.outline.widthPct, rgb, silhouette },
      yieldFn,
    );
  return out;
}
