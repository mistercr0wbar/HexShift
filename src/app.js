import {
  defaults,
  parseHex,
  parseColour,
  toHex,
  clamp,
  deltasFor,
} from "./colour.js";
import {
  MAX_ROWS,
  colourFamilies,
  prepare,
  processEdit,
  validateImage,
  validateMap,
} from "./engine.js";
import { History } from "./history.js";
import { decodeBlob } from "./import.js";
import { canEncodeWebP, formatBytes, outputName, safeStem } from "./export.js";
import { deliver } from "./deliver.js";
import { finish, resize, outlineRadius, shrinkSilhouette } from "./output.js";
import {
  PRESETS,
  presetById,
  formatsFor,
  CUSTOM_MIN,
  CUSTOM_MAX,
} from "./presets.js";
import { zip } from "./zip.js";
import {
  SETS,
  MAX_PALETTE_BYTES,
  isPaletteFile,
  parsePalette,
  writeGpl,
} from "./palettes.js";
import {
  MAX_RECIPE_BYTES,
  parseRecipe,
  recipeStep,
  replay,
  writeRecipe,
} from "./recipe.js";
import { screenPicker } from "./host.js";
import sample from "./sample.js";
import { makePause } from "./yield.js";
const $ = (id) => document.getElementById(id),
  pause = makePause();
let w = 0,
  h = 0,
  name = "",
  original = null,
  pixels = null,
  overrides = null,
  result = null,
  // The colour map: rows of { id, params, seeds }; `params` and `seeds` are
  // the active row's. `steps` are the maps applied so far (for recipes).
  edit = freshEdit(),
  params = null,
  seeds = null,
  palette = [],
  recent = [],
  svgSource = null;
let imageId = 0,
  editId = 0,
  ready = false,
  prepared = null,
  worker = null,
  workerFailed = false,
  raf = 0,
  gesture = null,
  tool = "pick",
  addSample = false,
  importId = 0,
  importAbort = null,
  processing = false,
  lastError = null,
  dirty = false;
let zoom = 1,
  fitMode = true,
  panX = 0,
  panY = 0,
  space = false,
  drag = null,
  lastResultEdit = -1,
  lastResultImage = -1;
const history = new History(),
  waiters = new Set(),
  before = $("beforeCanvas"),
  after = $("resultCanvas"),
  wipeCanvas = $("wipeCanvas");
function status(message) {
  $("status").textContent = message;
}
function newRow(id, base = defaults()) {
  return { id, params: base, seeds: [] };
}
function freshEdit(base) {
  return { rows: [newRow(1, base)], active: 0, steps: [] };
}
// Points `params` and `seeds` at the active row.
function activate() {
  edit.active = clamp(edit.active, 0, edit.rows.length - 1);
  ({ params, seeds } = edit.rows[edit.active]);
}
activate();
function meta() {
  return structuredClone({ edit });
}
function snapshot() {
  return { pixels, overrides: overrides.slice(), meta: meta() };
}
function begin() {
  if (pixels && !gesture) gesture = snapshot();
}
function commit(label) {
  if (gesture) {
    history.record(gesture, snapshot(), label);
    gesture = null;
    buttons();
  }
}
function action(label, fn) {
  if (!pixels) return;
  commit("Adjust colour");
  const old = snapshot();
  fn();
  history.record(old, snapshot(), label);
  sync();
  schedule();
}
function wake(error) {
  for (const waiter of waiters) {
    if (error) waiter.reject(error);
    else waiter.resolve();
  }
  waiters.clear();
}
// Segmented choices are radio groups in a fieldset that keeps the old control's
// id; change events bubble up to it, so listeners on the id still fire.
const choice = (id) => $(id).querySelector("input:checked")?.value;
function setChoice(id, value) {
  const input = $(id).querySelector(`input[value="${value}"]`);
  if (input) input.checked = true;
}
function buttons() {
  const available = !!pixels;
  $("undo").disabled = !history.undoEntries.length;
  $("redo").disabled = !history.redoEntries.length;
  $("apply").disabled = !available || processing || !result?.changed;
  $("copy").disabled = !available;
  $("export").disabled = !available;
  $("cancel").hidden = !processing;
  $("batch").disabled = !available || !$("cancelBatch").hidden;
  $("editState").textContent = result?.changed
    ? "Pending edit"
    : "No pending edit";
  $("editState").classList.toggle("pending", !!result?.changed);
}
function makeSlider(parent, key, label, min, max, unit) {
  const box = document.createElement("div");
  box.className = "slider";
  const head = document.createElement("div");
  head.className = "slider-head";
  const lab = document.createElement("label");
  lab.htmlFor = key;
  lab.id = key + "Label";
  lab.textContent = label;
  const number = document.createElement("input");
  number.type = "number";
  number.min = min;
  number.max = max;
  number.step = ["dh", "ds", "dl"].includes(key) ? ".01" : "1";
  number.id = key + "Number";
  number.setAttribute("aria-label", label + " " + unit);
  const range = document.createElement("input");
  range.type = "range";
  range.id = key;
  range.min = min;
  range.max = max;
  range.step = number.step;
  range.setAttribute("aria-label", label);
  head.append(lab, number);
  box.append(head, range);
  $(parent).append(box);
  const update = (value) => {
    begin();
    params[key] = clamp(Number(value) || 0, min, max);
    range.value = number.value = params[key];
    if (["dh", "ds", "dl"].includes(key)) {
      params.manual = true;
      params.ramp = null;
    }
    syncTarget();
    schedule();
  };
  range.addEventListener("input", () => update(range.value));
  number.addEventListener("input", () => update(number.value));
  for (const input of [range, number])
    input.addEventListener("change", () => {
      commit(label);
      sync();
    });
}
for (const args of [
  ["dh", "Hue", -180, 180, "degrees"],
  ["ds", "Saturation", -100, 100, "percent"],
  ["dl", "Lightness", -100, 100, "percent"],
])
  makeSlider("fineControls", ...args);
for (const args of [
  ["hueTol", "Hue tolerance", 0, 180, "degrees"],
  ["shadeTol", "Shade range", 0, 100, "percent"],
  ["soft", "Colour-match softness", 0, 100, "percent"],
  ["feather", "Spatial feather", 0, 8, "pixels"],
])
  makeSlider("selectionSliders", ...args);
function swatch(hex, label, fn) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.style.backgroundColor = hex;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", fn);
  return button;
}
function renderPalette() {
  const box = $("palette");
  box.replaceChildren();
  for (const s of palette)
    box.append(swatch(s.hex, "Pick " + s.hex, () => pick(s.x, s.y)));
}
function renderSeeds() {
  const box = $("seeds");
  box.replaceChildren();
  if (!seeds.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "Nothing picked yet";
    box.append(empty);
    return;
  }
  seeds.forEach((s, index) => {
    const chip = document.createElement("span");
    chip.className = "seed";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.backgroundColor = toHex(
      ...pixels.subarray((s.y * w + s.x) * 4, (s.y * w + s.x) * 4 + 3),
    );
    const text = document.createElement("span");
    text.textContent = toHex(
      ...pixels.subarray((s.y * w + s.x) * 4, (s.y * w + s.x) * 4 + 3),
    );
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove sample " + text.textContent);
    remove.onclick = () =>
      action("Remove sample", () => {
        seeds.splice(index, 1);
        targetDeltas();
      });
    chip.append(dot, text, remove);
    box.append(chip);
  });
}
// The colour map: one row per colour being changed. The controls above edit
// the active row.
const seedHex = (s) =>
  s.hex ||
  toHex(...pixels.subarray((s.y * w + s.x) * 4, (s.y * w + s.x) * 4 + 3));
