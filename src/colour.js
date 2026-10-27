export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
export const hueDelta = (a, b) => ((a - b + 540) % 360) - 180;
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    c = hi - lo,
    l = (hi + lo) / 2;
  let h = 0;
  if (c)
    h =
      hi === r
        ? ((g - b) / c) % 6
        : hi === g
          ? (b - r) / c + 2
          : (r - g) / c + 4;
  return [(h * 60 + 360) % 360, c ? c / (1 - Math.abs(2 * l - 1)) : 0, l, c];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
export function parseHex(value) {
  let s = String(value).trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join("");
  return /^[\da-f]{6}$/i.test(s)
    ? [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
    : null;
}
// Typed colours: hex (with or without #), rgb() and hsl() in comma or space
// syntax. Only opaque colours; [r, g, b] or null. The page falls back to the
// browser's own CSS parser for colour names and newer syntaxes.
export function parseColour(value) {
  const s = String(value).trim().toLowerCase();
  const hex = parseHex(s);
  if (hex) return hex;
  const m = /^(rgba?|hsla?)\(\s*([^)]*?)\s*\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/\s*[,/]\s*|\s+/);
  if (parts.length < 3 || parts.length > 4) return null;
  // A number, a percentage of `scale`, or degrees.
  const num = (t, scale) => {
    const v = /^(-?(?:\d+\.?\d*|\.\d+))(%|deg)?$/.exec(t);
    if (!v) return NaN;
    return v[2] === "%" ? (Number(v[1]) * scale) / 100 : Number(v[1]);
  };
  if (parts.length === 4 && num(parts[3], 1) !== 1) return null;
  if (m[1].startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map((t) => num(t, 255));
    return rgb.every((v) => v >= 0 && v <= 255)
      ? rgb.map((v) => Math.round(v))
      : null;
  }
  const [hue, sat, light] = [
    num(parts[0], 1),
    num(parts[1], 1),
    num(parts[2], 1),
  ];
  if (
    !Number.isFinite(hue) ||
    !/%$/.test(parts[1]) ||
    !/%$/.test(parts[2]) ||
    !(sat >= 0 && sat <= 1 && light >= 0 && light <= 1)
  )
    return null;
  return hslToRgb(hue, sat, light);
}
export const toHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
// sRGB <-> OKLab (Björn Ottosson's published matrices). Hue in degrees.
const toLinear = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const fromLinear = (x) =>
  255 *
  (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
export function rgbToOklch(r, g, b) {
  const lr = toLinear[r],
    lg = toLinear[g],
    lb = toLinear[b];
  const l = Math.cbrt(
      0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
    ),
    m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb),
    s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [
    L,
    Math.hypot(A, B),
    ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  ];
}
function oklchToLinear(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
// Out-of-gamut colours keep lightness and hue; chroma is reduced by bisection.
export function oklchToRgb(L, C, h) {
  L = clamp(L, 0, 1);
  C = Math.max(0, C);
  let rgb = oklchToLinear(L, C, h);
  if (!inGamut(rgb)) {
    let lo = 0,
      hi = C;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgb.map((v) => clamp(Math.round(fromLinear(v)), 0, 255));
}
// Chroma is normalised by this ceiling so it can share the [0, 1] remaps.
export const MAX_CHROMA = 0.4;
// Colour-model coordinates: [hue degrees, saturation or chroma 0..1, lightness 0..1].
export function toModel(rgb, model) {
  if (model === "hsl") {
    const [h, s, l] = rgbToHsl(...rgb);
    return [h, s, l];
  }
  const [L, C, h] = rgbToOklch(...rgb);
  return [h, Math.min(1, C / MAX_CHROMA), L];
}
export const fromModel = (h, s, l, model) =>
  model === "hsl" ? hslToRgb(h, s, l) : oklchToRgb(l, s * MAX_CHROMA, h);
// Slider deltas (hue degrees, saturation/chroma and lightness percent) that
// move the source colour onto the target in the chosen model.
export function deltasFor(sourceRgb, targetRgb, model) {
  const [sh, ss, sl] = toModel(sourceRgb, model),
    [th, ts, tl] = toModel(targetRgb, model);
  return { dh: hueDelta(th, sh), ds: (ts - ss) * 100, dl: (tl - sl) * 100 };
}
// Shading curve through (0,0), (a,t) and (1,1): the anchor lands exactly on
// the target and every other shade keeps its order without clipping.
export function anchorRemap(v, a, t) {
  if (v <= a) return a > 0 ? (v * t) / a : t;
  return a < 1 ? t + ((v - a) * (1 - t)) / (1 - a) : t;
}
// Saturation and chroma: lowering scales everything proportionally (so
// near-white highlights don't keep full colour); raising uses the curve.
export const saturationRemap = (v, a, t) =>
  t < a ? (v * t) / a : anchorRemap(v, a, t);
export const defaults = () => ({
  hueTol: 40,
  shadeTol: 60,
  soft: 20,
  feather: 0,
  connected: false,
  dh: 0,
  ds: 0,
  dl: 0,
  protect: true,
  model: "oklch",
  cleanEdges: true,
  ramp: null,
  mode: "shift",
  target: "#00D9FF",
});
