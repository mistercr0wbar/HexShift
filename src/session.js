import { defaults } from "./colour.js";
import { MAX_DOCUMENTS } from "./documents.js";
import { validateImage, validateMap, validateParams, validateSeeds } from "./engine.js";
import { FRAME_PAD_MAX } from "./output.js";
import { CUSTOM_MAX, CUSTOM_MIN, PRESETS } from "./presets.js";

// A session is the open tabs: images and edits, not a recipe and not an export.
// Version 1. Later releases can add fields; this reader ignores ones it does not know.
export const SESSION_MIME = "application/vnd.hexshift.session+json";
export const MAX_SESSION_BYTES = 128 * 1024 * 1024;
const MAX_STEPS = 32,
  MAX_VARIANTS = 64,
  MAX_NAME = 200,
  MAX_SVG_BYTES = 2 * 1024 * 1024,
  SVG_EDGES = [256, 512, 1024, 2048],
  PRESET_IDS = PRESETS.map((p) => p.id),
  FORMATS = ["png", "webp", "webp-small", "zip"],
  VIEWS = ["result", "side", "wipe"],
  OVERLAYS = ["overlay", "only", "normal"],
  COMPARES = ["working", "original"],
  TOOLS = ["pick", "pan", "add", "subtract"];

export function isSessionFile(file) {
  return (
    /\.hexshift$/i.test(file?.name || "") || file?.type === SESSION_MIME
  );
}