function rowText(row) {
  const brushed = overrides?.some((v) => v === row.id),
    from = row.seeds.length
      ? seedHex(row.seeds.at(-1))
      : brushed
        ? "brushed"
        : null,
    p = row.params,
    to =
      p.mode === "transparent"
        ? "transparent"
        : p.mode === "shift" && !p.ramp && !p.dh && !p.ds && !p.dl
          ? "unchanged"
          : p.mode === "shift" && p.manual
            ? "adjusted"
            : p.ramp
              ? p.ramp[0]
              : p.target;
  return { from, to };
}
function renderMap() {
  if (!pixels) return;
  const box = $("colourMap");
  box.replaceChildren();
  edit.rows.forEach((row, k) => {
    const item = document.createElement("div"),
      select = document.createElement("button"),
      { from, to } = rowText(row),
      chip = (hex, kind) => {
        const c = document.createElement("span");
        c.className = "chip" + (kind ? " " + kind : "");
        if (hex) c.style.backgroundColor = hex;
        return c;
      },
      text = document.createElement("span"),
      count = document.createElement("span"),
      pixelsOwned = result?.counts?.[k];
    item.className = "map-row" + (k === edit.active ? " active" : "");
    select.type = "button";
    select.className = "map-select";
    select.setAttribute("aria-pressed", String(k === edit.active));
    text.className = "map-text";
    text.textContent = from ? from + " → " + to : "Pick a colour";
    count.className = "map-count";
    count.textContent =
      from && Number.isInteger(pixelsOwned)
        ? pixelsOwned.toLocaleString() + " px"
        : "";
    select.setAttribute(
      "aria-label",
      "Colour " +
        (k + 1) +
        ": " +
        (from ? from + " to " + to : "nothing picked yet") +
        (count.textContent
          ? ", " + count.textContent.replace("px", "pixels")
          : ""),
    );
    select.append(
      chip(from?.startsWith("#") ? from : null, from ? "" : "empty"),
      text,
      chip(
        to.startsWith("#") ? to : to === "unchanged" ? from : null,
        to === "transparent" ? "clear" : "",
      ),
      count,
    );
    select.onclick = () => selectRow(k);
    item.append(select);
    if (edit.rows.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "map-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove colour " + (k + 1));
      remove.onclick = () => removeRow(k);
      item.append(remove);
    }
    box.append(item);
  });
  $("addRow").disabled = edit.rows.length >= MAX_ROWS;
}
function selectRow(k) {
  if (k === edit.active) return;
  commit("Adjust colour");
  edit.active = k;
  activate();
  sync();
  schedule();
}
function addRow() {
  if (!pixels || edit.rows.length >= MAX_ROWS) return;
  const used = new Set(edit.rows.map((r) => r.id));
  let id = 1;
  while (used.has(id)) id++;
  action("Add colour", () => {
    edit.rows.push(newRow(id, { ...defaults(), model: params.model }));
    edit.active = edit.rows.length - 1;
    activate();
  });
  status("Added a colour. Click the part of the image to change.");
}
function removeRow(k) {
  action("Remove colour", () => {
    const { id } = edit.rows[k];
    edit.rows.splice(k, 1);
    for (let i = 0; i < overrides.length; i++)
      if (overrides[i] === id) overrides[i] = 0;
    if (edit.active > k || edit.active === edit.rows.length) edit.active--;
    activate();
  });
}
// One row per colour family, each set to keep its own colour until changed.
async function mapAll() {
  if (!pixels) return;
  commit("Adjust colour");
  try {
    const families = colourFamilies(await variantImage());
    if (!families.length) {
      status("There are no colours to map in this image.");
      return;
    }
    action("Map all colours", () => {
      edit.rows = families.map((f, k) => {
        const row = newRow(k + 1, {
          ...defaults(),
          model: params.model,
          target: f.hex,
          shadeTol: f.grey ? 60 : 100,
        });
        row.seeds.push({ x: f.x, y: f.y });
        return row;
      });
      edit.active = 0;
      overrides.fill(0);
      activate();
    });
    status(
      "Mapped " +
        families.length +
        (families.length === 1 ? " colour family" : " colour families") +
        ". Choose one, then set its new colour.",
    );
  } catch (e) {
    status("Could not map the colours: " + e.message);
  }
}
function rememberTarget(hex) {
  if (!parseHex(hex)) return;
  recent = [hex, ...recent.filter((v) => v !== hex)].slice(0, 8);
  $("recentGroup").hidden = false;
  $("recent").replaceChildren(
    ...recent.map((value) =>
      swatch(value, "Use " + value, () => setTarget(value)),
    ),
  );
}
// Discord's button colours: target presets and real-size preview grounds.
const DISCORD_BUTTONS = [
  ["Primary", "#5865F2"],
  ["Secondary", "#4E5058"],
  ["Success", "#248046"],
  ["Danger", "#DA373C"],
];
// Palettes: the built-in sets plus any opened or pasted this session (kept in
// memory only, like images).
const paletteSets = SETS.map((set) => ({ ...set }));
let userSets = 0;
function addSetOption(set) {
  const option = document.createElement("option");
  option.value = set.id;
  option.textContent = set.label;
  $("paletteSet").append(option);
}
for (const set of paletteSets) addSetOption(set);
const currentSet = () =>
  paletteSets.find((set) => set.id === $("paletteSet").value) || paletteSets[0];
function useEntry(entry) {
  if (entry.ramp) setRamp(entry.ramp);
  else setTarget(entry.hex);
}
function renderSet() {
  const set = currentSet(),
    named =
      set.entries.length <= 8 && set.entries.some((e) => e.label !== e.hex),
    box = $("presets");
  box.className = "swatches" + (named ? " named" : "");
  box.replaceChildren(
    ...set.entries.map((entry) => {
      const b = swatch(
        entry.hex,
        entry.label +
          " " +
          (entry.ramp
            ? entry.ramp.join(" ")
            : entry.label === entry.hex
              ? ""
              : entry.hex),
        () => useEntry(entry),
      );
      if (entry.ramp)
        b.style.background =
          "linear-gradient(135deg, " + entry.ramp.join(", ") + ")";
      if (named) {
        const text = document.createElement("span");
        text.textContent = entry.label;
        b.append(text);
      }
      return b;
    }),
  );
  clearVariants();
}
$("paletteSet").onchange = renderSet;
// Typed colours: hex, rgb() and hsl() directly; colour names and newer CSS
// syntax through the browser's own parser (opaque colours only).
const probe = document
  .createElement("canvas")
  .getContext("2d", { willReadFrequently: true });
