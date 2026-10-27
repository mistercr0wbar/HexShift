import {
  clamp,
  deltasFor,
  fromModel,
  hueDelta,
  parseHex,
  rgbToHsl,
  toModel,
} from "./colour.js";
// Pixels whose HSL chroma is below this are treated as neutral (as in engine.js).
const NEUTRAL = 0.06;
// Fritsch–Carlson monotone cubic through (xs[k], ys[k]): xs strictly
// increasing, ys non-decreasing. It passes through every point exactly and
// never overshoots, so shade order is kept.
export function monotoneCubic(xs, ys) {
  const n = xs.length,
    d = [],
    m = new Array(n);
  for (let k = 0; k < n - 1; k++)
    d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++)
    m[k] = d[k - 1] * d[k] > 0 ? (d[k - 1] + d[k]) / 2 : 0;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k],
      b = m[k + 1] / d[k],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const gap = xs[k + 1] - xs[k],
      t = (x - xs[k]) / gap,
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[k] +
      (t3 - 2 * t2 + t) * gap * m[k] +
      (3 * t2 - 2 * t3) * ys[k + 1] +
      (t3 - t2) * gap * m[k + 1]
    );
  };
}
// Straight lines between points, held flat beyond the first and last.
function linear(xs, ys) {
  return (x) => {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    return ys[k] + ((ys[k + 1] - ys[k]) * (x - xs[k])) / (xs[k + 1] - xs[k]);
  };
}
// Groups the selection's colours into at most `k` shades by lightness
// (weighted 1-D k-means, started from equal-weight bands). Each group's mean
// in the colour model is one anchor. `samples`: [{ h, s, l, weight }].
export function shadeGroups(samples, k) {
  const sorted = [...samples].sort((a, b) => a.l - b.l),
    total = sorted.reduce((n, s) => n + s.weight, 0);
  if (!total) return [];
  let centres = [];
  for (let j = 0, acc = 0, i = 0; j < k; j++) {
    let sum = 0,
      wsum = 0;
    const end = (total * (j + 1)) / k;
    for (; i < sorted.length && acc + sorted[i].weight / 2 <= end; i++) {
      sum += sorted[i].l * sorted[i].weight;
      wsum += sorted[i].weight;
      acc += sorted[i].weight;
    }
    if (wsum) centres.push(sum / wsum);
  }
  let groups = [];
  for (let round = 0; round < 32; round++) {
    groups = centres.map(() => []);
    for (const s of sorted) {
      let best = 0;
      for (let j = 1; j < centres.length; j++)
        if (Math.abs(s.l - centres[j]) < Math.abs(s.l - centres[best]))
          best = j;
      groups[best].push(s);
    }
    groups = groups.filter((g) => g.length);
    const next = groups.map(
      (g) =>
        g.reduce((n, s) => n + s.l * s.weight, 0) /
        g.reduce((n, s) => n + s.weight, 0),
    );
    const settled =
      next.length === centres.length && next.every((c, j) => c === centres[j]);
    centres = next;
    if (settled) break;
  }
  return groups.map(meanOf);
}
// The weighted mean shade of a group of samples (hue averaged as an angle,
// weighted by chroma so near-greys barely count).
function meanOf(group) {
  const weight = group.reduce((n, s) => n + s.weight, 0);
  let x = 0,
    y = 0,
    l = 0,
    s = 0;
  for (const c of group) {
    const a = (c.h * Math.PI) / 180,
      v = c.weight * Math.max(c.s, 1e-6);
    x += Math.cos(a) * v;
    y += Math.sin(a) * v;
    l += c.l * c.weight;
    s += c.s * c.weight;
  }
  return {
    h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
    s: s / weight,
    l: l / weight,
    weight,
    neutral: group.every((c) => c.neutral),
    members: group,
  };
}
// The shift for a skin-tone (or any) ramp. The selection's shades, grouped by
// lightness, pair with the ramp's colours by rank (darkest with darkest).
// Lightness follows a monotone curve through those pairs; hue offsets and
// chroma ratios are interpolated between them and held beyond the ends. One
// group falls back to the single-target shift, onto the ramp's main colour.
// Returns null when the single-target shift should be used.
export function rampShift(p, samples, single) {
  const ramp = p.ramp
      .map((hex) => toModel(parseHex(hex), p.model))
      .sort((a, b) => a[2] - b[2]),
    groups = shadeGroups(samples, ramp.length);
  // Shades closer than one 8-bit step are one shade.
  const anchors = [];
  for (const g of groups)
    if (anchors.length && g.l - anchors.at(-1).l < 1 / 255)
      anchors.push(meanOf([...anchors.pop().members, ...g.members]));
    else anchors.push(g);
  if (anchors.length < 2) return null;
  const k = anchors.length,
    targets = anchors.map(
      (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (k - 1))],
    ),
    xs = anchors.map((a) => a.l),
    tl = targets.map((t) => t[2]);
  const lx = [],
    ly = [];
  if (xs[0] > 0) (lx.push(0), ly.push(0));
  lx.push(...xs);
  ly.push(...tl);
  if (xs.at(-1) < 1) (lx.push(1), ly.push(1));
  const light = monotoneCubic(lx, ly);
  // Hue offsets unwrapped so neighbouring anchors never turn the long way round.
  const neutral = anchors.every((a) => a.neutral),
    offsets = [];
  anchors.forEach((a, i) => {
    let d = neutral ? targets[i][0] : hueDelta(targets[i][0], a.h);
    if (i) {
      while (d - offsets[i - 1] > 180) d -= 360;
      while (d - offsets[i - 1] < -180) d += 360;
    }
    offsets.push(d);
  });
  const hue = linear(xs, offsets),
    chroma = neutral
      ? linear(
          xs,
          targets.map((t) => t[1]),
        )
      : linear(
          xs,
          targets.map((t, i) =>
            Math.log(clamp(t[1] / Math.max(anchors[i].s, 0.01), 1 / 64, 64)),
          ),
        );
  return (rgb) => {
    const [h, s, l] = toModel(rgb, p.model);
    return fromModel(
      neutral ? hue(l) : h + hue(l),
      neutral ? clamp(chroma(l), 0, 1) : clamp(s * Math.exp(chroma(l)), 0, 1),
      clamp(light(l), 0, 1),
      p.model,
    );
  };
}
// Group samples for rampShift from the unique colours and their weights.
export function rampSamples(colours, weights, model) {
  const samples = [];
  for (let c = 0; c < weights.length; c++)
    if (weights[c] > 0) {
      const rgb = [colours[c * 3], colours[c * 3 + 1], colours[c * 3 + 2]],
        [h, s, l] = toModel(rgb, model);
      samples.push({
        h,
        s,
        l,
        weight: weights[c],
        neutral: rgbToHsl(...rgb)[3] < NEUTRAL,
      });
    }
  return samples;
}
// The deltas the single-target shift uses to move `anchorRgb` onto the
// ramp's main colour.
export const mainDeltas = (p, anchorRgb) =>
  deltasFor(anchorRgb, parseHex(p.ramp[0]), p.model);
