import { defaults, toHex } from "./colour.js";
import {
  MAX_ROWS,
  MAX_SEEDS,
  prepare,
  processEdit,
  validateParams,
} from "./engine.js";
// A recipe repeats colour changes on other images: a list of steps, each a
// colour map applied in turn. Samples are stored as colours, not places, so
// brush strokes, connected-region limits and polygons are left out.
export const MAX_RECIPE_BYTES = 64 * 1024,
  MAX_STEPS = 32;
const NUMBERS = ["hueTol", "shadeTol", "soft", "feather", "dh", "ds", "dl"],
  CHOICES = { mode: ["shift", "flat", "transparent"], model: ["oklch", "hsl"] },
  FLAGS = ["protect", "cleanEdges"];
// The settings a recipe keeps, copied field by field and validated.
function cleanParams(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("A recipe row has no settings.");
  const p = defaults();
  for (const key of NUMBERS) if (key in source) p[key] = Number(source[key]);
  for (const [key, options] of Object.entries(CHOICES))
    if (key in source)
      p[key] = options.includes(source[key]) ? source[key] : "";
  for (const key of FLAGS) if (key in source) p[key] = source[key];
  if ("target" in source) p.target = String(source.target).toUpperCase();
  p.ramp = Array.isArray(source.ramp)
    ? source.ramp.map((v) => String(v).toUpperCase())
    : null;
  p.connected = false;
  validateParams(p);
  if (
    !/^#[\dA-F]{6}$/.test(p.target) ||
    p.ramp?.some((v) => !/^#[\dA-F]{6}$/.test(v))
  )
    throw Error("Recipe colours must be #RRGGBB.");
  return p;
}
const keep = (p) => {
  const out = {};
  for (const key of [...NUMBERS, ...Object.keys(CHOICES), ...FLAGS, "target"])
    out[key] = p[key];
  if (p.ramp) out.ramp = p.ramp.slice();
  return out;
};
// The colour map as a recipe step: rows that have samples, each sample
// replaced by its colour in `pixels`. `approximate` says brush strokes,
// connected regions or a polygon were in play. The polygon is not copied.
export function recipeStep(rows, pixels, width, labels) {
  const step = { rows: [], approximate: false };
  for (const row of rows) {
    if (row.polygon?.length) step.approximate = true;
    if (!row.seeds.length) continue;
    step.rows.push({
      params: keep(row.params),
      seeds: row.seeds.map((s) =>
        s.hex
          ? { hex: s.hex }
          : {
              hex: toHex(
                ...pixels.subarray(
                  (s.y * width + s.x) * 4,
                  (s.y * width + s.x) * 4 + 3,
                ),
              ),
            },
      ),
    });
    if (row.params.connected) step.approximate = true;
  }
  if (labels?.some((v) => v !== 0)) step.approximate = true;
  return step;
}
// A recipe can carry the outline too: { widthPct, colour }. Version 1 is colour
// steps and no outline, so older copies can still read it. Version 2 is colour
// steps plus an outline. Version 3 is an outline and no colour steps.
export const OUTLINE_MIN = 0.5,
  OUTLINE_MAX = 15;
function cleanOutline(source) {
  if (source === null || source === undefined) return null;
  const widthPct =
      typeof source === "object" && !Array.isArray(source)
        ? Number(source.widthPct)
        : NaN,
    colour = String(source?.colour).toUpperCase();
  if (
    !(widthPct >= OUTLINE_MIN && widthPct <= OUTLINE_MAX) ||
    !/^#[\dA-F]{6}$/.test(colour)
  )
    throw Error("A recipe's outline is 0.5 to 15 percent wide, in #RRGGBB.");
  return { widthPct, colour };
}
export function writeRecipe(steps, outline = null) {
  const clean = cleanOutline(outline),
    rows = steps.map((s) => ({ rows: s.rows }));
  if (!rows.length && !clean)
    throw Error("A recipe needs a colour change or an outline.");
  // Steps with an outline stay version 2, which older copies can read.
  // An outline and no colour steps is version 3.
  const data = {
    format: "hexshift-recipe",
    version: !rows.length ? 3 : clean ? 2 : 1,
    steps: rows,
  };
  if (clean) data.outline = clean;
  return JSON.stringify(data, null, 2) + "\n";
}
// The steps alone, as every caller before outlines expected them.
export function parseRecipe(text) {
  return parseRecipeFile(text).steps;
}
// { steps, outline }: outline is null when the file has none.
export function parseRecipeFile(text) {
  if (typeof text !== "string") throw Error("A recipe must be text.");
  if (new TextEncoder().encode(text).length > MAX_RECIPE_BYTES)
    throw Error("Recipes must be 64 KB or smaller.");
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw Error("This is not a Hex Shift recipe (it is not valid JSON).");
  }
  if (data?.format !== "hexshift-recipe")
    throw Error("This is not a Hex Shift recipe.");
  if (data.version !== 1 && data.version !== 2 && data.version !== 3)
    throw Error("This recipe needs a newer version of Hex Shift.");
  const outline = data.version === 1 ? null : cleanOutline(data.outline);
  if (data.version === 3 && !outline)
    throw Error("An outline-only recipe needs an outline.");
  // Version 2 files that carry only an outline stay valid. A colour recipe
  // still needs 1 to 32 steps.
  const outlineOnly =
    (data.version === 2 || data.version === 3) &&
    outline &&
    Array.isArray(data.steps) &&
    data.steps.length === 0;
  if (
    !Array.isArray(data.steps) ||
    data.steps.length > MAX_STEPS ||
    (!outlineOnly && !data.steps.length)
  )
    throw Error("A recipe has 1 to 32 steps.");
  const steps = data.steps.map((step) => {
    if (
      !Array.isArray(step?.rows) ||
      !step.rows.length ||
      step.rows.length > MAX_ROWS
    )
      throw Error("Each recipe step has 1 to 16 colours.");
    let samples = 0;
    const rows = step.rows.map((row) => {
      if (
        !Array.isArray(row?.seeds) ||
        !row.seeds.length ||
        row.seeds.some(
          (s) => typeof s?.hex !== "string" || !/^#[\dA-F]{6}$/i.test(s.hex),
        )
      )
        throw Error("Each recipe colour needs #RRGGBB samples.");
      samples += row.seeds.length;
      return {
        params: cleanParams(row.params),
        seeds: row.seeds.map((s) => ({ hex: s.hex.toUpperCase() })),
      };
    });
    if (samples > MAX_SEEDS)
      throw Error("A recipe step can have at most 64 samples.");
    return { rows, approximate: false };
  });
  return { steps, outline: data.version === 1 ? null : outline };
}
// Runs the steps on an image, each on the result of the one before.
export async function replay(
  width,
  height,
  data,
  steps,
  yieldFn = async () => {},
  cancelled = () => false,
) {
  let pixels = data;
  for (const step of steps) {
    const image = await prepare(width, height, pixels, yieldFn, cancelled),
      rows = step.rows.map((row, k) => ({
        id: k + 1,
        ...row,
        params: cleanParams(row.params),
      })),
      result = await processEdit(
        image,
        rows,
        new Int8Array(width * height),
        0,
        yieldFn,
        cancelled,
      );
    pixels = result.pixels;
  }
  return pixels;
}