function readColour(value) {
  const direct = parseColour(value);
  if (direct) return direct;
  const text = String(value).trim();
  if (
    !text ||
    text.length > 64 ||
    /^(currentcolor|inherit|initial|unset|revert)/i.test(text) ||
    !CSS.supports("color", text)
  )
    return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = text;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a === 255 ? [r, g, b] : null;
}
// Deltas that move the last sample onto `hex` in `model`, or null without one.
function deltasTo(hex, model) {
  if (!seeds.length) return null;
  const sd = seeds.at(-1),
    o = (sd.y * w + sd.x) * 4;
  return deltasFor([...pixels.subarray(o, o + 3)], parseHex(hex), model);
}
function targetDeltas() {
  if (params.manual) return;
  const deltas = deltasTo(params.target, params.model);
  if (deltas) Object.assign(params, deltas);
}
function syncTarget() {
  const transparent = params.mode === "transparent";
  $("targetControls").hidden = transparent;
  $("fine").hidden = params.mode !== "shift";
  $("protectLabel").hidden = params.mode !== "shift";
  $("cleanEdgesLabel").hidden = !transparent;
  const dsName = params.model === "hsl" ? "Saturation" : "Chroma";
  $("dsLabel").textContent = dsName;
  $("ds").setAttribute("aria-label", dsName);
  $("dsNumber").setAttribute("aria-label", dsName + " percent");
  $("targetColour").value = params.target;
  if (document.activeElement !== $("targetHex"))
    $("targetHex").value = params.target;
}
function sync() {
  for (const key of [
    "hueTol",
    "shadeTol",
    "soft",
    "feather",
    "dh",
    "ds",
    "dl",
  ]) {
    if (document.activeElement !== $(key)) $(key).value = params[key];
    if (document.activeElement !== $(key + "Number"))
      $(key + "Number").value = Math.round(params[key] * 100) / 100;
  }
  setChoice("mode", params.mode);
  setChoice("model", params.model);
  $("connected").checked = params.connected;
  $("protect").checked = params.protect;
  $("cleanEdges").checked = params.cleanEdges;
  syncTarget();
  renderSeeds();
  renderMap();
  buttons();
}
function setTarget(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return;
  action("Target colour", () => {
    params.target = toHex(...rgb);
    params.ramp = null;
    params.manual = false;
    targetDeltas();
  });
  rememberTarget(params.target);
}
function setRamp(ramp) {
  action("Skin tone", () => {
    params.ramp = ramp.slice();
    params.target = ramp[0];
    params.mode = params.mode === "transparent" ? "shift" : params.mode;
    params.manual = false;
    targetDeltas();
  });
  rememberTarget(params.target);
}
function pick(x, y) {
  if (!pixels) return;
  const o = (y * w + x) * 4;
  if (!pixels[o + 3]) {
    status("That pixel is transparent. Pick an opaque part of the asset.");
    return;
  }
  action("Pick colour", () => {
    if (!addSample && !space) seeds.length = 0;
    if (!seeds.some((s) => s.x === x && s.y === y)) {
      if (seeds.length >= 64) {
        status("Use up to 64 colour samples.");
        return;
      }
      seeds.push({ x, y });
    }
    params.manual = false;
    targetDeltas();
  });
  status(
    "Picked " +
      toHex(...pixels.subarray(o, o + 3)) +
      ". Adjust the target or refine the selection.",
  );
}
function startWorker() {
  let url;
  try {
    url = URL.createObjectURL(
      new Blob([__WORKER__], { type: "text/javascript" }),
    );
    worker = new Worker(url);
    worker.onmessage = ({ data: m }) => receive(m);
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      workerFailed = true;
      status("Using the local processing fallback.");
      if (pixels) prepareCurrent();
    };
  } catch {
    workerFailed = true;
    worker = null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
function prepareCurrent() {
  if (!pixels) return;
  imageId++;
  editId++;
  ready = false;
  processing = true;
  result = null;
  lastError = null;
  prepared = null;
  const iid = imageId,
    eid = editId;
  validateImage(w, h, pixels);
  buttons();
  if (worker) {
    const copy = pixels.slice();
    worker.postMessage(
      {
        type: "image",
        imageId: iid,
        editId: eid,
        width: w,
        height: h,
        pixels: copy,
      },
      [copy.buffer],
    );
  } else
    prepare(w, h, pixels, pause, () => iid !== imageId)
      .then((im) => {
        if (iid !== imageId) return;
        prepared = im;
        receive({
          type: "ready",
          imageId: iid,
          editId: eid,
          palette: im.palette,
        });
      })
      .catch((e) => {
        if (iid === imageId)
          receive({
            type: "error",
            imageId: iid,
            editId: editId,
            message: e.message,
          });
      });
}
function schedule() {
  if (!pixels) return;
  if (!ready && lastError) {
    prepareCurrent();
    return;
  }
  editId++;
  lastError = null;
  processing = true;
  buttons();
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(sendEdit);
}
function sendEdit() {
  raf = 0;
  if (!pixels || !ready) return;
  const iid = imageId,
    eid = editId;
  try {
    validateMap(edit.rows, overrides, edit.active, w, h);
    const copy = overrides.slice();
    if (worker)
      worker.postMessage(
        {
          type: "edit",
          imageId: iid,
          editId: eid,
          rows: structuredClone(edit.rows),
          active: edit.active,
          overrides: copy,
        },
        [copy.buffer],
      );
    else
      processEdit(
        prepared,
        structuredClone(edit.rows),
        copy,
        edit.active,
        pause,
        () => iid !== imageId || eid !== editId,
      )
        .then((r) =>
          receive({ type: "result", imageId: iid, editId: eid, ...r }),
        )
        .catch((e) => {
          if (iid === imageId && eid === editId)
            receive({
              type: "error",
              imageId: iid,
              editId: eid,
              message: e.message,
            });
        });
  } catch (e) {
    receive({ type: "error", imageId: iid, editId: eid, message: e.message });
  }
}
function receive(m) {
  if (m.imageId !== imageId) return;
  if (m.type === "ready") {
    ready = true;
    palette = m.palette;
    renderPalette();
    schedule();
    return;
  }
  if (m.editId !== editId) return;
  processing = false;
  if (m.type === "error") {
    lastError = Error(m.message);
    status("Could not process this edit: " + m.message);
    buttons();
    wake(lastError);
    return;
  }
  if (
    m.type !== "result" ||
    !(m.pixels instanceof Uint8ClampedArray) ||
    m.pixels.length !== w * h * 4 ||
    !(m.mask instanceof Float32Array) ||
    m.mask.length !== w * h
  )
    return;
  result = m;
  lastResultEdit = m.editId;
  lastResultImage = m.imageId;
  $("coverage").textContent = m.count
    ? m.count.toLocaleString() +
      " pixels selected · " +
      Math.round((m.count / Math.max(1, m.opaque)) * 100) +
      "% of the asset"
    : seeds.length
      ? "No matching pixels. Increase tolerance, or add a sample."
      : "Click a colour or choose an image swatch.";
  $("resultNote").textContent = m.changed
    ? m.changed.toLocaleString() + " px changed"
    : "";
  if (seeds.length) {
    const sd = seeds.at(-1),
      o = (sd.y * w + sd.x) * 4;
    $("targetResult").textContent =
      params.mode === "transparent"
        ? "Selected pixels become transparent."
        : (params.manual && params.mode === "shift"
            ? "Manual shift"
            : params.ramp && params.mode === "shift"
              ? "Tone " + params.ramp.join(" · ")
              : "Requested " + params.target) +
          " · achieved " +
          toHex(...m.pixels.subarray(o, o + 3));
  } else $("targetResult").textContent = "Pick a source colour to begin.";
  $("capWarning").hidden = !(m.capped && params.mode === "shift");
  renderMap();
  draw();
  buttons();
  wake();
}
async function latest() {
  if (lastError) throw lastError;
  while (
    processing ||
    lastResultEdit !== editId ||
    lastResultImage !== imageId
  ) {
    await new Promise((resolve, reject) => waiters.add({ resolve, reject }));
    if (lastError) throw lastError;
  }
  if (!result) throw Error("No preview is available.");
  return result;
}
function cancelProcessing() {
  if (!processing) return;
  editId++;
  if (!ready) imageId++;
  if (worker) worker.postMessage({ type: "cancel", imageId, editId });
  processing = false;
  lastError = Error("Processing cancelled. Change a setting to resume.");
  wake(lastError);
  status(lastError.message);
  buttons();
}
const dialogText = {
  open: [
    "Open another image?",
    "Your current image has edits. Export it first if you want to keep them.",
    "Open new image",
  ],
  redraw: [
    "Redraw the SVG at a new size?",
    "Redrawing starts again from the SVG file, so your edits are cleared. Export first if you want to keep them.",
    "Redraw",
  ],
};
// Resolves true once the image is open. `redraw` reopens the current SVG at
// the size chosen under "SVG drawn at".
async function openBlob(blob, fileName, isSample = false, redraw = false) {
  const ticket = ++importId;
  importAbort?.abort();
  const controller = new AbortController();
  importAbort = controller;
  status(redraw ? "Redrawing SVG…" : "Checking image…");
  try {
    const edge = Number($("svgSize").value),
      decoded = await decodeBlob(blob, controller.signal, { svgEdge: edge });
    if (ticket !== importId) return false;
    if (!isSample && pixels && (dirty || result?.changed)) {
      const dialog = $("replaceDialog");
      if (dialog.open) {
        const closed = new Promise((resolve) =>
          dialog.addEventListener("close", resolve, { once: true }),
        );
        dialog.close("cancel");
        await closed;
      }
      if (ticket !== importId) return false;
      [
        $("replaceTitle").textContent,
        $("replaceText").textContent,
        $("replaceConfirm").textContent,
      ] = dialogText[redraw ? "redraw" : "open"];
      dialog.showModal();
      const choice = await new Promise((resolve) =>
        dialog.addEventListener("close", () => resolve(dialog.returnValue), {
          once: true,
        }),
      );
      if (ticket !== importId || choice !== "replace") {
        if (ticket === importId)
          status(
            redraw ? "Kept the current drawing." : "Kept the current image.",
          );
        return false;
      }
    }
    commit("Adjust colour");
    w = decoded.width;
    h = decoded.height;
    name = String(fileName || "image").slice(0, 200);
    svgSource = decoded.svg ? { blob, name, edge } : null;
    $("svgSizeGroup").hidden = !svgSource;
    original = decoded.pixels;
    pixels = original.slice();
    overrides = new Int8Array(w * h);
    edit = freshEdit();
    activate();
    dirty = false;
    history.clear();
    gesture = null;
    for (const canvas of [before, after, wipeCanvas]) {
      canvas.width = w;
      canvas.height = h;
    }
    panX = panY = 0;
    fitMode = true;
    $("fileName").textContent = name;
    $("fileDims").textContent =
      w + " × " + h + (decoded.still ? " · first frame" : "");
    sync();
    prepareCurrent();
    layout();
    outlineControls();
    status(
      isSample
        ? "Sample ready. Pick a colour to get started."
        : redraw
          ? "Redrew " + name + " at " + edge + " px."
          : "Opened " + name + (decoded.still ? " as a still image." : "."),
    );
    return true;
  } catch (e) {
    if (ticket === importId && e.name !== "AbortError")
      status("Could not open image: " + e.message);
    return false;
  } finally {
    if (ticket === importId) importAbort = null;
  }
}
function restore(redo) {
  commit("Adjust colour");
  const moved = history.move({ pixels, overrides }, redo);
  if (!moved) return;
  edit = moved.meta.edit;
  activate();
  dirty = true;
  sync();
  if (moved.pixelsChanged) prepareCurrent();
  else schedule();
  status((redo ? "Redid " : "Undid ") + moved.label + ".");
}
async function apply() {
  try {
    commit("Adjust colour");
    const r = await latest();
    if (!r.changed) return;
    const old = snapshot(),
      step = recipeStep(edit.rows, pixels, w, overrides);
    pixels = r.pixels.slice();
    overrides = new Int8Array(w * h);
    edit = {
      rows: [newRow(1, { ...params, dh: 0, ds: 0, dl: 0, manual: false })],
      active: 0,
      steps: [...edit.steps, step],
    };
    activate();
    dirty = true;
    history.record(old, snapshot(), "Apply colours");
    sync();
    prepareCurrent();
    status("Applied. Pick the next colour to build on this, or export.");
  } catch (e) {
    status(e.message);
  }
}
function reset() {
  action("Reset original", () => {
    pixels = original.slice();
    overrides = new Int8Array(w * h);
    edit = freshEdit();
    activate();
    dirty = false;
    prepareCurrent();
  });
  status("Original restored. Undo is available.");
}
async function save(copy = false) {
  const button = copy ? $("copy") : $("export");
  if (button.dataset.busy) return;
  button.dataset.busy = "true";
  try {
    commit("Adjust colour");
    const r = await latest(),
      revision = editId,
      iid = imageId;
    status(copy ? "Preparing clipboard image…" : "Encoding image…");
    const settings = finishSettings();
    if (copy) {
      if (!navigator.clipboard?.write || !window.ClipboardItem)
        throw Error("Clipboard is unavailable here. Use Export.");
      // A pack copies its first (largest) image.
      const blobPromise = deliver(r.pixels, w, h, settings, pause, {
        first: true,
        format: "png",
      }).then((files) => files[0].blob);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      status("PNG copied to clipboard.");
    } else {
      const files = await deliver(r.pixels, w, h, settings, pause);
      if (iid !== imageId || revision !== editId)
        throw Error(
          "The image changed during export. Export again to save the latest edit.",
        );
      // Named after the target colour when there is just one; "shifted" for
      // a map of several colours or a recipe.
      const tag =
          edit.rows.length === 1 && !edit.steps.length ? params.target : null,
        pack = files.length > 1,
        named = files.map((f) => ({
          name: outputName(name, f.format, tag, f.suffix),
          blob: f.blob,
        })),
        blob = pack ? await zip(named) : named[0].blob,
        filename = pack
          ? outputName(name, "zip", tag, settings.size)
          : named[0].name,
        over = files.filter((f) => f.limit && f.blob.size > f.limit);
      download(blob, filename);
      status(
        "Prepared " +
          filename +
          " (" +
          formatBytes(blob.size) +
          "). " +
          (over.length
            ? "It is over the " +
              presetById(settings.size).label.split(" · ")[0] +
              " size limit. "
            : "") +
          "Choose where to save it.",
      );
    }
  } catch (e) {
    status((copy ? "Copy failed: " : "Export failed: ") + e.message);
  } finally {
    delete button.dataset.busy;
    buttons();
  }
}
// Hands a file to the browser's download (Save As in the Windows app).
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
function displayPixels(data, selection) {
  const out = new Uint8ClampedArray(data),
    overlay = choice("overlay");
  if (selection && result && overlay !== "normal") {
    const [tr, tg, tb] = overlayTint();
    for (let i = 0; i < w * h; i++) {
      const o = i * 4,
        t = result.mask[i];
      if (overlay === "only") out[o + 3] = out[o + 3] * t;
      else if (t > 0) {
        out[o] = out[o] * (1 - 0.35 * t) + tr * 0.35 * t;
        out[o + 1] = out[o + 1] * (1 - 0.35 * t) + tg * 0.35 * t;
        out[o + 2] = out[o + 2] * (1 - 0.35 * t) + tb * 0.35 * t;
      }
    }
  }
  return out;
}
// The selection tint is the brand cyan or orange, whichever is further in hue
// from the colour being selected, so it never disappears into it.
function overlayTint() {
  const cyan = [110, 240, 255],
    orange = [232, 128, 46],
    row = edit?.rows?.[edit.active],
    from = row ? rowText(row).from : null,
    rgb = from?.startsWith("#") ? parseHex(from) : null;
  if (!rgb) return cyan;
  const [r, g, b] = rgb.map((v) => v / 255),
    max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  if (d < 0.08) return cyan;
  const hue =
    (max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4) * 60;
  const gap = (a) => Math.min(Math.abs(hue - a), 360 - Math.abs(hue - a));
  return gap(187) >= gap(26) ? cyan : orange;
}
function draw() {
  if (!pixels) return;
  const source = $("compare").value === "original" ? original : pixels;
  before
    .getContext("2d")
    .putImageData(new ImageData(displayPixels(source, true), w, h), 0, 0);
  if (result)
    after
      .getContext("2d")
      .putImageData(
        new ImageData(
          displayPixels(result.pixels, choice("view") !== "side"),
          w,
          h,
        ),
        0,
        0,
      );
  else
    after
      .getContext("2d")
      .putImageData(new ImageData(pixels.slice(), w, h), 0, 0);
  wipeCanvas
    .getContext("2d")
    .putImageData(new ImageData(source.slice(), w, h), 0, 0);
  $("beforeLabel").textContent = $("compare").selectedOptions[0].textContent;
  wipeCanvas.style.clipPath =
    "inset(0 " + (100 - Number($("wipe").value)) + "% 0 0)";
  renderPreview();
  scheduleReadout();
  markVariants();
}
// Export finishing settings. UI-only: not part of the edit history.
function finishSettings() {
  const settings = {
    size: $("size").value,
    format: $("format").value,
    custom: Number($("customSize").value),
  };
  if ($("outline").checked)
    settings.outline = {
      widthPct: Number($("outlineWidth").value),
      colour: toHex(...(readColour($("outlineHex").value) || [255, 255, 255])),
    };
  return settings;
}
const PREVIEW_SIZES = [16, 24, 32, 48, 96],
  previewGrounds = [
    ["Dark chat", "#313338"],
    ["Light chat", "#FFFFFF"],
    ...DISCORD_BUTTONS.map(([label, hex]) => [label + " button", hex]),
  ];
for (const [label, hex] of previewGrounds) {
  const option = document.createElement("option");
  option.value = hex;
  option.textContent = label;
  $("previewGround").append(option);
}
const previewCanvases = PREVIEW_SIZES.map((size) => {
  const tile = document.createElement("div"),
    canvas = document.createElement("canvas");
  tile.className = "preview-tile";
  canvas.style.width = canvas.style.height = size + "px";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Result at " + size + " pixels");
  tile.append(canvas);
  $("previewTiles").append(tile);
  return canvas;
});
let previewTicket = 0;
// The preview runs the export pipeline on a copy capped at 256 px (the outline
// width is relative, so it matches), then box-filters it to each tile size.
async function renderPreview() {
  const ticket = ++previewTicket,
    ground = $("previewGround").value;
  for (const canvas of previewCanvases)
    canvas.parentElement.style.backgroundColor = ground;
  if (!pixels) return;
  const source = result?.pixels || pixels,
    scale = Math.min(1, 256 / Math.max(w, h)),
    bw = Math.max(1, Math.round(w * scale)),
    bh = Math.max(1, Math.round(h * scale));
  let base;
  try {
    base = await finish(
      resize(source, w, h, bw, bh),
      bw,
      bh,
      finishSettings(),
      undefined,
      scale < 1 ? shrinkSilhouette(source, w, h, bw, bh) : undefined,
    );
  } catch {
    return;
  }
  if (ticket !== previewTicket) return;
  const dpr = window.devicePixelRatio || 1;
  PREVIEW_SIZES.forEach((size, k) => {
    const canvas = previewCanvases[k],
      box = Math.round(size * dpr),
      fit = box / Math.max(base.width, base.height),
      tw = Math.max(1, Math.round(base.width * fit)),
      th = Math.max(1, Math.round(base.height * fit));
    canvas.width = canvas.height = box;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(
          resize(base.pixels, base.width, base.height, tw, th),
          tw,
          th,
        ),
        (box - tw) >> 1,
        (box - th) >> 1,
      );
  });
}
function outlineControls() {
  const pct = Number($("outlineWidth").value),
    px = w ? outlineRadius(w, h, pct) : 0;
  $("outlineWidthValue").textContent =
    pct + "%" + (w ? " · " + Math.round(px * 10) / 10 + " px here" : "");
  renderPreview();
  scheduleReadout();
}
$("outline").onchange = outlineControls;
$("outlineWidth").oninput = outlineControls;
$("outlineColour").oninput = (e) => {
  $("outlineHex").value = e.target.value.toUpperCase();
  outlineControls();
};
$("outlineHex").addEventListener("input", (e) => {
  const rgb = readColour(e.target.value);
  e.target.setAttribute("aria-invalid", String(!rgb));
  if (rgb) {
    $("outlineColour").value = toHex(...rgb).toLowerCase();
    outlineControls();
  }
});
for (const [label, hex] of [
  ["White", "#FFFFFF"],
  ["Black", "#000000"],
])
  $("outlineSwatches").append(
    swatch(hex, label + " outline", () => {
      $("outlineHex").value = hex;
      $("outlineColour").value = hex.toLowerCase();
      $("outline").checked = true;
      outlineControls();
    }),
  );
