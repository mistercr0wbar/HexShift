import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  defaults,
  deltasFor,
  parseHex,
  rgbToOklch,
  toHex,
} from "../src/colour.js";
import {
  colourFamilies,
  prepare,
  processEdit,
  processImage,
  validateMap,
} from "../src/engine.js";
import {
  MAX_STEPS,
  omissionSummary,
  parseRecipe,
  parseRecipeFile,
  recipeStep,
  replay,
  writeRecipe,
} from "../src/recipe.js";
import sample from "../src/sample.js";
const heart = async () => {
  const { data, info } = await sharp(
    Buffer.from(sample.split(",")[1], "base64"),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    w: info.width,
    h: info.height,
    data: new Uint8ClampedArray(data),
    image: await prepare(info.width, info.height, new Uint8ClampedArray(data)),
  };
};
// A row that moves the colour at (x, y) onto `target`, the way the app does.
const row = (id, data, w, x, y, target, extra = {}) => {
  const o = (y * w + x) * 4;
  return {
    id,
    seeds: [{ x, y }],
    params: {
      ...defaults(),
      target,
      ...deltasFor([...data.subarray(o, o + 3)], parseHex(target), "oklch"),
      ...extra,
    },
  };
};
const strip = (...rgb) =>
  new Uint8ClampedArray(rgb.flatMap((c) => [...c, 255]));