function encodeBytes(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function decodeBytes(text, Type) {
  if (typeof text !== "string" || !text.length)
    throw Error("A session's image data is unreadable.");
  let bin;
  try {
    bin = atob(text);
  } catch {
    throw Error("A session's image data is unreadable.");
  }
  const out = new Type(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cleanParams(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("A session row has no settings.");
  const p = defaults();
  for (const key of ["hueTol", "shadeTol", "soft", "feather", "dh", "ds", "dl"])
    if (key in source) p[key] = Number(source[key]);
  if ("mode" in source) p.mode = source.mode;
  if ("model" in source) p.model = source.model;
  if ("target" in source) p.target = String(source.target).toUpperCase();
  if ("protect" in source) p.protect = source.protect === true;
  if ("cleanEdges" in source) p.cleanEdges = source.cleanEdges === true;
  if ("connected" in source) p.connected = source.connected === true;
  p.manual = source.manual === true;
  p.ramp = Array.isArray(source.ramp)
    ? source.ramp.map((v) => String(v).toUpperCase())
    : null;
  validateParams(p);
  return p;
}
function cleanSeeds(seeds, w, h) {
  validateSeeds(seeds, w, h);
  return seeds.map((s) =>
    typeof s.hex === "string"
      ? { hex: s.hex.toUpperCase() }
      : { x: s.x, y: s.y },
  );
}
function cleanRows(rows, w, h) {
  if (!Array.isArray(rows)) throw Error("A session's colour map is unreadable.");
  return rows.map((row) => ({
    id: row?.id,
    params: cleanParams(row?.params),
    seeds: cleanSeeds(row?.seeds, w, h),
  }));
}
function cleanSteps(steps, w, h) {
  if (!Array.isArray(steps) || steps.length > MAX_STEPS)
    throw Error("A session has too many baked colour steps.");
  return steps.map((step) => {
    if (!Array.isArray(step?.rows))
      throw Error("A baked colour step is unreadable.");
    return {
      rows: step.rows.map((row) => ({
        params: cleanParams(row?.params),
        seeds: cleanSeeds(row?.seeds, w, h),
      })),
    };
  });
}
function cleanOutline(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("A session's outline is unreadable.");
  const widthPct = Number(source.widthPct),
    colour = String(source.colour || "").toUpperCase();
  if (
    !(widthPct >= 0.5 && widthPct <= 15) ||
    !/^#[\dA-F]{6}$/.test(colour)
  )
    throw Error(
      "A session's outline is 0.5 to 15 percent wide, in #RRGGBB.",
    );
  return { on: source.on === true, widthPct, colour };
}
function cleanName(source) {
  const name = String(source ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, MAX_NAME);
  return name || "image";
}
function cleanView(source) {
  const view = source && typeof source === "object" ? source : {};
  const zoom = Number(view.zoom);
  const panX = Number(view.panX),
    panY = Number(view.panY),
    wipe = Number(view.wipe),
    brush = Number(view.brush);
  // Hand zoom stops at 16. Fit does not: a small picture in a large window
  // is drawn much bigger, and that view has to round-trip. 8192 is a
  // one-pixel image across an 8K pane. Anything past that is not a real view.
  if (!(zoom >= 0.01 && zoom <= 8192) || !Number.isFinite(panX) || !Number.isFinite(panY))
    throw Error("A session's view is unreadable.");
  if (Math.abs(panX) > 100000 || Math.abs(panY) > 100000)
    throw Error("A session's view is unreadable.");
  return {
    zoom,
    fitMode: view.fitMode !== false,
    panX,
    panY,
    mode: VIEWS.includes(view.mode) ? view.mode : "side",
    overlay: OVERLAYS.includes(view.overlay) ? view.overlay : "normal",
    compare: COMPARES.includes(view.compare) ? view.compare : "working",
    wipe: wipe >= 0 && wipe <= 100 ? wipe : 50,
    tool: TOOLS.includes(view.tool) ? view.tool : "pick",
    addSample: view.addSample === true,
    brush: Number.isInteger(brush) && brush >= 1 && brush <= 128 ? brush : 16,
  };
}
function cleanExport(source) {
  const exp = source && typeof source === "object" ? source : {};
  const custom = Number(exp.custom),
    ground = String(exp.ground || "").toUpperCase();
  if (!PRESET_IDS.includes(exp.size) || !FORMATS.includes(exp.format))
    throw Error("A session's export choices are unreadable.");
  if (!Number.isInteger(custom) || custom < CUSTOM_MIN || custom > CUSTOM_MAX)
    throw Error("A session's export choices are unreadable.");
  if (!/^#[\dA-F]{6}$/.test(ground))
    throw Error("A session's export choices are unreadable.");
  // Absent framing fields are the 3.8.0 export: nothing trimmed, no padding,
  // smooth scaling. A present field that is not a real choice is refused.
  if ("trim" in exp && exp.trim != null && typeof exp.trim !== "boolean")
    throw Error("A session's export choices are unreadable.");
  let padding = 0;
  if ("padding" in exp && exp.padding != null) {
    padding = Number(exp.padding);
    if (!Number.isInteger(padding) || padding < 0 || padding > FRAME_PAD_MAX)
      throw Error("A session's export choices are unreadable.");
  }
  let scale = "smooth";
  if ("scale" in exp && exp.scale != null) {
    if (exp.scale !== "smooth" && exp.scale !== "nearest")
      throw Error("A session's export choices are unreadable.");
    scale = exp.scale;
  }
  return {
    size: exp.size,
    format: exp.format,
    custom,
    ground,
    trim: exp.trim === true,
    padding,
    scale,
  };
}
function cleanSvg(source) {
  if (source == null) return null;
  if (typeof source !== "object" || Array.isArray(source))
    throw Error("A session's SVG is unreadable.");
  const edge = Number(source.edge),
    text = source.text;
  if (!SVG_EDGES.includes(edge) || typeof text !== "string")
    throw Error("A session's SVG is unreadable.");
  if (new TextEncoder().encode(text).length > MAX_SVG_BYTES)
    throw Error("SVG files must be 2 MiB or smaller.");
  return { edge, text };
}
function cleanVariant(source) {
  if (source == null) return null;
  if (typeof source !== "object" || Array.isArray(source))
    throw Error("A session's variants are unreadable.");
  if (
    !Array.isArray(source.entries) ||
    source.entries.length < 1 ||
    source.entries.length > MAX_VARIANTS
  )
    throw Error("A session's variants need 1 to 64 colours.");
  return {
    id: String(source.id || "").slice(0, 80),
    label: String(source.label || "").slice(0, 80),
    entries: source.entries.map((entry) => {
      const hex = String(entry?.hex || "").toUpperCase();
      if (!/^#[\dA-F]{6}$/.test(hex))
        throw Error("A session's variant colours must be #RRGGBB.");
      let ramp = null;
      if (entry.ramp != null) {
        if (
          !Array.isArray(entry.ramp) ||
          entry.ramp.length < 1 ||
          entry.ramp.length > 8
        )
          throw Error("A session's variant colours must be #RRGGBB.");
        ramp = entry.ramp.map((v) => {
          const colour = String(v).toUpperCase();
          if (!/^#[\dA-F]{6}$/.test(colour))
            throw Error("A session's variant colours must be #RRGGBB.");
          return colour;
        });
      }
      return {
        label: String(entry.label || hex).slice(0, 80),
        hex,
        ramp,
      };
    }),
  };
}
function cleanDocument(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("A session's image is unreadable.");
  const width = Number(source.width),
    height = Number(source.height),
    original = decodeBytes(source.original, Uint8ClampedArray),
    pixels = decodeBytes(source.pixels, Uint8ClampedArray);
  validateImage(width, height, original);
  validateImage(width, height, pixels);
  const overrides = decodeBytes(source.overrides, Int8Array);
  const rows = cleanRows(source.edit?.rows, width, height),
    active = source.edit?.active;
  validateMap(rows, overrides, active, width, height);
  return {
    name: cleanName(source.name),
    width,
    height,
    still: source.still === true,
    original,
    pixels,
    overrides,
    edit: {
      rows,
      active,
      steps: cleanSteps(source.edit?.steps || [], width, height),
      outline: cleanOutline(source.edit?.outline),
    },
    svg: cleanSvg(source.svg),
    view: cleanView(source.view),
    export: cleanExport(source.export),
    variant: cleanVariant(source.variant),
  };
}

// `documents` are plain records. Typed arrays stay typed here and become base64 in the file.
export function writeSession({ active, documents }) {
  if (!Array.isArray(documents) || documents.length < 1)
    throw Error("A session needs an image.");
  if (documents.length > MAX_DOCUMENTS)
    throw Error("A session can hold " + MAX_DOCUMENTS + " images.");
  if (!Number.isInteger(active) || active < 0 || active >= documents.length)
    throw Error("A session's open tab is unreadable.");
  const data = {
    format: "hexshift-session",
    version: 1,
    active,
    documents: documents.map((doc) => {
      const clean = cleanDocument({
        ...doc,
        original: encodeBytes(doc.original),
        pixels: encodeBytes(doc.pixels),
        overrides: encodeBytes(doc.overrides),
      });
      return {
        name: clean.name,
        width: clean.width,
        height: clean.height,
        still: clean.still,
        original: encodeBytes(clean.original),
        pixels: encodeBytes(clean.pixels),
        overrides: encodeBytes(clean.overrides),
        edit: clean.edit,
        svg: clean.svg,
        view: clean.view,
        export: clean.export,
        variant: clean.variant,
      };
    }),
  };
  const text = JSON.stringify(data, null, 2) + "\n";
  if (new TextEncoder().encode(text).length > MAX_SESSION_BYTES)
    throw Error("A session must be 128 MB or smaller.");
  return text;
}

export function parseSession(text) {
  if (typeof text !== "string") throw Error("A session must be text.");
  if (new TextEncoder().encode(text).length > MAX_SESSION_BYTES)
    throw Error("A session must be 128 MB or smaller.");
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw Error("This file is not a Hex Shift session.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("This file is not a Hex Shift session.");
  if (data.format === "hexshift-recipe")
    throw Error("This is a recipe, not a session.");
  if (data.format !== "hexshift-session")
    throw Error("This file is not a Hex Shift session.");
  if (data.version !== 1)
    throw Error("This session needs a newer version of Hex Shift.");
  if (!Array.isArray(data.documents) || data.documents.length < 1)
    throw Error("A session needs an image.");
  if (data.documents.length > MAX_DOCUMENTS)
    throw Error("A session can hold " + MAX_DOCUMENTS + " images.");
  const documents = data.documents.map(cleanDocument);
  if (
    !Number.isInteger(data.active) ||
    data.active < 0 ||
    data.active >= documents.length
  )
    throw Error("A session's open tab is unreadable.");
  return { active: data.active, documents };
}