$("previewGround").onchange = renderPreview;
const FORMAT_NAMES = {
    png: "PNG",
    webp: "WebP",
    "webp-small": "WebP",
    zip: "ZIP",
  },
  FORMAT_LABELS = {
    png: "PNG",
    webp: "lossless WebP",
    "webp-small": "small WebP",
  };
for (const preset of PRESETS) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.label;
  $("size").append(option);
}
if (!canEncodeWebP())
  $("format").querySelector('[value="webp-small"]').textContent +=
    " · not in this browser";
let chosenFormat = "png";
// The format list follows the size: a platform may accept only some formats,
// and a pack (several files) sets its own.
function sizeControls() {
  const preset = presetById($("size").value),
    allowed = formatsFor(preset).filter(
      (f) => f !== "webp-small" || canEncodeWebP(),
    ),
    select = $("format");
  for (const option of select.options)
    option.disabled = !allowed.includes(option.value);
  select.value = !allowed.length
    ? "zip"
    : allowed.includes(chosenFormat)
      ? chosenFormat
      : allowed[0];
  select.disabled = allowed.length < 2;
  $("customSizeGroup").hidden = preset.id !== "custom";
  $("export").textContent = "Export " + FORMAT_NAMES[select.value];
  scheduleReadout();
}
$("size").onchange = sizeControls;
$("format").onchange = () => {
  chosenFormat = $("format").value;
  sizeControls();
};
$("customSize").oninput = (e) => {
  const v = Number(e.target.value);
  e.target.setAttribute(
    "aria-invalid",
    String(!(Number.isInteger(v) && v >= CUSTOM_MIN && v <= CUSTOM_MAX)),
  );
  scheduleReadout();
};
$("svgSize").onchange = async () => {
  const previous = svgSource;
  if (!previous) return;
  if (
    !(await openBlob(previous.blob, previous.name, false, true)) &&
    svgSource === previous
  )
    $("svgSize").value = String(previous.edge);
};
let readoutTicket = 0,
  readoutTimer = 0;