test("an in-memory recipe replays exactly like the same recipe saved and loaded", async () => {
  const pixels = strip([220, 30, 30], [30, 60, 220]),
    rows = [
      row(1, pixels, 2, 0, 0, "#12AB34", { mode: "flat", connected: true }),
    ],
    steps = [recipeStep(rows, pixels, 2, new Int8Array(2))];
  const direct = await replay(2, 1, pixels, steps),
    loaded = await replay(2, 1, pixels, parseRecipe(writeRecipe(steps)));
  assert.deepEqual(direct, loaded);
  assert.deepEqual([...direct.subarray(0, 4)], [18, 171, 52, 255]);
});
test("one row gives exactly the single-edit result, brush included", async () => {
  const { w, h, data, image } = await heart(),
    labels = new Int8Array(w * h),
    r = row(1, data, w, image.palette[0].x, image.palette[0].y, "#5865F2");
  labels.fill(1, 60 * w, 60 * w + 40);
  labels.fill(-1, 80 * w, 80 * w + 40);
  const single = await processImage(image, r.params, r.seeds, labels),
    map = await processEdit(image, [r], labels, 0);
  assert.deepEqual(map.pixels, single.pixels);
  assert.deepEqual(map.mask, single.mask);
  assert.equal(map.count, single.count);
  assert.equal(map.changed, single.changed);
  assert.deepEqual(map.counts, [single.count]);
});
test("rows swap red and blue without the second change undoing the first", async () => {
  const data = strip(
      [220, 30, 30],
      [30, 60, 220],
      [30, 60, 220],
      [220, 30, 30],
    ),
    image = await prepare(4, 1, data),
    flat = { mode: "flat", soft: 0 },
    rows = [
      row(1, data, 4, 0, 0, "#1E3CDC", flat),
      row(2, data, 4, 1, 0, "#DC1E1E", flat),
    ];
  const out = await processEdit(image, rows, new Int8Array(4), 0),
    hexes = [0, 1, 2, 3].map((i) =>
      toHex(...out.pixels.subarray(i * 4, i * 4 + 3)),
    );
  assert.deepEqual(hexes, ["#1E3CDC", "#DC1E1E", "#DC1E1E", "#1E3CDC"]);
  // Row order does not matter.
  const swapped = await processEdit(
    image,
    [rows[1], rows[0]],
    new Int8Array(4),
    0,
  );
  assert.deepEqual(swapped.pixels, out.pixels);
  assert.deepEqual(out.counts, [2, 2]);
});
test("overlapping rows: each pixel leans to the nearer sample, and the brush overrules both", async () => {
  // Bands of red, orange-red and orange, four pixels each: with wide
  // tolerances both rows select all three. Red and orange take their own
  // rows' colours; orange-red, nearer red, is mostly the red row's blue.
  const band = (rgb) => Array(4).fill(rgb),
    data = strip(
      ...band([255, 0, 0]),
      ...band([255, 60, 0]),
      ...band([255, 140, 0]),
    ),
    image = await prepare(12, 1, data),
    wide = { mode: "flat", hueTol: 90, shadeTol: 100, soft: 0 },
    rows = [
      row(1, data, 12, 0, 0, "#0000FF", wide),
      row(2, data, 12, 11, 0, "#00FF00", wide),
    ],
    labels = new Int8Array(12);
  let out = await processEdit(image, rows, labels, 0);
  const at = (i) => [...out.pixels.subarray(i * 4, i * 4 + 3)];
  assert.deepEqual(at(0), [0, 0, 255]);
  assert.deepEqual(at(11), [0, 255, 0]);
  const [, g, b] = at(5);
  assert.ok(b > 2 * g && b + g >= 254, String(at(5)));
  assert.deepEqual([...out.owner], [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  // The brush forces a pixel into one row, or keeps it out of both.
  labels[5] = 2;
  labels[0] = -1;
  out = await processEdit(image, rows, labels, 0);
  assert.deepEqual(at(0), [255, 0, 0]);
  assert.deepEqual(at(5), [0, 255, 0]);
});
test("a row that keeps its own colour changes nothing but still claims it", async () => {
  const { w, h, data, image } = await heart(),
    families = colourFamilies(image),
    // As the app sets them: every shade of a hue family, default for greys.
    same = families.map((f, k) =>
      row(k + 1, data, w, f.x, f.y, f.hex, { shadeTol: f.grey ? 60 : 100 }),
    );
  assert.equal(families[0].grey, false);
  assert.ok(families[0].share > 0.8, String(families[0].share));
  assert.ok(families.some((f) => f.grey && f.hex === "#000000"));
  const out = await processEdit(image, same, new Int8Array(w * h), 0);
  assert.equal(out.changed, 0);
  assert.ok(out.counts[0] > 9000);
  // A row whose tolerance also takes the red, from a blue sample: the red
  // family's sample is closer, so it keeps the red.
  const greedy = row(9, data, w, families[0].x, families[0].y, "#00FF00", {
    hueTol: 180,
    shadeTol: 100,
  });
  greedy.seeds = [{ hex: "#3040FF" }];
  const kept = await processEdit(
    image,
    [...same, greedy],
    new Int8Array(w * h),
    0,
  );
  assert.ok(kept.changed < 50, String(kept.changed));
});
test("recolouring both the fill and the outline leaves no dark seam between them", async () => {
  const { w, h, data, image } = await heart(),
    [red, grey] = colourFamilies(image),
    rows = [
      row(1, data, w, red.x, red.y, "#5865F2", { shadeTol: 100 }),
      row(2, data, w, grey.x, grey.y, "#FFFFFF"),
    ],
    out = await processEdit(image, rows, new Int8Array(w * h), 0),
    fillL = rgbToOklch(0x58, 0x65, 0xf2)[0];
  // Every solid pixel is at least about as light as the blurple fill: the old
  // dark red blend into the black outline now blends blurple into white.
  let dark = 0;
  for (let i = 0; i < w * h; i++)
    if (out.pixels[i * 4 + 3] >= 128) {
      const L = rgbToOklch(...out.pixels.subarray(i * 4, i * 4 + 3))[0];
      if (L < fillL - 0.12) dark++;
    }
  assert.equal(dark, 0);
});
test("maps are validated: rows, ids, samples and brush labels", () => {
  const p = defaults(),
    ok = [{ id: 1, params: p, seeds: [] }],
    labels = new Int8Array(4);
  validateMap(ok, labels, 0, 2, 2);
  for (const [rows, active, bad] of [
    [[], 0, null],
    [
      Array.from({ length: 17 }, (_, k) => ({
        id: k + 1,
        params: p,
        seeds: [],
      })),
      0,
      null,
    ],
    [
      [
        { id: 1, params: p, seeds: [] },
        { id: 1, params: p, seeds: [] },
      ],
      0,
      null,
    ],
    [[{ id: 128, params: p, seeds: [] }], 0, null],
    [ok, 1, null],
    [[{ id: 1, params: { ...p, hueTol: 999 }, seeds: [] }], 0, null],
    [[{ id: 1, params: p, seeds: [{ x: 5, y: 0 }] }], 0, null],
    [[{ id: 1, params: p, seeds: [{ hex: "red" }] }], 0, null],
    [
      [
        { id: 1, params: p, seeds: Array(40).fill({ x: 0, y: 0 }) },
        { id: 2, params: p, seeds: Array(40).fill({ x: 0, y: 0 }) },
      ],
      0,
      null,
    ],
    [ok, 0, 3],
  ]) {
    const l = new Int8Array(4);
    if (bad) l[0] = bad;
    assert.throws(() => validateMap(rows, l, active, 2, 2));
  }
});
test("a recipe saved from a map replays to the same pixels", async () => {
  const { w, h, data, image } = await heart(),
    rows = [
      row(1, data, w, image.palette[0].x, image.palette[0].y, "#248046"),
      row(2, data, w, 92, 5, "#FFFFFF"),
    ],
    live = await processEdit(image, rows, new Int8Array(w * h), 0),
    text = writeRecipe([recipeStep(rows, data, w)]),
    steps = parseRecipe(text);
  assert.equal(steps.length, 1);
  assert.equal(
    steps[0].rows[0].seeds[0].hex,
    toHex(
      ...data.subarray(
        (image.palette[0].y * w + image.palette[0].x) * 4,
        (image.palette[0].y * w + image.palette[0].x) * 4 + 3,
      ),
    ),
  );
  const replayed = await replay(w, h, data, steps);
  assert.deepEqual(replayed, live.pixels);
  // Two steps: the second builds on the first.
  const second = parseRecipe(
      writeRecipe([
        ...steps,
        {
          rows: [
            {
              params: { ...defaults(), mode: "flat", target: "#FFD000" },
              seeds: [{ hex: "#FFFFFF" }],
            },
          ],
        },
      ]),
    ),
    twice = await replay(w, h, data, second);
  const whiteBefore = [...replayed].filter(
    (v, i) =>
      i % 4 === 0 &&
      v === 255 &&
      replayed[i + 1] === 255 &&
      replayed[i + 2] === 255,
  ).length;
  assert.ok(whiteBefore > 100);
  assert.notDeepEqual(twice, replayed);
});
test("recipes name brush strokes and connected regions, and never keep them", () => {
  const data = strip([255, 0, 0], [0, 0, 255]),
    rows = [row(1, data, 2, 0, 0, "#00FF00", { connected: true })];
  rows[0].mask = [1, 0];
  const step = recipeStep(rows, data, 2, new Int8Array([0, 1]));
  assert.deepEqual(step.omissions, ["brush", "connected"]);
  assert.equal(step.approximate, undefined);
  const saved = JSON.parse(writeRecipe([step]));
  assert.deepEqual(saved.steps[0].omissions, ["brush", "connected"]);
  assert.equal("approximate" in saved.steps[0], false);
  assert.equal("mask" in saved.steps[0].rows[0], false);
  assert.equal("x" in saved.steps[0].rows[0].seeds[0], false);
  const back = parseRecipeFile(writeRecipe([step]));
  assert.equal(back.steps[0].rows[0].params.connected, false);
  assert.equal(back.steps[0].provenance, "known");
  assert.equal(omissionSummary(back.steps).kind, "known");
  assert.match(omissionSummary(back.steps).text, /Brush strokes are left out/);
  assert.match(omissionSummary(back.steps).text, /Connected regions are left out/);
  // Rows without samples are left out, and they do not warn.
  const bare = recipeStep(
    [{ id: 1, params: defaults(), seeds: [], mask: [1] }],
    data,
    2,
    new Int8Array([1, 1]),
  );
  assert.equal(bare.rows.length, 0);
  assert.deepEqual(bare.omissions, []);
  assert.equal(omissionSummary([bare]).kind, "none");
});
test("recipes omit a polygon's shape and name it only when that colour is saved", () => {
  const data = strip([255, 0, 0], [0, 0, 255]),
    rows = [row(1, data, 2, 0, 0, "#00FF00")];
  rows[0].polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  const step = recipeStep(rows, data, 2, new Int8Array(2));
  assert.deepEqual(step.omissions, ["polygon"]);
  assert.equal(step.rows[0].polygon, undefined);
  const saved = JSON.parse(writeRecipe([step]));
  assert.equal("polygon" in saved.steps[0].rows[0], false);
  assert.deepEqual(saved.steps[0].omissions, ["polygon"]);
  assert.equal("approximate" in saved.steps[0], false);
  const back = parseRecipeFile(writeRecipe([step]));
  assert.equal(back.steps[0].rows[0].polygon, undefined);
  assert.match(omissionSummary(back.steps).text, /Polygons are left out/);
  const empty = recipeStep(
    [
      {
        id: 1,
        params: defaults(),
        seeds: [],
        polygon: rows[0].polygon,
      },
    ],
    data,
    2,
  );
  assert.equal(empty.rows.length, 0);
  assert.deepEqual(empty.omissions, []);
  assert.equal(omissionSummary([empty]).kind, "none");
});
test("recipe omissions distinguish known, none, generic and unknown", () => {
  const data = strip([255, 0, 0], [0, 0, 255]),
    source = row(1, data, 2, 0, 0, "#00FF00");
  source.params.manual = true;
  source.params.dh = 12;
  source.params.soft = 40;
  source.params.model = "hsl";
  source.params.ramp = ["#111111", "#888888", "#EEEEEE"];
  const plain = recipeStep([source], data, 2, new Int8Array(2));
  assert.deepEqual(plain.omissions, []);
  const text = writeRecipe([plain]);
  assert.deepEqual(JSON.parse(text).steps[0].omissions, []);
  assert.equal(omissionSummary(parseRecipeFile(text).steps).kind, "none");
  const legacy = JSON.parse(text);
  delete legacy.steps[0].omissions;
  const unknown = parseRecipeFile(JSON.stringify(legacy));
  assert.equal(unknown.steps[0].provenance, "unknown");
  assert.equal(unknown.steps[0].omissions, undefined);
  assert.equal(omissionSummary(unknown.steps).kind, "unknown");
  assert.match(omissionSummary(unknown.steps).text, /does not say whether/);
  legacy.steps[0].approximate = true;
  const generic = parseRecipeFile(JSON.stringify(legacy));
  assert.equal(generic.steps[0].provenance, "generic");
  assert.equal(omissionSummary(generic.steps).kind, "generic");
  assert.match(omissionSummary(generic.steps).text, /approximation/);
  const mixed = parseRecipeFile(
    JSON.stringify({
      format: "hexshift-recipe",
      version: 1,
      steps: [
        JSON.parse(text).steps[0],
        {
          rows: JSON.parse(text).steps[0].rows,
          omissions: ["polygon", "brush"],
        },
        { rows: JSON.parse(text).steps[0].rows },
      ],
    }),
  );
  // The first step records none. The second names two reasons, stored in order.
  assert.deepEqual(mixed.steps[1].omissions, ["brush", "polygon"]);
  const summary = omissionSummary(mixed.steps);
  assert.equal(summary.kind, "known");
  assert.match(summary.text, /Brush strokes are left out/);
  assert.match(summary.text, /Polygons are left out/);
  assert.match(summary.text, /Some other steps do not say/);
  assert.throws(
    () => parseRecipeFile(JSON.stringify({ ...legacy, steps: [{ ...legacy.steps[0], omissions: ["nope"] }] })),
    /omissions are unreadable/,
  );
  const dup = JSON.parse(text);
  dup.steps[0].omissions = ["brush", "brush"];
  assert.throws(() => parseRecipeFile(JSON.stringify(dup)), /omissions are unreadable/);
});
test("recipes are parsed safely: format, version, size, counts and ranges", () => {
  const good = JSON.parse(
    writeRecipe([
      {
        rows: [
          {
            params: { ...defaults(), target: "#5865F2" },
            seeds: [{ hex: "#ff0000" }],
          },
        ],
      },
    ]),
  );
  const text = (o) => JSON.stringify(o);
  assert.equal(parseRecipe(text(good))[0].rows[0].seeds[0].hex, "#FF0000");
  const bad = (mutate, reason) => {
    const o = structuredClone(good);
    mutate(o);
    assert.throws(() => parseRecipe(text(o)), reason);
  };
  assert.throws(() => parseRecipe("{"), /not valid JSON/);
  assert.throws(() => parseRecipe(" ".repeat(70000) + text(good)), /64 KB/);
  bad((o) => (o.format = "something-else"), /not a Hex Shift recipe/);
  bad((o) => (o.version = 4), /newer version/);
  bad((o) => (o.version = 3), /outline/);
  bad((o) => (o.steps = []), /1 to 32 steps/);
  bad(
    (o) => (o.steps = Array(MAX_STEPS + 1).fill(o.steps[0])),
    /1 to 32 steps/,
  );
  bad((o) => (o.steps[0].rows = Array(17).fill(o.steps[0].rows[0])), /1 to 16/);
  bad((o) => (o.steps[0].rows[0].seeds = [{ x: 1, y: 1 }]), /#RRGGBB samples/);
  bad(
    (o) => (o.steps[0].rows[0].seeds = Array(65).fill({ hex: "#FFFFFF" })),
    /64 samples/,
  );
  bad((o) => (o.steps[0].rows[0].params.hueTol = 999), /hueTol/);
  bad(
    (o) => (o.steps[0].rows[0].params.mode = "explode"),
    /Invalid colour operation/,
  );
  bad(
    (o) => (o.steps[0].rows[0].params.target = "url(x)"),
    /Invalid colour operation|#RRGGBB/,
  );
  bad(
    (o) => (o.steps[0].rows[0].params.protect = "yes"),
    /Invalid colour operation/,
  );
  // Unknown and prototype fields are ignored, never copied.
  const extra = structuredClone(good);
  extra.steps[0].rows[0].params = JSON.parse(
    '{"__proto__":{"polluted":true},"evil":1,"target":"#5865F2"}',
  );
  const params = parseRecipe(text(extra))[0].rows[0].params;
  assert.equal(params.evil, undefined);
  assert.equal(params.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(params.target, "#5865F2");
});
test("a recipe carries the outline, and recipes without one are unchanged", () => {
  const steps = [
    {
      rows: [
        {
          params: { ...defaults(), target: "#5865F2" },
          seeds: [{ hex: "#FF0000" }],
        },
      ],
    },
  ];
  // Without an outline the file is exactly what version 1 wrote.
  const plain = writeRecipe(steps);
  assert.equal(JSON.parse(plain).version, 1);
  assert.equal("outline" in JSON.parse(plain), false);
  assert.deepEqual(parseRecipeFile(plain).outline, null);
  assert.equal(writeRecipe(steps, null), plain);
  // With one it is version 2, and it reads back normalised.
  const withOutline = writeRecipe(steps, { widthPct: 4, colour: "#ffffff" });
  assert.equal(JSON.parse(withOutline).version, 2);
  const back = parseRecipeFile(withOutline);
  assert.deepEqual(back.outline, { widthPct: 4, colour: "#FFFFFF" });
  assert.equal(back.steps[0].rows[0].seeds[0].hex, "#FF0000");
  assert.equal(parseRecipe(withOutline).length, 1);
  // A version 2 file may simply have no outline.
  const v2 = JSON.parse(plain);
  v2.version = 2;
  assert.equal(parseRecipeFile(JSON.stringify(v2)).outline, null);
  // An outline in a version 1 file is not part of that format and is ignored.
  const v1 = JSON.parse(withOutline);
  v1.version = 1;
  assert.equal(parseRecipeFile(JSON.stringify(v1)).outline, null);
  // An outline and no colour steps is version 3. A version 2 file that is
  // already outline-only still opens.
  const only = writeRecipe([], { widthPct: 4, colour: "#ffffff" });
  assert.equal(JSON.parse(only).version, 3);
  assert.equal(JSON.parse(only).steps.length, 0);
  assert.deepEqual(parseRecipeFile(only).outline, {
    widthPct: 4,
    colour: "#FFFFFF",
  });
  assert.equal(parseRecipeFile(only).steps.length, 0);
  const v2only = JSON.parse(only);
  v2only.version = 2;
  assert.deepEqual(parseRecipeFile(JSON.stringify(v2only)).outline, {
    widthPct: 4,
    colour: "#FFFFFF",
  });
  const bare = JSON.parse(only);
  delete bare.outline;
  assert.throws(() => parseRecipeFile(JSON.stringify(bare)), /outline/);
  assert.throws(
    () => writeRecipe([]),
    /colour change or an outline/,
  );
  // Bad outlines are refused, when written and when read.
  for (const bad of [
    { widthPct: 0.4, colour: "#FFFFFF" },
    { widthPct: 16, colour: "#FFFFFF" },
    { widthPct: "wide", colour: "#FFFFFF" },
    { widthPct: 4, colour: "white" },
    { widthPct: 4 },
    "thick",
    [],
  ]) {
    assert.throws(() => writeRecipe(steps, bad), /outline/);
    const o = JSON.parse(withOutline);
    o.outline = bad;
    assert.throws(() => parseRecipeFile(JSON.stringify(o)), /outline/);
  }
});
