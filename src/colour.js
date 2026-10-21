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
export const toHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
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
  mode: "shift",
  target: "#00D9FF",
});