function scheduleReadout() {
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(sizeReadout, 300);
}
// Runs the real export pipeline, so the sizes shown are the sizes saved.
async function sizeReadout() {
  const ticket = ++readoutTicket,
    box = $("sizeReadout"),
    line = (text, over) => {
      const p = document.createElement("p");
      p.textContent = text;
      if (over) p.className = "over";
      return p;
    };
  if (!pixels) return;
  const settings = finishSettings();
  if (settings.size === "original" && w * h > 1048576) {
    box.replaceChildren(
      line("Original size · the file size is shown when you export."),
    );
    return;
  }
  let files;
  try {
    files = await deliver(result?.pixels || pixels, w, h, settings, pause);
  } catch (e) {
    if (ticket === readoutTicket) box.replaceChildren(line(e.message, true));
    return;
  }
  if (ticket !== readoutTicket) return;
  const lines = files.map((f) => {
    const over = f.limit && f.blob.size > f.limit;
    return line(
      f.width +
        " × " +
        f.height +
        " " +
        FORMAT_LABELS[f.format] +
        " · " +
        formatBytes(f.blob.size) +
        (f.limit
          ? (over ? " · over the " : " of ") +
            formatBytes(f.limit) +
            (over ? " limit" : "")
          : ""),
      over,
    );
  });
  if (files.length > 1) lines.unshift(line("Saved together as one ZIP:"));
  if (files.some((f) => f.enlarged))
    lines.push(
      line(
        "Enlarged from a smaller image, so it may look soft." +
          (svgSource ? " Draw the SVG larger for a sharper result." : ""),
      ),
    );
  box.replaceChildren(...lines);
}
sizeControls();
// `source` is a File or pasted text.
async function openPalette(source, label) {
  try {
    if (typeof source !== "string" && source.size > MAX_PALETTE_BYTES)
      throw Error("Palette files must be 256 KB or smaller.");
    const entries = parsePalette(
        typeof source === "string" ? source : await source.text(),
      ),
      set = {
        id: "user-" + ++userSets,
        label:
          String(label || "Palette")
            .replace(/\.[^.]*$/, "")
            .slice(0, 60) || "Palette",
        entries,
      };
    paletteSets.push(set);
    addSetOption(set);
    $("paletteSet").value = set.id;
    $("palettePanel").open = true;
    renderSet();
    status(
      "Opened " +
        set.label +
        " with " +
        entries.length +
        (entries.length === 1 ? " colour." : " colours."),
    );
  } catch (e) {
    status("Could not open palette: " + e.message);
  }
}
$("openPalette").onclick = () => $("paletteInput").click();
$("paletteInput").onchange = (e) => {
  const f = e.target.files[0];
  if (f) openPalette(f, f.name);
  e.target.value = "";
};
// Skin tones are saved with every colour of each tone.
$("savePalette").onclick = () => {
  const set = currentSet(),
    entries = set.entries.flatMap((e) =>
      e.ramp
        ? e.ramp.map((hex, i) => ({
            hex,
            label: e.label + (i ? " shade " + i : ""),
          }))
        : [e],
    ),
    filename = safeStem(set.label.replace(/ · /g, " ")) + ".gpl";
  download(
    new Blob([writeGpl(set.label, entries)], {
      type: "application/x-gimp-palette",
    }),
    filename,
  );
  status("Prepared " + filename + ". Choose where to save it.");
};
// Picking a colour from the screen. The Windows app shows its own picker, because
// WebView2 cancels the browser's EyeDropper before it opens; elsewhere EyeDropper
// does it. A cancel is reported too, so the button never seems to do nothing.
function screenPicked(hex) {
  const rgb = typeof hex === "string" ? readColour(hex) : null;
  if (rgb) setTarget(toHex(...rgb));
  else status("No colour was picked.");
}
const pickFromScreen = screenPicker(screenPicked, (e) =>
  status("Could not pick from the screen: " + e.message),
);
if (pickFromScreen) {
  $("eyeDropper").hidden = false;
  $("eyeDropper").onclick = pickFromScreen;
}
// Variants: the current selection and treatment once per palette colour (a
// tone's ramp for skin tones). Each uses the same steps as clicking that
// colour, so a variant matches the edit it previews byte for byte.
const MAX_VARIANTS = 64;
let variantRun = 0,
  variantsKey = null,
  mainImage = null;
