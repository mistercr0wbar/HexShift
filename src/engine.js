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
// How far (pixels) a shift reaches past the selection into an anti-aliased edge.
const EDGE_RINGS = 2;
// HSL lightness below which a pixel counts as an outline, as near-neutral
// pixels do.
const OUTLINE_DARK = 0.2;
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
export const MAX_ROWS = 16,
  MAX_SEEDS = 64,
  // Clicked corners, not a freehand stroke. 128 is a shape, not a scribble.
  MAX_POLYGON = 128;
// How quickly a pixel's share of overlapping rows falls with its distance
// from their samples (hue / 180 plus shade); see processEdit.
// In sampleDistance's units, 0.12 is about 5° of hue.
const OVERLAP_SPREAD = 0.12,
  OVERLAP_CUTOFF = 4 * OVERLAP_SPREAD,
  SCORE_NONE = 99;
export function validateEdit(p, seeds, overrides, w, h) {
  validateParams(p);
  validateSeeds(seeds, w, h);
  if (!(overrides instanceof Int8Array) || overrides.length !== w * h)
    throw Error("Invalid selection buffer.");
}
// A sample is a pixel ({x, y}) or, in recipes, a colour ({hex}).
export function validateSeeds(seeds, w, h) {
  if (
    !Array.isArray(seeds) ||
    seeds.length > MAX_SEEDS ||
    seeds.some((s) =>
      typeof s?.hex === "string"
        ? !/^#[\dA-F]{6}$/i.test(s.hex)
        : !Number.isInteger(s?.x) ||
          !Number.isInteger(s.y) ||
          s.x < 0 ||
          s.y < 0 ||
          s.x >= w ||
          s.y >= h,
    )
  )
    throw Error("Invalid colour samples.");
}
export function validateParams(p) {
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
}
// The colour map: up to MAX_ROWS rows of {id (1-127), params, seeds}, at most
// MAX_SEEDS samples in all. Brush labels are 0 (the rows' colour matching
// decides), -1 (kept out of every row) or a row id (forced into that row).
// A polygon, when a row has one, limits that row only. It is not a label.
export function validatePolygon(points, w, h) {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > MAX_POLYGON ||
    points.some(
      (p) =>
        !Number.isInteger(p?.x) ||
        !Number.isInteger(p?.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x >= w ||
        p.y >= h,
    )
  )
    throw Error("Invalid polygon.");
}
// Pixel centers inside `points`, including the boundary. Even-odd, so a
// self-crossing outline takes every other region. Vertices are image pixels.
export function rasterPolygon(w, h, points) {
  const mask = new Uint8Array(w * h),
    n = points.length;
  if (n < 3) return mask;
  const cx = (p) => p.x + 0.5,
    cy = (p) => p.y + 0.5,
    mark = (x, y) => {
      if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
    };
  for (let i = 0; i < n; i++) mark(points[i].x, points[i].y);
  for (let y = 0; y < h; y++) {
    const py = y + 0.5,
      xs = [];
    for (let i = 0; i < n; i++) {
      const a = points[i],
        b = points[(i + 1) % n];
      const y1 = cy(a),
        y2 = cy(b),
        x1 = cx(a),
        x2 = cx(b);
      if (y1 === y2) {
        if (y1 === py) {
          const lo = Math.min(a.x, b.x),
            hi = Math.max(a.x, b.x);
          for (let x = lo; x <= hi; x++) mark(x, y);
        }
        continue;
      }
      // A ray through the pixel center counts an edge when one end is
      // strictly above it. A shared vertex then cancels instead of
      // doubling, and the vertex itself was marked above.
      if ((y1 > py) === (y2 > py)) continue;
      xs.push(x1 + ((py - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const left = Math.ceil(xs[k] - 0.5 - 1e-8),
        right = Math.floor(xs[k + 1] - 0.5 + 1e-8);
      for (let x = Math.max(0, left); x <= Math.min(w - 1, right); x++)
        mark(x, y);
    }
  }
  return mask;
}
export function validateMap(rows, labels, active, w, h) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS)
    throw Error("Invalid colour map.");
  const ids = new Set();
  let samples = 0;
  for (const row of rows) {
    if (
      !Number.isInteger(row?.id) ||
      row.id < 1 ||
      row.id > 127 ||
      ids.has(row.id)
    )
      throw Error("Invalid colour map.");
    ids.add(row.id);
    validateParams(row.params);
    validateSeeds(row.seeds, w, h);
    if (row.polygon != null) validatePolygon(row.polygon, w, h);
    samples += row.seeds.length;
  }
  if (samples > MAX_SEEDS) throw Error("Invalid colour samples.");
  if (!Number.isInteger(active) || active < 0 || active >= rows.length)
    throw Error("Invalid colour map.");
  if (!(labels instanceof Int8Array) || labels.length !== w * h)
    throw Error("Invalid selection buffer.");
  for (let i = 0; i < labels.length; i++)
    if (labels[i] && labels[i] !== -1 && !ids.has(labels[i]))
      throw Error("Invalid brush override.");
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
// Pixel samples (i = pixel index) and colour samples (i = -1, from recipes).
function sampleSources(image, seeds) {
  const { width: w, ids, hsl, colours } = image,
    source = [];
  for (const s of seeds) {
    if (typeof s.hex === "string") {
      const rgb = parseHex(s.hex);
      source.push({ i: -1, rgb, v: Float32Array.from(rgbToHsl(...rgb)) });
      continue;
    }
    const i = s.y * w + s.x,
      c = ids[i];
    if (c >= 0)
      source.push({
        i,
        rgb: [colours[c * 3], colours[c * 3 + 1], colours[c * 3 + 2]],
        v: hsl.subarray(c * 4, c * 4 + 4),
      });
  }
  return source;
}
// How far the colour at hsl[o] is from a sample v of the same kind (both
// colours or both near-greys), whatever the tolerances. Hue decides which
// colour something is, so 45° of hue counts as much as twice the largest
// shade difference; near-greys compare by lightness.
function sampleDistance(hsl, o, v) {
  if (hsl[o + 3] < NEUTRAL) return Math.abs(hsl[o + 2] - v[2]) / 2;
  const shade = Math.max(
    Math.abs(hsl[o + 1] - v[1]),
    Math.abs(hsl[o + 2] - v[2]),
  );
  return hueDistance(hsl[o], v[0]) / 45 + shade / 2;
}
// Selection: per-colour match weight and nearest seed, then regions, brush
// overrides and feather per pixel. `nearest` is kept even for colours outside
// tolerance because feathered pixels still need a key colour. `score` is each
// colour's distance to its closest sample of the same kind (sampleDistance;
// SCORE_NONE when there is none), whatever the tolerance, so rows with
// different tolerances compare fairly.
export async function selectMask(image, p, seeds, overrides, check, polygon = null) {
  const { width: w, height: h, data, ids, hsl, colours } = image,
    n = w * h,
    colourCount = hsl.length / 4;
  if (polygon != null) validatePolygon(polygon, w, h);
  const source = sampleSources(image, seeds);
  const weight = new Float32Array(colourCount),
    score = new Float32Array(colourCount).fill(SCORE_NONE),
    nearest = new Uint8Array(colourCount);
  if (source.length)
    for (let c = 0; c < colourCount; c++) {
      if ((c & 16383) === 0) await check();
      const o = c * 4,
        achro = hsl[o + 3] < NEUTRAL;
      let best = Infinity,
        bestAny = Infinity,
        distance = SCORE_NONE,
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
        distance = Math.min(distance, sampleDistance(hsl, o, v));
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
      score[c] = distance;
      if (best <= 1)
        weight[c] = p.soft ? Math.min(1, (1 - best) / (p.soft / 100)) : 1;
    }
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (ids[i] >= 0) mask[i] = weight[ids[i]];
  }
  // The polygon limits this row's colour match. Pixels outside it stay
  // available to other rows, because this never writes a brush label.
  // Add and subtract run afterwards, so they can still correct the result.
  if (polygon) {
    const inside = rasterPolygon(w, h, polygon);
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      if (!inside[i]) mask[i] = 0;
    }
  }
  if (p.connected && source.length) {
    const keep = new Uint8Array(n),
      queue = new Int32Array(n);
    let head = 0,
      tail = 0;
    for (const { i } of source)
      if (i >= 0 && mask[i] > 0 && !keep[i]) {
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
  return { mask, weight, score, nearest, source, count, opaque };
}
// Chessboard distance to the nearest pixel where `start(i)` holds: 1 on those
// pixels, 2..EDGE_RINGS + 1 within EDGE_RINGS of one, 0 further away.
async function rings(w, h, start, check) {
  const n = w * h,
    d = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (start(i)) d[i] = 1;
  }
  for (let ring = 2; ring <= EDGE_RINGS + 1; ring++)
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      if (d[i]) continue;
      const x = i % w,
        y = (i - x) / w;
      for (let dy = -1; dy <= 1 && !d[i]; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && d[j] && d[j] < ring) {
            d[i] = ring;
            break;
          }
        }
    }
  return d;
}
// The anchor is the last usable seed's colour; a brush-only selection uses the
// mask-weighted mean colour instead.
function anchorColour(image, sel) {
  const { data } = image;
  if (sel.source.length) return sel.source.at(-1).rgb;
  const sum = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < sel.mask.length; i++)
    if (sel.mask[i] > 0) {
      for (let k = 0; k < 3; k++) sum[k] += data[i * 4 + k] * sel.mask[i];
      total += sel.mask[i];
    }
  return total ? sum.map((v) => Math.round(v / total)) : null;
}
// Shift: every shade takes the target hue (anchor + dh), so a red-to-pink
// heart becomes one blue rather than violet-to-azure; shading lives in
// saturation and lightness. With shading protection the anchor's saturation
// and lightness land exactly on anchor + delta and other shades follow the
// remap curves; without it, deltas are added (and may clip). A neutral anchor
// has no meaningful saturation to keep, so it is set rather than shifted.
function shifter(p, anchorRgb) {
  const [ah, as, al] = toModel(anchorRgb, p.model),
    neutral = rgbToHsl(...anchorRgb)[3] < NEUTRAL,
    rawS = as + p.ds / 100,
    rawL = al + p.dl / 100,
    ts = clamp(rawS, 0, 1),
    tl = clamp(rawL, 0, 1),
    th = ah + p.dh;
  const shift = (rgb) => {
    const [, s, l] = toModel(rgb, p.model);
    return fromModel(
      th,
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
const checker = (yieldFn, cancelled) => async () => {
  await yieldFn();
  if (cancelled()) throw Error("Cancelled");
};
// One edit: a selection and its treatment.
export async function processImage(
  image,
  p,
  seeds,
  overrides,
  yieldFn = async () => {},
  cancelled = () => false,
  polygon = null,
) {
  validateEdit(p, seeds, overrides, image.width, image.height);
  if (polygon != null) validatePolygon(polygon, image.width, image.height);
  const { pixels, mask, count, opaque, changed, capped } = await editRow(
    image,
    p,
    seeds,
    overrides,
    checker(yieldFn, cancelled),
    polygon,
  );
  return { pixels, mask, count, opaque, changed, capped };
}
// The colour map: every row is matched against the same pixels, so swapping
// red and blue does not turn both red. Where rows overlap, the pixel goes to
// the row whose sample is nearest, and rows almost as near (within
// OVERLAP_CUTOFF) are mixed in by selection weight times
// exp(-extra distance / OVERLAP_SPREAD): a pixel clearly nearer one sample
// takes that row's result, and only pixels about equally near two (the middle
// of a gradient from one colour into another) get a blend, so the change
// between two recoloured parts stays smooth. Distance is sampleDistance,
// whatever the tolerances, so a row with a wide tolerance does not win by
// default. Returns the
// active row's selection mask and count, which row has the largest share of
// each pixel, and every row's count. One row with id 1 gives the same result
// as processImage with the same brush.
export async function processEdit(
  image,
  rows,
  labels,
  active,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  const { width: w, height: h, data, ids } = image,
    n = w * h;
  validateMap(rows, labels, active, w, h);
  const check = checker(yieldFn, cancelled),
    pixels = new Uint8ClampedArray(data),
    // Rows that share a pixel: the sum of their results, each weighted by
    // its selection weight times exp(-(distance - nearest) / OVERLAP_SPREAD),
    // `nearest` being the distance of the nearest row so far.
    mixed = new Float32Array(4 * n),
    total = new Float32Array(n),
    nearest = new Float32Array(n),
    top = new Float32Array(n),
    shared = new Uint8Array(n),
    owner = new Int8Array(n).fill(-1),
    rowLabels = new Int8Array(n),
    counts = [];
  let shown = null;
  for (const [k, row] of rows.entries()) {
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      rowLabels[i] = labels[i] === row.id ? 1 : labels[i] ? -1 : 0;
    }
    const r = await editRow(
      image,
      row.params,
      row.seeds,
      rowLabels,
      check,
      row.polygon ?? null,
    );
    counts.push(r.count);
    if (k === active) shown = r;
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      const weight = r.weight[i];
      if (!(weight > 0)) continue;
      // A pixel brushed into this row counts as a perfect match (no other
      // row can take it).
      const distance = labels[i] === row.id || ids[i] < 0 ? 0 : r.score[ids[i]],
        o = i * 4;
      if (shared[i] && distance > nearest[i] + OVERLAP_CUTOFF) continue;
      // The first row to take a pixel, or one much nearer than those before
      // it, starts afresh and is copied exactly.
      if (!shared[i] || distance < nearest[i] - OVERLAP_CUTOFF) {
        pixels.set(r.pixels.subarray(o, o + 4), o);
        nearest[i] = distance;
        shared[i] = 1;
        for (let c = 0; c < 4; c++) mixed[o + c] = weight * r.pixels[o + c];
        total[i] = top[i] = weight;
        owner[i] = k;
        continue;
      }
      const share =
        weight * Math.exp(-(distance - nearest[i]) / OVERLAP_SPREAD);
      shared[i]++;
      for (let c = 0; c < 4; c++) mixed[o + c] += share * r.pixels[o + c];
      total[i] += share;
      if (share > top[i]) {
        top[i] = share;
        owner[i] = k;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    if (shared[i] > 1 && total[i] > 0)
      for (let c = 0; c < 4; c++)
        pixels[i * 4 + c] = mixed[i * 4 + c] / total[i];
  }
  if (rows.length > 1) await reblend(image, rows, owner, pixels, check);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    const o = i * 4;
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
    mask: shown.mask,
    owner,
    counts,
    count: shown.count,
    opaque: shown.opaque,
    changed,
    capped: shown.capped,
  };
}
// Edges between two rows: an anti-aliased pixel between, say, a red fill and
// a black outline is a mix of both, so once both rows change, recolouring it
// with either one alone leaves a seam (dark blue between a blue fill and a
// white outline). Within BLEND_REACH pixels of another row, a pixel is
// matched to a mix of the purest colours of the two sides nearby and, when it
// lies on the line between them and has a purer neighbour on its own side (so
// it is an edge, not a flat patch of an in-between colour), remade as the
// same mix of the two sides' new colours. Rows that make pixels transparent
// are left as they are.
const BLEND_REACH = 2,
  BLEND_WINDOW = 3;
async function reblend(image, rows, owner, out, check) {
  const { width: w, height: h, data } = image,
    opaque = rows.map((r) => r.params.mode !== "transparent"),
    fixes = [];
  const colour = (j, k) => data[j * 4 + k];
  for (let y = 0; y < h; y++) {
    if ((y & 15) === 0) await check();
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        a = owner[i];
      if (a < 0 || !opaque[a]) continue;
      // Another row within reach?
      let b = -1;
      for (let dy = -BLEND_REACH; dy <= BLEND_REACH && b < 0; dy++)
        for (let dx = -BLEND_REACH; dx <= BLEND_REACH; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const o = owner[yy * w + xx];
          if (o >= 0 && o !== a && opaque[o]) {
            b = o;
            break;
          }
        }
      if (b < 0) continue;
      // The other side's purest colour is the one furthest from this pixel;
      // this side's is the purest (furthest from that) of the colours that
      // explain the pixel as a mix of the two, with little left over off the
      // line between them.
      const side = [[], []];
      for (let dy = -BLEND_WINDOW; dy <= BLEND_WINDOW; dy++)
        for (let dx = -BLEND_WINDOW; dx <= BLEND_WINDOW; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!data[j * 4 + 3]) continue;
          if (owner[j] === a) side[0].push(j);
          else if (owner[j] === b) side[1].push(j);
        }
      let g = -1,
        gD = -1;
      for (const j of side[1]) {
        let d = 0;
        for (let k = 0; k < 3; k++) d += (colour(j, k) - colour(i, k)) ** 2;
        if (d > gD) {
          gD = d;
          g = j;
        }
      }
      let f = -1,
        t = 0,
        length2 = 0;
      for (const j of side[0]) {
        const span = [0, 1, 2].map((k) => colour(j, k) - colour(g, k)),
          l2 = span[0] ** 2 + span[1] ** 2 + span[2] ** 2;
        // Sides too alike to tell apart: nothing to re-mix.
        if (l2 < 3 * 32 ** 2) continue;
        let tj = 0;
        for (let k = 0; k < 3; k++)
          tj += (colour(i, k) - colour(g, k)) * span[k];
        tj /= l2;
        // Some of each: not this pixel's own colour, not the other side's.
        if (tj > 0.97 || tj < 0.03) continue;
        let off = 0;
        for (let k = 0; k < 3; k++)
          off += (colour(i, k) - (colour(g, k) + tj * span[k])) ** 2;
        if (off <= 0.04 * l2 && l2 > length2) {
          f = j;
          t = tj;
          length2 = l2;
        }
      }
      // Only a real mix of the two, on the line between them...
      if (f < 0) continue;
      const fRgb = [0, 1, 2].map((k) => colour(f, k));
      // ...and an edge, not a flat patch of an in-between colour: a blend
      // has a purer neighbour on its own side.
      const toF = (j) => {
        let d = 0;
        for (let k = 0; k < 3; k++) d += (colour(j, k) - fRgb[k]) ** 2;
        return d;
      };
      let purer = false;
      for (let dy = -1; dy <= 1 && !purer; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (
            xx >= 0 &&
            yy >= 0 &&
            xx < w &&
            yy < h &&
            owner[j] === a &&
            data[j * 4 + 3] &&
            toF(j) < toF(i) - 0.01 * length2
          ) {
            purer = true;
            break;
          }
        }
      if (!purer) continue;
      // The same mix of the two sides' new colours. When neither side
      // changes, the pixel is left exactly as it was.
      let same = true;
      for (let k = 0; k < 3; k++)
        same &&=
          out[f * 4 + k] === colour(f, k) && out[g * 4 + k] === colour(g, k);
      if (same) continue;
      fixes.push(
        i,
        ...[0, 1, 2].map((k) => out[f * 4 + k] * t + out[g * 4 + k] * (1 - t)),
      );
    }
  }
  for (let q = 0; q < fixes.length; q += 4)
    for (let k = 0; k < 3; k++) out[fixes[q] * 4 + k] = fixes[q + 1 + k];
}
// One row's selection and treatment. Besides the edited pixels it returns
// the weight each pixel was blended with and each colour's match score, which
// processEdit uses to settle overlaps.
async function editRow(image, p, seeds, overrides, check, polygon = null) {
  const { width: w, height: h, data, ids, colours } = image,
    n = w * h;
  const sel = await selectMask(image, p, seeds, overrides, check, polygon),
    { mask } = sel;
  const pixels = new Uint8ClampedArray(data),
    effective = new Float32Array(n),
    target = parseHex(p.target),
    anchor = p.mode === "shift" && sel.count ? anchorColour(image, sel) : null,
    unmixing = p.mode === "transparent" && p.cleanEdges && sel.source.length,
    cache = new Map();
  let shift,
    capped = false;
  // A shift that asks for no change (the target is the sample's own colour)
  // changes nothing, so a row can claim its colours without recolouring them.
  if (anchor && !p.ramp?.length && !p.dh && !p.ds && !p.dl)
    shift = (rgb) => rgb;
  else if (anchor) {
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
        out = unmix(rgb, sel.source[seed].rgb);
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
      // Pixels whose colour matched but were excluded (a polygon, connected
      // regions, the subtract brush) stay as they are.
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
  // A shift has the same problem along an outline: the blend from a bright
  // fill into a dark outline is darker and greyer than the fill, so shade
  // tolerance leaves it out or only partly in, and a rim of the old colour
  // remains. Such a pixel is the same colour in another shade (its hue is
  // within tolerance; its shade is what keeps it out), which the shading
  // curves already handle, so it shifts fully when it lies within EDGE_RINGS
  // pixels of both the selection and an outline (a near-neutral or dark
  // pixel). Edges into transparency blend through alpha, not colour, and fades
  // into other colours inside the artwork keep the soft blend, as does
  // feathering.
  const full = new Uint8Array(
    anchor && p.mode === "shift" && sel.source.length && !p.feather ? n : 0,
  );
  if (full.length) {
    const { hsl } = image,
      shadeBound = new Uint8Array(hsl.length / 4),
      toSelection = await rings(w, h, (i) => mask[i] > 0, check),
      toOutline = await rings(
        w,
        h,
        (i) =>
          ids[i] >= 0 &&
          (hsl[ids[i] * 4 + 3] < NEUTRAL || hsl[ids[i] * 4 + 2] < OUTLINE_DARK),
        check,
      );
    for (let c = 0; c < shadeBound.length; c++) {
      if ((c & 16383) === 0) await check();
      const o = c * 4,
        v = sel.source[sel.nearest[c]].v;
      if (hsl[o + 3] < NEUTRAL || v[3] < NEUTRAL) continue;
      const hd = hueDistance(hsl[o], v[0]),
        shade = Math.max(
          Math.abs(hsl[o + 1] - v[1]),
          Math.abs(hsl[o + 2] - v[2]),
        ),
        byHue = p.hueTol ? hd / p.hueTol : hd < 0.5 ? 0 : Infinity,
        byShade = p.shadeTol
          ? shade / (p.shadeTol / 100)
          : shade < 0.004
            ? 0
            : Infinity;
      shadeBound[c] = byHue <= 1 && byShade >= byHue ? 1 : 0;
    }
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 0) await check();
      const c = ids[i];
      // Pixels whose colour matched but were excluded (a polygon, connected
      // regions, the subtract brush) stay as they are.
      if (
        c >= 0 &&
        mask[i] < 1 &&
        overrides[i] >= 0 &&
        !(mask[i] <= 0 && sel.weight[c] > 0) &&
        shadeBound[c] &&
        toSelection[i] &&
        toOutline[i]
      )
        full[i] = 1;
    }
  }
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 16383) === 0) await check();
    const edge = unmixing && band[i] >= 0,
      weight = edge || full[i] ? 1 : mask[i];
    if (weight <= 0) continue;
    effective[i] = weight;
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
    weight: effective,
    score: sel.score,
    count: sel.count,
    opaque: sel.opaque,
    changed,
    capped: p.mode === "shift" && capped,
  };
}
// "Map all colours": the image's colour families, heaviest first. Hues are
// binned 10° apart; each family starts at the heaviest bin left and takes the
// bins within 30° of it. Each family's sample is the pixel of its most common
// colourful colour. Near-greys form one family of their own; families under 2% of the
// image are left out.
export function colourFamilies(image, max = 8) {
  const { width: w, data, ids, hsl } = image,
    count = hsl.length / 4,
    weight = new Float64Array(count),
    first = new Int32Array(count).fill(-1);
  let total = 0;
  for (let i = 0; i < ids.length; i++) {
    const c = ids[i];
    if (c < 0) continue;
    weight[c] += data[i * 4 + 3] / 255;
    total += data[i * 4 + 3] / 255;
    if (first[c] < 0) first[c] = i;
  }
  const bins = new Float64Array(36),
    taken = new Uint8Array(36),
    centres = [];
  let grey = 0;
  for (let c = 0; c < count; c++)
    if (hsl[c * 4 + 3] < NEUTRAL) grey += weight[c];
    else bins[Math.floor(hsl[c * 4] / 10) % 36] += weight[c];
  while (centres.length < max - (grey >= total * 0.02 ? 1 : 0)) {
    let b = -1;
    for (let k = 0; k < 36; k++)
      if (!taken[k] && (b < 0 || bins[k] > bins[b])) b = k;
    if (b < 0 || bins[b] < total * 0.02) break;
    for (let d = -3; d <= 3; d++) taken[(b + d + 36) % 36] = 1;
    centres.push(b * 10 + 5);
  }
  // Each colour joins the family with the nearest centre (greys their own).
  const best = centres.map(() => -1),
    sums = centres.map(() => 0);
  let greyBest = -1;
  for (let c = 0; c < count; c++) {
    if (!weight[c]) continue;
    if (hsl[c * 4 + 3] < NEUTRAL) {
      if (greyBest < 0 || weight[c] > weight[greyBest]) greyBest = c;
      continue;
    }
    let f = -1;
    for (let k = 0; k < centres.length; k++)
      if (
        hueDistance(hsl[c * 4], centres[k]) <= 35 &&
        (f < 0 ||
          hueDistance(hsl[c * 4], centres[k]) <
            hueDistance(hsl[c * 4], centres[f]))
      )
        f = k;
    if (f < 0) continue;
    sums[f] += weight[c];
    // The most common colour, favouring colourful ones over pale highlights.
    if (
      best[f] < 0 ||
      weight[c] * hsl[c * 4 + 3] > weight[best[f]] * hsl[best[f] * 4 + 3]
    )
      best[f] = c;
  }
  const families = centres
    .map((_, k) => ({ c: best[k], weight: sums[k], grey: false }))
    .filter((f) => f.c >= 0);
  if (greyBest >= 0 && grey >= total * 0.02)
    families.push({ c: greyBest, weight: grey, grey: true });
  return families
    .sort((a, b) => b.weight - a.weight)
    .map(({ c, weight, grey }) => ({
      x: first[c] % w,
      y: Math.floor(first[c] / w),
      hex: toHex(...image.colours.subarray(c * 3, c * 3 + 3)),
      share: weight / total,
      grey,
    }));
}
