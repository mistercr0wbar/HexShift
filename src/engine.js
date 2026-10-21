import {
  clamp,
  hueDistance,
  hslToRgb,
  rgbToHsl,
  parseHex,
  toHex,
} from "./colour.js";
export const MAX_PIXELS = 4194304;
export function validateImage(w, h, data) {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 8192 ||
    h > 8192 ||
    w * h > MAX_PIXELS ||
    !(data instanceof Uint8ClampedArray) ||
    data.length !== w * h * 4
  )
    throw Error("Invalid image dimensions or pixel buffer.");
}
export function validateEdit(p, seeds, overrides, w, h) {
  const ranges = {
    hueTol: [0, 180],
    shadeTol: [0, 100],
    soft: [0, 100],
    feather: [0, 8],
    dh: [-180, 180],
    ds: [-100, 100],
    dl: [-100, 100],
  };
  for (const [key, [lo, hi]] of Object.entries(ranges))
    if (!Number.isFinite(p[key]) || p[key] < lo || p[key] > hi)
      throw Error("Invalid processing parameter: " + key);
  if (
    !["shift", "flat", "transparent"].includes(p.mode) ||
    !parseHex(p.target) ||
    typeof p.protect !== "boolean" ||
    typeof p.connected !== "boolean"
  )
    throw Error("Invalid colour operation.");
  if (
    !Array.isArray(seeds) ||
    seeds.length > 64 ||
    seeds.some(
      (s) =>
        !Number.isInteger(s.x) ||
        !Number.isInteger(s.y) ||
        s.x < 0 ||
        s.y < 0 ||
        s.x >= w ||
        s.y >= h,
    )
  )
    throw Error("Invalid colour samples.");
  if (!(overrides instanceof Int8Array) || overrides.length !== w * h)
    throw Error("Invalid selection buffer.");
}
// Every long pass yields. The same engine runs in a worker or a cancellable UI fallback.
export async function prepare(
  width,
  height,
  data,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  validateImage(width, height, data);
  const n = width * height,
    hsl = new Float32Array(n * 4),
    bins = new Map();
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) {
      await yieldFn();
      if (cancelled()) throw Error("Cancelled");
    }
    const o = i * 4;
    if (!data[o + 3]) continue;
    hsl.set(rgbToHsl(data[o], data[o + 1], data[o + 2]), o);
    const k =
      (data[o] >> 4) * 256 + (data[o + 1] >> 4) * 16 + (data[o + 2] >> 4);
    const bin = bins.get(k);
    if (bin) bin.weight += data[o + 3];
    else
      bins.set(k, {
        weight: data[o + 3],
        x: i % width,
        y: Math.floor(i / width),
        hex: toHex(...data.subarray(o, o + 3)),
      });
  }
  return {
    width,
    height,
    data,
    hsl,
    palette: [...bins.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12),
  };
}
export async function processImage(
  image,
  p,
  seeds,
  overrides,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  const { width: w, height: h, data, hsl } = image,
    n = w * h;
  validateEdit(p, seeds, overrides, w, h);
  const check = async () => {
    await yieldFn();
    if (cancelled()) throw Error("Cancelled");
  };
  const mask = new Float32Array(n),
    source = seeds.map((s) => {
      const i = s.y * w + s.x;
      return { i, v: hsl.subarray(i * 4, i * 4 + 4) };
    });
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (!data[i * 4 + 3]) continue;
    const o = i * 4,
      achro = hsl[o + 3] < 0.06;
    let best = Infinity;
    for (const { v } of source) {
      if (achro !== v[3] < 0.06) continue;
      const hd = hueDistance(hsl[o], v[0]),
        shade = achro
          ? Math.abs(hsl[o + 2] - v[2])
          : Math.max(Math.abs(hsl[o + 1] - v[1]), Math.abs(hsl[o + 2] - v[2]));
      const d = Math.max(
        achro ? 0 : p.hueTol ? hd / p.hueTol : hd < 0.5 ? 0 : Infinity,
        p.shadeTol ? shade / (p.shadeTol / 100) : shade < 0.004 ? 0 : Infinity,
      );
      best = Math.min(best, d);
    }
    if (best <= 1)
      mask[i] = p.soft ? Math.min(1, (1 - best) / (p.soft / 100)) : 1;
  }
  if (p.connected && source.length) {
    const keep = new Uint8Array(n),
      queue = new Int32Array(n);
    let head = 0,
      tail = 0;
    for (const { i } of source)
      if (mask[i] > 0 && !keep[i]) {
        keep[i] = 1;
        queue[tail++] = i;
      }
    while (head < tail) {
      if ((head & 16383) === 0) await check();
      const i = queue[head++],
        x = i % w,
        y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (
            xx >= 0 &&
            xx < w &&
            yy >= 0 &&
            yy < h &&
            !keep[j] &&
            mask[j] > 0
          ) {
            keep[j] = 1;
            queue[tail++] = j;
          }
        }
    }
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      if (!keep[i]) mask[i] = 0;
    }
  }
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (overrides[i] !== 0 && overrides[i] !== 1 && overrides[i] !== -1)
      throw Error("Invalid brush override.");
    if (overrides[i]) mask[i] = data[i * 4 + 3] && overrides[i] > 0 ? 1 : 0;
  }
  const radius = Math.round(p.feather);
  if (radius) {
    const tmp = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      if ((y & 15) === 0) await check();
      let sum = 0;
      for (let x = -radius; x <= radius; x++)
        sum += mask[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (radius * 2 + 1);
        sum +=
          mask[y * w + clamp(x + radius + 1, 0, w - 1)] -
          mask[y * w + clamp(x - radius, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      if ((x & 15) === 0) await check();
      let sum = 0;
      for (let y = -radius; y <= radius; y++)
        sum += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        mask[y * w + x] = data[(y * w + x) * 4 + 3]
          ? sum / (radius * 2 + 1)
          : 0;
        sum +=
          tmp[clamp(y + radius + 1, 0, h - 1) * w + x] -
          tmp[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
  }
  let minL = 1,
    maxL = 0,
    minS = 1,
    maxS = 0,
    count = 0,
    opaque = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (data[i * 4 + 3]) opaque++;
    if (mask[i] > 0) {
      count++;
      minS = Math.min(minS, hsl[i * 4 + 1]);
      maxS = Math.max(maxS, hsl[i * 4 + 1]);
      minL = Math.min(minL, hsl[i * 4 + 2]);
      maxL = Math.max(maxL, hsl[i * 4 + 2]);
    }
  }
  const ds =
      p.protect && count ? clamp(p.ds / 100, -minS, 1 - maxS) : p.ds / 100,
    dl = p.protect && count ? clamp(p.dl / 100, -minL, 1 - maxL) : p.dl / 100;
  const pixels = new Uint8ClampedArray(data),
    target = parseHex(p.target);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    const weight = mask[i];
    if (weight <= 0) continue;
    const o = i * 4;
    if (p.mode === "transparent") {
      pixels[o + 3] = Math.round(data[o + 3] * (1 - weight));
      if (!pixels[o + 3]) pixels.fill(0, o, o + 4);
    } else {
      const rgb =
        p.mode === "flat"
          ? target
          : hslToRgb(hsl[o] + p.dh, hsl[o + 1] + ds, hsl[o + 2] + dl);
      for (let c = 0; c < 3; c++)
        pixels[o + c] = data[o + c] + (rgb[c] - data[o + c]) * weight;
    }
    if (
      pixels[o] !== data[o] ||
      pixels[o + 1] !== data[o + 1] ||
      pixels[o + 2] !== data[o + 2] ||
      pixels[o + 3] !== data[o + 3]
    )
      changed++;
  }
  return {
    pixels,
    mask,
    count,
    opaque,
    changed,
    capped:
      Math.abs(ds - p.ds / 100) > 1e-6 || Math.abs(dl - p.dl / 100) > 1e-6,
  };
}