function variantParams(entry) {
  const p = structuredClone(params);
  p.ramp = entry.ramp ? entry.ramp.slice() : null;
  p.target = entry.ramp ? entry.ramp[0] : entry.hex;
  p.manual = false;
  Object.assign(p, deltasTo(p.target, p.model) || {});
  return p;
}
// The colour map with the active row given a variant's colour.
function variantRows(p) {
  return structuredClone(
    edit.rows.map((row, k) =>
      k === edit.active ? { ...row, params: p } : row,
    ),
  );
}
// What a variant depends on, apart from its colour.
function selectionKey() {
  let sum = 0;
  for (let i = 0; i < overrides.length; i++)
    if (overrides[i]) sum = (sum * 31 + (i + 1) * overrides[i]) % 2147483647;
  const { target, ramp, dh, ds, dl, manual, ...rest } = params,
    others = edit.rows.filter((_, k) => k !== edit.active);
  return JSON.stringify([imageId, seeds, rest, others, sum]);
}
// A main-thread copy of the prepared image for variants (the worker keeps its own).
async function variantImage() {
  if (prepared && !worker) return prepared;
  if (mainImage?.id !== imageId)
    mainImage = { id: imageId, image: await prepare(w, h, pixels, pause) };
  return mainImage.image;
}
function clearVariants() {
  variantRun++;
  variantsKey = null;
  $("variants").hidden =
    $("exportVariants").hidden =
    $("variantsNote").hidden =
      true;
  $("variants").replaceChildren();
}
function markVariants() {
  $("makeVariants").disabled = !pixels || params.mode === "transparent";
  if (variantsKey === null) return;
  const stale = selectionKey() !== variantsKey;
  $("variants").classList.toggle("stale", stale);
  $("variantsNote").hidden = !stale;
  $("variantsNote").textContent =
    "The selection or treatment changed. Make variants again to update the previews; export always uses the current selection.";
}
async function makeVariants() {
  const run = ++variantRun,
    entries = currentSet().entries.slice(0, MAX_VARIANTS);
  commit("Adjust colour");
  try {
    const image = await variantImage(),
      key = selectionKey(),
      dpr = window.devicePixelRatio || 1,
      box = Math.round(56 * dpr),
      fit = box / Math.max(w, h),
      tw = Math.max(1, Math.round(w * fit)),
      th = Math.max(1, Math.round(h * fit));
    if (run !== variantRun) return;
    const tiles = entries.map((entry) => {
      const tile = document.createElement("button"),
        canvas = document.createElement("canvas"),
        label = document.createElement("span");
      tile.type = "button";
      tile.className = "variant";
      tile.title = "Use " + entry.label;
      canvas.width = canvas.height = box;
      canvas.setAttribute("aria-hidden", "true");
      label.textContent = entry.label;
      tile.append(canvas, label);
      tile.onclick = () => useEntry(entry);
      return { tile, canvas, entry };
    });
    $("variants").replaceChildren(...tiles.map((t) => t.tile));
    $("variants").classList.remove("stale");
    $("variants").hidden = false;
    $("variantsNote").hidden = true;
    variantsKey = key;
    status("Making " + entries.length + " variants…");
    for (const { canvas, entry } of tiles) {
      const r = await processEdit(
        image,
        variantRows(variantParams(entry)),
        overrides.slice(),
        edit.active,
        pause,
        () => run !== variantRun,
      );
      if (run !== variantRun) return;
      canvas
        .getContext("2d")
        .putImageData(
          new ImageData(resize(r.pixels, w, h, tw, th), tw, th),
          (box - tw) >> 1,
          (box - th) >> 1,
        );
    }
    $("exportVariants").hidden = false;
    status(
      "Made " +
        entries.length +
        " variants. Click one to use it, or export them all.",
    );
  } catch (e) {
    if (run === variantRun) status("Could not make variants: " + e.message);
  }
}
async function exportVariants() {
  const button = $("exportVariants");
  if (button.dataset.busy) return;
  button.dataset.busy = "true";
  try {
    const set = currentSet(),
      entries = set.entries.slice(0, MAX_VARIANTS),
      image = await variantImage(),
      settings = finishSettings(),
      files = [];
    for (const [i, entry] of entries.entries()) {
      status("Exporting variant " + (i + 1) + " of " + entries.length + "…");
      const p = variantParams(entry),
        r = await processEdit(
          image,
          variantRows(p),
          overrides.slice(),
          edit.active,
          pause,
        );
      for (const f of await deliver(r.pixels, w, h, settings, pause))
        files.push({
          name: outputName(name, f.format, p.target, f.suffix),
          blob: f.blob,
        });
    }
    const blob = await zip(files),
      filename =
        safeStem(name) +
        "-variants-" +
        (set.id.startsWith("user-") ? "palette" : set.id) +
        ".zip";
    download(blob, filename);
    status(
      "Prepared " +
        filename +
        " (" +
        formatBytes(blob.size) +
        ", " +
        files.length +
        " files). Choose where to save it.",
    );
  } catch (e) {
    status("Could not export variants: " + e.message);
  } finally {
    delete button.dataset.busy;
  }
}
$("makeVariants").onclick = makeVariants;
$("exportVariants").onclick = exportVariants;
renderSet();
// Recipes: the maps applied so far, plus the current one if it changes
// anything. Also returns that current preview (null when it changes nothing).
async function currentSteps() {
  commit("Adjust colour");
  let preview = null;
  try {
    const r = await latest();
    if (r.changed) preview = r;
  } catch {}
  const steps = edit.steps.slice();
  if (preview) steps.push(recipeStep(edit.rows, pixels, w, overrides));
  return { steps: steps.filter((s) => s.rows.length), preview };
}
async function saveRecipe() {
  if (!pixels) return;
  const { steps } = await currentSteps();
  if (!steps.length) {
    status("Nothing to save yet. Change a colour first.");
    return;
  }
  const filename = safeStem(name) + "-recipe.json";
  download(
    new Blob([writeRecipe(steps)], { type: "application/json" }),
    filename,
  );
  status(
    "Prepared " +
      filename +
      " (" +
      steps.length +
      (steps.length === 1 ? " step). " : " steps). ") +
      (steps.some((s) => s.approximate)
        ? "Brush strokes and connected-region limits are not part of it. "
        : "") +
      "Choose where to save it.",
  );
}
// Applies a recipe on top of the current preview, as one undoable change.
async function applyRecipe(file) {
  if (!pixels) return;
  try {
    if (file.size > MAX_RECIPE_BYTES)
      throw Error("Recipes must be 64 KB or smaller.");
    const recipe = parseRecipe(await file.text()),
      { steps, preview } = await currentSteps(),
      iid = imageId,
      base = preview ? preview.pixels : pixels;
    status("Applying " + file.name + "…");
    const out = await replay(w, h, base, recipe, pause, () => iid !== imageId);
    if (iid !== imageId) return;
    const old = snapshot();
    pixels = out;
    overrides = new Int8Array(w * h);
    edit = {
      rows: [newRow(1, { ...params, dh: 0, ds: 0, dl: 0, manual: false })],
      active: 0,
      steps: [...steps, ...recipe],
    };
    activate();
    dirty = true;
    history.record(old, snapshot(), "Apply recipe");
    sync();
    prepareCurrent();
    status(
      "Applied " +
        file.name +
        " (" +
        recipe.length +
        (recipe.length === 1 ? " step" : " steps") +
        "). Undo is available.",
    );
  } catch (e) {
    status("Could not apply the recipe: " + e.message);
  }
}
$("saveRecipe").onclick = saveRecipe;
$("openRecipe").onclick = () => $("recipeInput").click();
$("recipeInput").onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) applyRecipe(f);
};
// Batch: the recipe for this image, applied to other images one at a time and
// exported at the chosen size and format into one ZIP. Images that fail are
// listed in errors.txt.
const MAX_BATCH = 100;
let batchRun = 0,
  batchAbort = null;
