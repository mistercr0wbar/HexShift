import { defaults, parseHex, toHex, clamp, deltasFor } from "./colour.js";
import {
  prepare,
  processImage,
  validateImage,
  validateEdit,
} from "./engine.js";
import { History } from "./history.js";
import { decodeBlob } from "./import.js";
import { canEncodeWebP, formatBytes, outputName } from "./export.js";
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
  params = defaults(),
  seeds = [],
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
function meta() {
  return structuredClone({ params, seeds });
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
function buttons() {
  const available = !!pixels;
  $("undo").disabled = !history.undoEntries.length;
  $("redo").disabled = !history.redoEntries.length;
  $("apply").disabled = !available || processing || !result?.changed;
  $("copy").disabled = !available;
  $("export").disabled = !available;
  $("cancel").hidden = !processing;
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
    if (["dh", "ds", "dl"].includes(key)) params.manual = true;
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
for (const [label, hex] of DISCORD_BUTTONS) {
  const b = swatch(hex, label + " " + hex, () => setTarget(hex));
  const text = document.createElement("span");
  text.textContent = label;
  b.append(text);
  $("presets").append(b);
}
function targetDeltas() {
  if (!seeds.length || params.manual) return;
  const sd = seeds.at(-1),
    o = (sd.y * w + sd.x) * 4;
  Object.assign(
    params,
    deltasFor(
      [...pixels.subarray(o, o + 3)],
      parseHex(params.target),
      params.model,
    ),
  );
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
  $("mode").value = params.mode;
  $("model").value = params.model;
  $("connected").checked = params.connected;
  $("protect").checked = params.protect;
  $("cleanEdges").checked = params.cleanEdges;
  syncTarget();
  renderSeeds();
  buttons();
}
function setTarget(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return;
  action("Target colour", () => {
    params.target = toHex(...rgb);
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
    if (!addSample && !space) seeds = [];
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
    validateEdit(params, seeds, overrides, w, h);
    const copy = overrides.slice();
    if (worker)
      worker.postMessage(
        {
          type: "edit",
          imageId: iid,
          editId: eid,
          params: structuredClone(params),
          seeds: structuredClone(seeds),
          overrides: copy,
        },
        [copy.buffer],
      );
    else
      processImage(
        prepared,
        structuredClone(params),
        structuredClone(seeds),
        copy,
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
            : "Requested " + params.target) +
          " · achieved " +
          toHex(...m.pixels.subarray(o, o + 3));
  } else $("targetResult").textContent = "Pick a source colour to begin.";
  $("capWarning").hidden = !(m.capped && params.mode === "shift");
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
    params = defaults();
    seeds = [];
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
  params = moved.meta.params;
  seeds = moved.meta.seeds;
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
    const old = snapshot();
    pixels = r.pixels.slice();
    overrides = new Int8Array(w * h);
    seeds = [];
    params = { ...params, dh: 0, ds: 0, dl: 0, manual: false };
    dirty = true;
    history.record(old, snapshot(), "Apply colour");
    sync();
    prepareCurrent();
    status("Applied. Select the next colour, or export.");
  } catch (e) {
    status(e.message);
  }
}
function reset() {
  action("Reset original", () => {
    pixels = original.slice();
    overrides = new Int8Array(w * h);
    params = defaults();
    seeds = [];
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
      const pack = files.length > 1,
        named = files.map((f) => ({
          name: outputName(name, f.format, params.target, f.suffix),
          blob: f.blob,
        })),
        blob = pack ? await zip(named) : named[0].blob,
        filename = pack
          ? outputName(name, "zip", params.target, settings.size)
          : named[0].name,
        over = files.filter((f) => f.limit && f.blob.size > f.limit),
        url = URL.createObjectURL(blob);
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
function displayPixels(data, selection) {
  const out = new Uint8ClampedArray(data),
    overlay = $("overlay").value;
  if (selection && result && overlay !== "normal")
    for (let i = 0; i < w * h; i++) {
      const o = i * 4,
        t = result.mask[i];
      if (overlay === "only") out[o + 3] = out[o + 3] * t;
      else if (t > 0) {
        out[o] = out[o] * (1 - 0.24 * t) + 117 * 0.24 * t;
        out[o + 1] = out[o + 1] * (1 - 0.24 * t) + 83 * 0.24 * t;
        out[o + 2] = out[o + 2] * (1 - 0.24 * t) + 245 * 0.24 * t;
      }
    }
  return out;
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
          displayPixels(result.pixels, $("view").value !== "side"),
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
      colour: $("outlineHex").value,
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
  const rgb = parseHex(e.target.value);
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
  $("export").textContent = "Export " + FORMAT_NAMES[select.value] + " ↗";
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
function layout() {
  if (!w) return;
  const pane = after.parentElement;
  if (fitMode) {
    zoom = Math.min((pane.clientWidth - 40) / w, (pane.clientHeight - 40) / h);
    zoom = Math.max(0.01, zoom);
    panX = panY = 0;
  }
  for (const c of [before, after, wipeCanvas]) {
    c.style.width = w * zoom + "px";
    c.style.height = h * zoom + "px";
    c.style.transform = `translate(calc(-50% + ${panX}px),calc(-50% + ${panY}px))`;
  }
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
  const radius = Number($("brushSize").value) / 2,
    value = tool === "add" ? 1 : -1;
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
  ctx.fillStyle = "#211c30";
  ctx.fillRect(0, 0, 132, 164);
  const image = result?.pixels || pixels;
  for (let yy = -4; yy <= 4; yy++)
    for (let xx = -4; xx <= 4; xx++) {
      const x = clamp(p.x + xx, 0, w - 1),
        y = clamp(p.y + yy, 0, h - 1),
        i = (y * w + x) * 4;
      ctx.fillStyle = image[i + 3]
        ? toHex(...image.subarray(i, i + 3))
        : "#6f687e";
      ctx.fillRect(3 + (xx + 4) * 14, 3 + (yy + 4) * 14, 14, 14);
    }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(59, 59, 14, 14);
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.fillText(`${p.x},${p.y} ${toHex(...to)}`, 5, 143);
  ctx.fillText(`Alpha ${Math.round((to[3] / 255) * 100)}%`, 5, 157);
  canvas.hidden = false;
  canvas.style.left =
    clamp(e.clientX - box.left + 18, 0, box.width - 134) + "px";
  canvas.style.top =
    clamp(e.clientY - box.top + 18, 0, box.height - 166) + "px";
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
    const p = point(e, c);
    if (p && e.pointerType !== "touch") loupe(e, c);
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
  c.parentElement.addEventListener("pointerup", finish);
  c.parentElement.addEventListener("pointercancel", (e) => {
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
$("fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (f) openBlob(f, f.name);
  e.target.value = "";
};
$("targetHex").addEventListener("input", (e) => {
  begin();
  const rgb = parseHex(e.target.value);
  e.target.setAttribute("aria-invalid", String(!rgb));
  if (rgb) {
    params.target = toHex(...rgb);
    params.manual = false;
    targetDeltas();
    syncTarget();
    schedule();
  }
});
$("targetHex").addEventListener("change", () => {
  commit("Target colour");
  if (parseHex($("targetHex").value)) {
    rememberTarget(params.target);
    sync();
  } else status("Enter a 3- or 6-digit hex colour, such as #00D9FF.");
});
$("targetColour").oninput = (e) => {
  begin();
  params.target = e.target.value.toUpperCase();
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
$("clear").onclick = () =>
  action("Clear selection", () => {
    seeds = [];
    overrides.fill(0);
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
$("view").value = matchMedia("(min-width:960px)").matches ? "side" : "result";
$("viewport").dataset.view = $("view").value;
$("compare").hidden = $("view").value === "result";
$("view").onchange = () => {
  $("viewport").dataset.view = $("view").value;
  $("wipeControl").hidden = $("view").value !== "wipe";
  $("compare").hidden = $("view").value === "result";
  draw();
  layout();
};
$("compare").onchange = draw;
$("overlay").onchange = draw;
$("wipe").oninput = draw;
function background() {
  const kind = $("background").value;
  $("viewport").classList.toggle("checker", kind === "checker");
  $("backgroundColour").hidden = kind !== "custom";
  for (const el of document.querySelectorAll(".canvas-space"))
    el.style.backgroundColor =
      kind === "white"
        ? "#fff"
        : kind === "dark"
          ? "#17141f"
          : kind === "custom"
            ? $("backgroundColour").value
            : "";
}
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
  } else if (e.code === "Space") {
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
  if (f) openBlob(f, f.name);
});
document.addEventListener("paste", (e) => {
  for (const item of e.clipboardData?.items || [])
    if (item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        openBlob(f, "pasted.png");
      }
      break;
    }
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
