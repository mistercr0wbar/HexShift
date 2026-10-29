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
// Named reasons a recipe cannot repeat a spatial limit. Order is stable.
// Coordinates and masks are never a reason.
export const OMISSION_REASONS = ["brush", "connected", "polygon"];
const OMISSION_TEXT = {
  brush: "Brush strokes are left out.",
  connected: "Connected regions are left out.",
  polygon: "Polygons are left out.",
};
const GENERIC_OMISSION =
  "This recipe is marked as an approximation, and it does not say which spatial edits were left out. Continuing does not promise a lossless replay.";
const UNKNOWN_OMISSION =
  "This recipe does not say whether brush strokes, connected regions, or polygons were left out. Continuing does not promise a lossless replay.";
export function cleanOmissions(source) {
  if (!Array.isArray(source) || source.length > OMISSION_REASONS.length)
    throw Error("A recipe's omissions are unreadable.");
  const seen = new Set();
  for (const item of source) {
    if (
      typeof item !== "string" ||
      !OMISSION_REASONS.includes(item) ||
      seen.has(item)
    )
      throw Error("A recipe's omissions are unreadable.");
    seen.add(item);
  }
  return OMISSION_REASONS.filter((id) => seen.has(id));
}
// Reasons for colours that are actually in the recipe. A polygon or a
// connected flag on a row with no samples is not a warning, and a brush
// on an image with nothing sampled is not one either.
export function omissionReasons(rows, labels) {
  const sampled = (rows || []).filter((row) => row?.seeds?.length);
  const reasons = [];
  if (sampled.length && labels?.some((value) => value !== 0))
    reasons.push("brush");
  if (sampled.some((row) => row.params?.connected)) reasons.push("connected");
  if (sampled.some((row) => row.polygon?.length)) reasons.push("polygon");
  return reasons;
}
// One description of the steps about to be saved or replayed.
// `known` lists the reasons. An empty list on every step is `none`.
// `generic` is an old approximation flag with no reasons. `unknown` is a
// legacy step that says nothing either way.
export function omissionSummary(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return { kind: "none", reasons: [], text: "" };
  const reasons = new Set();
  let named = false;
  let generic = false;
  let unknown = false;
  for (const step of list) {
    if (Array.isArray(step?.omissions)) {
      named = true;
      for (const id of step.omissions) reasons.add(id);
    } else if (step?.approximate === true || step?.provenance === "generic")
      generic = true;
    else unknown = true;
  }
  const ordered = OMISSION_REASONS.filter((id) => reasons.has(id));
  if (ordered.length) {
    let text = ordered.map((id) => OMISSION_TEXT[id]).join(" ");
    if (generic || unknown)
      text += " Some other steps do not say what else was left out.";
    return { kind: "known", reasons: ordered, text };
  }
  if (generic && !unknown)
    return { kind: "generic", reasons: [], text: GENERIC_OMISSION };
  if (!named || unknown)
    return { kind: "unknown", reasons: [], text: UNKNOWN_OMISSION };
  return { kind: "none", reasons: [], text: "" };
}
// The colour map as a recipe step: rows that have samples, each sample
// replaced by its colour in `pixels`. `omissions` names spatial limits that
// were left out. The polygon, the mask and the sample positions are not copied.
export function recipeStep(rows, pixels, width, labels) {
  const step = { rows: [], omissions: omissionReasons(rows, labels) };
  for (const row of rows) {
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
  }
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
    rows = steps.map((step) => step.rows);
  if (!rows.length && !clean)
    throw Error("A recipe needs a colour change or an outline.");
  // Steps with an outline stay version 2, which older copies can read.
  // An outline and no colour steps is version 3.
  const data = {
    format: "hexshift-recipe",
    version: !rows.length ? 3 : clean ? 2 : 1,
    steps: steps.map((step) => {
      // Colours only. A polygon, a mask, or sample positions on a row are not
      // written, even if a caller left them on the step.
      const out = {
        rows: step.rows.map((row) => ({
          params: row.params,
          seeds: row.seeds.map((seed) => ({ hex: seed.hex })),
        })),
      };
      // An empty list is "these steps left nothing spatial out". Absence is
      // legacy and must not be rewritten into that claim.
      if (Array.isArray(step.omissions))
        out.omissions = cleanOmissions(step.omissions);
      else if (step.approximate === true) out.approximate = true;
      return out;
    }),
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
    // Rows keep colours only. A polygon or a mask on the file is ignored.
    const parsed = { rows };
    if (Array.isArray(step.omissions)) {
      parsed.omissions = cleanOmissions(step.omissions);
      parsed.provenance = "known";
    } else if (step.approximate === true) {
      parsed.approximate = true;
      parsed.provenance = "generic";
    } else parsed.provenance = "unknown";
    return parsed;
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