function endBatch() {
  batchAbort?.abort();
  batchAbort = null;
  $("cancelBatch").hidden = true;
  buttons();
}
async function runBatch(list) {
  const run = ++batchRun,
    cancelled = () => run !== batchRun;
  try {
    if (list.length > MAX_BATCH)
      throw Error("Choose up to " + MAX_BATCH + " images at a time.");
    const { steps } = await currentSteps();
    if (!steps.length) {
      status("Nothing to apply yet. Change a colour first, then run a batch.");
      return;
    }
    const settings = finishSettings(),
      edge = Number($("svgSize").value),
      files = [],
      errors = [];
    batchAbort = new AbortController();
    $("cancelBatch").hidden = false;
    buttons();
    for (const [i, file] of list.entries()) {
      if (cancelled()) return;
      $("batchNote").textContent =
        "Image " + (i + 1) + " of " + list.length + ": " + file.name;
      try {
        const decoded = await decodeBlob(file, batchAbort.signal, {
            svgEdge: edge,
          }),
          out = await replay(
            decoded.width,
            decoded.height,
            decoded.pixels,
            steps,
            pause,
            cancelled,
          );
        for (const f of await deliver(
          out,
          decoded.width,
          decoded.height,
          settings,
          pause,
        ))
          files.push({
            name: outputName(file.name, f.format, null, f.suffix),
            blob: f.blob,
          });
      } catch (e) {
        if (cancelled()) return;
        errors.push(file.name + ": " + e.message);
      }
    }
    if (errors.length)
      files.push({
        name: "errors.txt",
        blob: new Blob([errors.join("\r\n") + "\r\n"], { type: "text/plain" }),
      });
    const blob = await zip(files),
      filename = "hexshift-batch.zip",
      done = list.length - errors.length;
    if (cancelled()) return;
    download(blob, filename);
    $("batchNote").textContent =
      "Done: " +
      done +
      " of " +
      list.length +
      (list.length === 1 ? " image" : " images") +
      (errors.length ? ". errors.txt in the ZIP lists the others." : ".");
    status(
      "Prepared " +
        filename +
        " (" +
        formatBytes(blob.size) +
        "). Choose where to save it.",
    );
  } catch (e) {
    if (!cancelled()) status("Batch failed: " + e.message);
  } finally {
    if (run === batchRun) endBatch();
  }
}
$("batch").onclick = () => $("batchInput").click();
$("batchInput").onchange = (e) => {
  const list = [...e.target.files];
  e.target.value = "";
  if (list.length) runBatch(list);
};
$("cancelBatch").onclick = () => {
  batchRun++;
  endBatch();
  $("batchNote").textContent = "Batch cancelled.";
  status("Batch cancelled.");
};
function layout() {
  if (!w) return;
  const pane = after.parentElement,
    // Floating tools sit over the top and bottom of the canvas on wide
    // layouts; fitting leaves room for them so they never cover the artwork.
    marginY =
      getComputedStyle($("stageTools")).position === "absolute" ? 116 : 40;
  if (fitMode) {
    zoom = Math.min(
      (pane.clientWidth - 40) / w,
      (pane.clientHeight - marginY) / h,
    );
    zoom = Math.max(0.01, zoom);
    panX = panY = 0;
  }
  for (const c of [before, after, wipeCanvas]) {
    c.style.width = w * zoom + "px";
    c.style.height = h * zoom + "px";
    c.style.transform = `translate(calc(-50% + ${panX}px),calc(-50% + ${panY}px))`;
  }
  // Zoomed in by hand past 200%, each image pixel shows as a sharp square, so
  // edges and rims can be judged exactly; the fitted overview stays smooth.
  $("viewport").classList.toggle("pixelated", !fitMode && zoom >= 2);
  $("zoomReadout").textContent = Math.round(zoom * 100) + "%";
}
function setZoom(value, anchor) {
  if (!w) return;
  const old = zoom;
  zoom = clamp(value, 0.01, 16);
  fitMode = false;
  if (anchor) {
    const rect = anchor.canvas.parentElement.getBoundingClientRect(),
      x = anchor.x - rect.left - rect.width / 2,
      y = anchor.y - rect.top - rect.height / 2;
    panX = x - ((x - panX) * zoom) / old;
    panY = y - ((y - panY) * zoom) / old;
  } else {
    panX *= zoom / old;
    panY *= zoom / old;
  }
  layout();
}
function point(e, c) {
  const r = c.getBoundingClientRect(),
    x = Math.floor(((e.clientX - r.left) / r.width) * w),
    y = Math.floor(((e.clientY - r.top) / r.height) * h);
  return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
}
function brush(x, y) {
  // Add forces pixels into the active colour; subtract keeps them out of all.
  const radius = Number($("brushSize").value) / 2,
    value = tool === "add" ? edit.rows[edit.active].id : -1;
  for (
    let yy = Math.max(0, Math.floor(y - radius));
    yy <= Math.min(h - 1, Math.ceil(y + radius));
    yy++
  )
    for (
      let xx = Math.max(0, Math.floor(x - radius));
      xx <= Math.min(w - 1, Math.ceil(x + radius));
      xx++
    )
      if ((xx - x) ** 2 + (yy - y) ** 2 <= radius * radius)
        overrides[yy * w + xx] = value;
}
function brushLine(a, b) {
  const steps = Math.ceil(
    Math.hypot(b.x - a.x, b.y - a.y) /
      Math.max(1, Number($("brushSize").value) / 4),
  );
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    brush(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
  schedule();
}
function loupe(e, c) {
  const p = point(e, c);
  if (!p) return;
  const o = (p.y * w + p.x) * 4,
    from = pixels.subarray(o, o + 4),
    to = (result?.pixels || pixels).subarray(o, o + 4);
  $("pixelReadout").textContent =
    `${p.x}, ${p.y} · ${toHex(...from)} → ${toHex(...to)} · α ${Math.round((to[3] / 255) * 100)}%`;
  const canvas = $("loupe"),
    ctx = canvas.getContext("2d"),
    box = $("viewport").getBoundingClientRect();
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, 132, 164);
  const image = result?.pixels || pixels;
  for (let yy = -4; yy <= 4; yy++)
    for (let xx = -4; xx <= 4; xx++) {
      const x = clamp(p.x + xx, 0, w - 1),
        y = clamp(p.y + yy, 0, h - 1),
        i = (y * w + x) * 4,
        cx = 3 + (xx + 4) * 14,
        cy = 3 + (yy + 4) * 14;
      if (image[i + 3]) {
        ctx.fillStyle = toHex(...image.subarray(i, i + 3));
        ctx.fillRect(cx, cy, 14, 14);
      } else {
        // Transparent pixels show as a small neutral checker.
        ctx.fillStyle = "#3a3a3a";
        ctx.fillRect(cx, cy, 14, 14);
        ctx.fillStyle = "#555555";
        ctx.fillRect(cx, cy, 7, 7);
        ctx.fillRect(cx + 7, cy + 7, 7, 7);
      }
    }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(59, 59, 14, 14);
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.fillText(`${p.x},${p.y} ${toHex(...to)}`, 5, 143);
  ctx.fillText(`Alpha ${Math.round((to[3] / 255) * 100)}%`, 5, 157);
  canvas.hidden = false;
  // On touch the loupe sits above the finger, which would hide it otherwise.
  const touch = e.pointerType === "touch";
  canvas.style.left =
    clamp(e.clientX - box.left + (touch ? -66 : 18), 0, box.width - 134) + "px";
  canvas.style.top =
    clamp(e.clientY - box.top + (touch ? -214 : 18), 0, box.height - 166) +
    "px";
}
// Two fingers on the canvas pinch to zoom and drag to pan, around the point
// between them.
const touches = new Map();
let pinch = null;
const touchMid = () => {
  const [a, b] = [...touches.values()];
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
  };
};
function startPinch(space, e) {
  space.setPointerCapture(e.pointerId);
  if (drag && !drag.pan && (tool === "add" || tool === "subtract"))
    commit("Brush selection");
  drag = null;
  $("loupe").hidden = true;
  pinch = { space, zoom, panX, panY, ...touchMid() };
}
function movePinch() {
  const now = touchMid(),
    rect = pinch.space.getBoundingClientRect(),
    ax = pinch.x - rect.left - rect.width / 2,
    ay = pinch.y - rect.top - rect.height / 2,
    z = clamp((pinch.zoom * now.d) / pinch.d, 0.01, 16);
  fitMode = false;
  zoom = z;
  panX = ax - ((ax - pinch.panX) * z) / pinch.zoom + now.x - pinch.x;
  panY = ay - ((ay - pinch.panY) * z) / pinch.zoom + now.y - pinch.y;
  layout();
}
function setTool(value) {
  tool = value;
  for (const [id, active] of [
    ["pan", value === "pan"],
    ["brushAdd", value === "add"],
    ["brushSubtract", value === "subtract"],
    ["replaceSample", value === "pick" && !addSample],
    ["addSample", value === "pick" && addSample],
  ])
    $(id).setAttribute("aria-pressed", String(active));
  after.parentElement.style.cursor = before.parentElement.style.cursor =
    value === "pan" ? "grab" : "crosshair";
}
for (const c of [before, after]) {
  c.parentElement.addEventListener(
    "wheel",
    (e) => {
      if (!pixels) return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.002), {
        canvas: c,
        x: e.clientX,
        y: e.clientY,
      });
    },
    { passive: false },
  );
  c.parentElement.addEventListener("pointerdown", (e) => {
    if (!pixels || e.button !== 0) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) return startPinch(c.parentElement, e);
      if (touches.size > 2) return;
    }
    const p = point(e, c);
    const pan = tool === "pan" || space;
    if (!p && !pan) return;
    c.parentElement.setPointerCapture(e.pointerId);
    drag = {
      pointer: e.pointerId,
      pan,
      startX: e.clientX,
      startY: e.clientY,
      panX,
      panY,
      last: p,
      moved: false,
    };
    if (!pan && (tool === "add" || tool === "subtract")) {
      begin();
      brush(p.x, p.y);
      schedule();
    }
  });
  c.parentElement.addEventListener("pointermove", (e) => {
    if (!pixels) return;
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) return movePinch();
    }
    const p = point(e, c);
    // Touch shows the loupe only while a finger is down to pick.
    if (
      p &&
      (e.pointerType !== "touch" ||
        (drag?.pointer === e.pointerId && !drag.pan && tool === "pick"))
    )
      loupe(e, c);
    if (p && (tool === "add" || tool === "subtract")) {
      const cursor = $("brushCursor"),
        r = after.parentElement.getBoundingClientRect();
      cursor.hidden = false;
      cursor.style.left = e.clientX - r.left + "px";
      cursor.style.top = e.clientY - r.top + "px";
      cursor.style.width = cursor.style.height =
        Number($("brushSize").value) * zoom + "px";
    }
    if (!drag || drag.pointer !== e.pointerId) return;
    drag.moved ||=
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3;
    if (drag.pan) {
      fitMode = false;
      panX = drag.panX + e.clientX - drag.startX;
      panY = drag.panY + e.clientY - drag.startY;
      layout();
    } else if (p && (tool === "add" || tool === "subtract")) {
      brushLine(drag.last || p, p);
      drag.last = p;
    }
  });
  const finish = (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const p = point(e, c),
      d = drag;
    drag = null;
    if ((tool === "add" || tool === "subtract") && !d.pan)
      commit("Brush selection");
    else if (!d.pan && !d.moved && p) {
      const old = addSample;
      addSample ||= e.shiftKey;
      pick(p.x, p.y);
      addSample = old;
    }
  };
  // A lifted finger ends any pinch; the remaining finger does nothing until
  // it is lifted too, so a pinch never ends in an accidental pick.
  const release = (e) => {
    if (!touches.delete(e.pointerId)) return;
    if (pinch && touches.size < 2) pinch = null;
    $("loupe").hidden = true;
  };
  c.parentElement.addEventListener("pointerup", (e) => {
    finish(e);
    release(e);
  });
  c.parentElement.addEventListener("pointercancel", (e) => {
    release(e);
    if (drag?.pointer === e.pointerId) {
      drag = null;
      commit("Brush selection");
    }
  });
  c.parentElement.addEventListener("pointerleave", () => {
    $("loupe").hidden = true;
    $("brushCursor").hidden = true;
  });
}
$("open").onclick = () => $("fileInput").click();
// Palette files (.gpl, .hex, .pal, .txt) open as palettes, recipes (.json)
// apply to the image, anything else opens as an image.
function openFile(f) {
  if (isPaletteFile(f)) openPalette(f, f.name);
  else if (/\.json$/i.test(f.name) || f.type === "application/json")
    applyRecipe(f);
  else openBlob(f, f.name);
}
$("fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (f) openFile(f);
  e.target.value = "";
};
$("targetHex").addEventListener("input", (e) => {
  begin();
  const rgb = readColour(e.target.value);
  e.target.setAttribute("aria-invalid", String(!rgb));
  if (rgb) {
    params.target = toHex(...rgb);
    params.ramp = null;
    params.manual = false;
    targetDeltas();
    syncTarget();
    schedule();
  }
});
$("targetHex").addEventListener("change", () => {
  commit("Target colour");
  if (readColour($("targetHex").value)) {
    rememberTarget(params.target);
    sync();
  } else
    status(
      "Enter a colour such as #00D9FF, rgb(0 217 255), hsl(190 100% 50%) or a colour name.",
    );
});
$("targetColour").oninput = (e) => {
  begin();
  params.target = e.target.value.toUpperCase();
  params.ramp = null;
  params.manual = false;
  targetDeltas();
  $("targetHex").value = params.target;
  schedule();
};
$("targetColour").onchange = () => {
  commit("Target colour");
  rememberTarget(params.target);
  sync();
};
for (const [id, key] of [
  ["connected", "connected"],
  ["protect", "protect"],
  ["cleanEdges", "cleanEdges"],
])
  $(id).onchange = (e) =>
    action("Selection / shading option", () => {
      params[key] = e.target.checked;
    });
