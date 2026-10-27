import {
  clamp,
  hueDistance,
  rgbToHsl,
  parseHex,
  toHex,
  toModel,
  fromModel,
  anchorRemap,
  saturationRemap,
} from "./colour.js";
import { mainDeltas, rampSamples, rampShift } from "./tones.js";
export const MAX_PIXELS = 4194304;
// Pixels whose HSL chroma is below this are treated as neutral (grey).
const NEUTRAL = 0.06;
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
    !["oklch", "hsl"].includes(p.model) ||
    !parseHex(p.target) ||
    typeof p.protect !== "boolean" ||
    typeof p.connected !== "boolean" ||
    typeof p.cleanEdges !== "boolean"
  )
    throw Error("Invalid colour operation.");
  if (
    p.ramp != null &&
    (!Array.isArray(p.ramp) ||
      p.ramp.length < 1 ||
      p.ramp.length > 8 ||
      p.ramp.some((v) => typeof v !== "string" || !parseHex(v)))
  )
    throw Error("Invalid colour ramp.");
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
// Matching and colour transforms run once per unique colour (`ids` maps pixels
// to the colour table); only spatial steps (regions, brush, feather) are per pixel.
export async function prepare(
  width,
  height,
  data,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  validateImage(width, height, data);
  const n = width * height,
    ids = new Int32Array(n),
    rgb = [],
    bins = new Map();
  // Stores id + 1 so a zero-filled table means "unseen".
  const big = n > 1 << 20,
    table = big ? new Int32Array(1 << 24) : new Map();
  let count = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) {
      await yieldFn();
      if (cancelled()) throw Error("Cancelled");
    }
    const o = i * 4;
    if (!data[o + 3]) {
      ids[i] = -1;
      continue;
    }
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    let id = (big ? table[key] : table.get(key)) || 0;
    if (!id) {
      id = ++count;
      if (big) table[key] = id;
      else table.set(key, id);
      rgb.push(data[o], data[o + 1], data[o + 2]);
    }
    ids[i] = id - 1;
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
  const colours = Uint8Array.from(rgb),
    hsl = new Float32Array(count * 4);
  for (let c = 0; c < count; c++) {
    if ((c & 16383) === 0) {
      await yieldFn();
      if (cancelled()) throw Error("Cancelled");
    }
    hsl.set(
      rgbToHsl(colours[c * 3], colours[c * 3 + 1], colours[c * 3 + 2]),
      c * 4,
    );
  }
  return {
    width,
    height,
    data,
    ids,
    colours,
    hsl,
    palette: [...bins.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12),
  };
}
// Selection: per-colour match weight and nearest seed, then regions, brush
// overrides and feather per pixel. `nearest` is kept even for colours outside
// tolerance because feathered pixels still need a key colour.
export async function selectMask(image, p, seeds, overrides, check) {
  const { width: w, height: h, data, ids, hsl } = image,
    n = w * h,
    colourCount = hsl.length / 4;
  const source = seeds
    .map((s) => ({ i: s.y * w + s.x }))
    .filter((s) => ids[s.i] >= 0)
    .map((s) => ({
      ...s,
      c: ids[s.i],
      v: hsl.subarray(ids[s.i] * 4, ids[s.i] * 4 + 4),
    }));
  const weight = new Float32Array(colourCount),
    nearest = new Uint8Array(colourCount);
  if (source.length)
    for (let c = 0; c < colourCount; c++) {
      if ((c & 16383) === 0) await check();
      const o = c * 4,
        achro = hsl[o + 3] < NEUTRAL;
      let best = Infinity,
        bestAny = Infinity,
        match = -1,
        closest = 0;
      for (let k = 0; k < source.length; k++) {
        const v = source[k].v,
          shade = achro
            ? Math.abs(hsl[o + 2] - v[2])
            : Math.max(
                Math.abs(hsl[o + 1] - v[1]),
                Math.abs(hsl[o + 2] - v[2]),
              ),
          any = hueDistance(hsl[o], v[0]) / 180 + shade;
        if (any < bestAny) {
          bestAny = any;
          closest = k;
        }
        if (achro !== v[3] < NEUTRAL) continue;
        const hd = hueDistance(hsl[o], v[0]);
        const d = Math.max(
          achro ? 0 : p.hueTol ? hd / p.hueTol : hd < 0.5 ? 0 : Infinity,
          p.shadeTol
            ? shade / (p.shadeTol / 100)
            : shade < 0.004
              ? 0
              : Infinity,
        );
        if (d < best) {
          best = d;
          match = k;
        }
      }
      nearest[c] = match >= 0 ? match : closest;
      if (best <= 1)
        weight[c] = p.soft ? Math.min(1, (1 - best) / (p.soft / 100)) : 1;
    }
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (ids[i] >= 0) mask[i] = weight[ids[i]];
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
  let count = 0,
    opaque = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (data[i * 4 + 3]) opaque++;
    if (mask[i] > 0) count++;
  }
  return { mask, weight, nearest, source, count, opaque };
}
// The anchor is the last usable seed's colour; a brush-only selection uses the
// mask-weighted mean colour instead.
function anchorColour(image, sel) {
  const { colours, data } = image;
  if (sel.source.length) {
    const c = sel.source.at(-1).c;
    return [colours[c * 3], colours[c * 3 + 1], colours[c * 3 + 2]];
  }
  const sum = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < sel.mask.length; i++)
    if (sel.mask[i] > 0) {
      for (let k = 0; k < 3; k++) sum[k] += data[i * 4 + k] * sel.mask[i];
      total += sel.mask[i];
    }
  return total ? sum.map((v) => Math.round(v / total)) : null;
}
// Shift: hue rotates by dh. With shading protection the anchor's saturation
// and lightness land exactly on anchor + delta and other shades follow the
// remap curves; without it, deltas are added (and may clip). A neutral anchor
// has no meaningful hue, so hue and saturation are set rather than shifted.
function shifter(p, anchorRgb) {
  const [ah, as, al] = toModel(anchorRgb, p.model),
    neutral = rgbToHsl(...anchorRgb)[3] < NEUTRAL,
    rawS = as + p.ds / 100,
    rawL = al + p.dl / 100,
    ts = clamp(rawS, 0, 1),
    tl = clamp(rawL, 0, 1),
    th = ah + p.dh;
  const shift = (rgb) => {
    const [h, s, l] = toModel(rgb, p.model);
    return fromModel(
      neutral ? th : h + p.dh,
      neutral
        ? ts
        : p.protect
          ? saturationRemap(s, as, ts)
          : clamp(s + p.ds / 100, 0, 1),
      p.protect ? anchorRemap(l, al, tl) : clamp(l + p.dl / 100, 0, 1),
      p.model,
    );
  };
  return { shift, capped: rawS !== ts || rawL !== tl };
}
// Colour-to-alpha: the least opacity at which the pixel is the key colour
// with a foreground colour on top, and that foreground colour. Channels are
// 0..255; returns [r, g, b, alphaFactor].
export function unmix(rgb, key) {
  let a = 0;
  for (let k = 0; k < 3; k++) {
    const p = rgb[k] / 255,
      c = key[k] / 255;
    if (p > c) a = Math.max(a, (p - c) / (1 - c));
    else if (p < c) a = Math.max(a, (c - p) / c);
  }
  a = Math.round(a * 255) / 255;
  if (!a) return [0, 0, 0, 0];
  return [
    ...[0, 1, 2].map((k) =>
      clamp(Math.round((rgb[k] - (1 - a) * key[k]) / a), 0, 255),
    ),
    a,
  ];
}
export async function processImage(
  image,
  p,
  seeds,
  overrides,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  const { width: w, height: h, data, ids, colours } = image,
    n = w * h;
  validateEdit(p, seeds, overrides, w, h);
  const check = async () => {
    await yieldFn();
    if (cancelled()) throw Error("Cancelled");
  };
  const sel = await selectMask(image, p, seeds, overrides, check),
    { mask } = sel;
  const pixels = new Uint8ClampedArray(data),
    target = parseHex(p.target),
    anchor = p.mode === "shift" && sel.count ? anchorColour(image, sel) : null,
    unmixing = p.mode === "transparent" && p.cleanEdges && sel.source.length,
    cache = new Map();
  let shift,
    capped = false;
  if (anchor) {
    // A ramp (skin tones) maps the selection's shades onto its colours; with
    // one shade, or one colour, it is the single-target shift onto its main colour.
    let ramped = null;
    if (p.ramp?.length > 1) {
      const weights = new Float64Array(colours.length / 3);
      for (let i = 0; i < n; i++) {
        if ((i & 16383) === 0) await check();
        if (mask[i] > 0 && ids[i] >= 0) weights[ids[i]] += mask[i];
      }
      ramped = rampShift(p, rampSamples(colours, weights, p.model));
    }
    if (ramped) shift = ramped;
    else
      ({ shift, capped } = shifter(
        p.ramp?.length ? { ...p, ...mainDeltas(p, anchor) } : p,
        anchor,
      ));
  }
  // `seed` picks the unmix key; by default the colour's own nearest seed.
  const transform = (c, seed = sel.nearest[c]) => {
    const id = c * 64 + seed;
    let out = cache.get(id);
    if (!out) {
      const rgb = [colours[c * 3], colours[c * 3 + 1], colours[c * 3 + 2]];
      if (p.mode === "flat") out = target;
      else if (unmixing) {
        const key = sel.source[seed].c;
        out = unmix(rgb, [
          colours[key * 3],
          colours[key * 3 + 1],
          colours[key * 3 + 2],
        ]);
      } else out = shift(rgb);
      cache.set(id, out);
    }
    return out;
  };
  // Anti-aliased edge pixels are blends of the artwork and the removed colour,
  // so they rarely match it (a pink edge never matches a white sample). Clean
  // edges also unmixes the one-pixel band around the removed area.
  const band = new Int8Array(unmixing ? n : 0).fill(-1);
  if (unmixing)
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      // Pixels whose colour matched but were excluded (connected regions,
      // subtract brush) stay as they are.
      if (
        mask[i] > 0 ||
        ids[i] < 0 ||
        overrides[i] < 0 ||
        sel.weight[ids[i]] > 0
      )
        continue;
      const x = i % w,
        y = (i - x) / w;
      for (let dy = -1; dy <= 1 && band[i] < 0; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (
            xx >= 0 &&
            xx < w &&
            yy >= 0 &&
            yy < h &&
            mask[j] > 0 &&
            ids[j] >= 0
          ) {
            band[i] = sel.nearest[ids[j]];
            break;
          }
        }
    }
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    const edge = unmixing && band[i] >= 0,
      weight = edge ? 1 : mask[i];
    if (weight <= 0) continue;
    const o = i * 4;
    if (p.mode === "transparent") {
      // Brush-forced pixels are removed outright; matched ones are unmixed.
      const out =
        !unmixing || overrides[i] > 0
          ? null
          : edge
            ? transform(ids[i], band[i])
            : transform(ids[i]);
      if (out) {
        // Blend premultiplied: a partly removed key colour keeps its colour
        // at lower opacity instead of mixing towards the unmixed black.
        const alpha = 1 - weight * (1 - out[3]);
        if (alpha > 0)
          for (let c = 0; c < 3; c++)
            pixels[o + c] =
              (data[o + c] * (1 - weight) + out[c] * out[3] * weight) / alpha;
        pixels[o + 3] = Math.round(data[o + 3] * alpha);
      } else pixels[o + 3] = Math.round(data[o + 3] * (1 - weight));
      if (!pixels[o + 3]) pixels.fill(0, o, o + 4);
    } else {
      const rgb = transform(ids[i]);
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
    count: sel.count,
    opaque: sel.opaque,
    changed,
    capped: p.mode === "shift" && capped,
  };
}