$("mode").onchange = (e) =>
  action("Treatment", () => {
    params.mode = e.target.value;
  });
// Deltas are measured in the active model, so a model change re-derives them
// from the target (manual slider offsets would mean something else).
$("model").onchange = (e) =>
  action("Colour model", () => {
    params.model = e.target.value;
    params.manual = false;
    targetDeltas();
  });
// Clears the active colour's samples and brush strokes, and subtract strokes.
$("addRow").onclick = addRow;
$("mapAll").onclick = mapAll;
$("clear").onclick = () =>
  action("Clear selection", () => {
    const id = edit.rows[edit.active].id;
    seeds.length = 0;
    for (let i = 0; i < overrides.length; i++)
      if (overrides[i] === id || overrides[i] === -1) overrides[i] = 0;
  });
$("replaceSample").onclick = () => {
  addSample = false;
  setTool("pick");
};
$("addSample").onclick = () => {
  addSample = true;
  setTool("pick");
};
$("pan").onclick = () => setTool(tool === "pan" ? "pick" : "pan");
$("brushAdd").onclick = () => setTool("add");
$("brushSubtract").onclick = () => setTool("subtract");
$("brushSize").oninput = (e) =>
  ($("brushSizeValue").textContent = e.target.value + " px");
$("undo").onclick = () => restore(false);
$("redo").onclick = () => restore(true);
$("apply").onclick = apply;
$("reset").onclick = reset;
$("export").onclick = () => save();
$("copy").onclick = () => save(true);
$("cancel").onclick = cancelProcessing;
$("fit").onclick = () => {
  fitMode = true;
  layout();
};
$("actual").onclick = () => setZoom(1);
$("zoomIn").onclick = () => setZoom(zoom * 1.25);
$("zoomOut").onclick = () => setZoom(zoom / 1.25);
setChoice("view", matchMedia("(min-width:960px)").matches ? "side" : "result");
$("viewport").dataset.view = choice("view");
$("compare").hidden = choice("view") === "result";
$("view").onchange = () => {
  const view = choice("view");
  $("viewport").dataset.view = view;
  $("wipeControl").hidden = view !== "wipe";
  $("compare").hidden = view === "result";
  draw();
  layout();
};
$("compare").onchange = draw;
$("overlay").onchange = draw;
$("wipe").oninput = draw;
function background() {
  const kind = choice("background");
  $("viewport").classList.toggle("checker", kind === "checker");
  $("backgroundColour").hidden = kind !== "custom";
  for (const el of document.querySelectorAll(".canvas-space"))
    el.style.backgroundColor =
      kind === "white"
        ? "#fff"
        : kind === "dark"
          ? "#1c1c1c"
          : kind === "custom"
            ? $("backgroundColour").value
            : "";
}
// On narrow screens (and in the Android app) the dock shows one panel at a
// time; the tab bar picks which. Wider layouts show all three and hide it.
for (const tab of document.querySelectorAll(".dock-tabs button"))
  tab.onclick = () => {
    $("dock").dataset.tab = tab.dataset.tab;
    for (const other of document.querySelectorAll(".dock-tabs button"))
      other.setAttribute("aria-pressed", String(other === tab));
  };
// The dock's height can be dragged or set with the arrow keys. It lasts for
// the session only: the theme is the one thing Hex Shift stores.
function dockHeight(px) {
  const max = Math.max(160, innerHeight - 320),
    value = Math.round(clamp(px, 120, Math.min(600, max)));
  document.querySelector(".app").style.setProperty("--dock-h", value + "px");
  $("dockHandle").setAttribute("aria-valuenow", String(value));
  layout();
}
$("dockHandle").addEventListener("pointerdown", (e) => {
  const handle = $("dockHandle"),
    start = e.clientY,
    height = $("dock").getBoundingClientRect().height;
  handle.setPointerCapture(e.pointerId);
  const move = (m) => dockHeight(height + start - m.clientY);
  handle.addEventListener("pointermove", move);
  handle.addEventListener(
    "pointerup",
    () => handle.removeEventListener("pointermove", move),
    { once: true },
  );
});
$("dockHandle").addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 60 : 20,
    now = $("dock").getBoundingClientRect().height;
  if (e.key === "ArrowUp") dockHeight(now + step);
  else if (e.key === "ArrowDown") dockHeight(now - step);
  else return;
  e.preventDefault();
});
$("background").onchange = background;
$("backgroundColour").oninput = background;
$("dismissTip").onclick = () => ($("firstUse").hidden = true);
try {
  const saved = localStorage.getItem("hexshift-theme");
  if (["system", "light", "dark"].includes(saved)) $("theme").value = saved;
} catch {}
function theme() {
  if ($("theme").value === "system")
    delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = $("theme").value;
  try {
    localStorage.setItem("hexshift-theme", $("theme").value);
  } catch {}
}
$("theme").onchange = theme;
theme();
document.addEventListener("keydown", (e) => {
  const editing = e.target.closest(
    "input,select,textarea,[contenteditable=true]",
  );
  if (editing || $("replaceDialog").open) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "o") {
    e.preventDefault();
    $("fileInput").click();
  } else if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    restore(e.shiftKey);
  } else if (key === "escape") {
    $("clear").click();
  } else if (
    e.code === "Space" &&
    !e.target.closest("button,summary,a,[role=separator]")
  ) {
    // Space on a focused button or summary still presses it.
    e.preventDefault();
    space = true;
  } else if (key === "f") $("fit").click();
  else if (key === "+" || key === "=") $("zoomIn").click();
  else if (key === "-") $("zoomOut").click();
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") space = false;
});
window.addEventListener("blur", () => {
  space = false;
  drag = null;
  commit("Brush selection");
});
let depth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    depth++;
    $("dropOverlay").hidden = false;
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("dragleave", () => {
  if (--depth <= 0) {
    depth = 0;
    $("dropOverlay").hidden = true;
  }
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  $("dropOverlay").hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f) openFile(f);
});
document.addEventListener("paste", (e) => {
  for (const item of e.clipboardData?.items || [])
    if (item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        openBlob(f, "pasted.png");
      }
      return;
    }
  // Text pasted outside a text field: one colour becomes the target, several
  // become a palette.
  const text = e.clipboardData?.getData("text/plain");
  if (!text || e.target.closest?.("input, textarea, select, [contenteditable]"))
    return;
  let entries;
  try {
    entries = parsePalette(text);
  } catch {
    return;
  }
  e.preventDefault();
  if (entries.length === 1) setTarget(entries[0].hex);
  else openPalette(text, "Pasted palette");
});
window.addEventListener("resize", layout);
new ResizeObserver(layout).observe($("viewport"));
window.addEventListener("beforeunload", (e) => {
  if (dirty || result?.changed) {
    e.preventDefault();
    e.returnValue = "";
  }
});
// Only cache the hosted shell. Portable HTML and the Windows host remain network-free.
if (
  "serviceWorker" in navigator &&
  location.protocol === "https:" &&
  location.hostname !== "hexshift.invalid"
)
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      if (reg.waiting) $("update").hidden = false;
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        installing?.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          )
            $("update").hidden = false;
        });
      });
    })
    .catch(() => {});
startWorker();
syncTarget();
setTool("pick");
const sampleBytes = Uint8Array.from(atob(sample.split(",")[1]), (c) =>
  c.charCodeAt(0),
);
openBlob(new Blob([sampleBytes], { type: "image/png" }), "red_heart.png", true);
