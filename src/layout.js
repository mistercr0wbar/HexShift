// The saved workspace. Images never enter this store: only where the panels
// sit, which of them the person has folded or hidden, the column sizes, and
// the order of the phone sheet's tabs.
//
// `mode` "auto" keeps the 3.2 rule (the window's size picks side columns, one
// right column, the bottom dock, or the phone sheet). A named mode pins that
// arrangement. "custom" is an arrangement the person built by dragging.
// The phone sheet does not apply regions, sizes or folds; it uses `phoneTabs`.

export const LAYOUT_KEY = "hexshift-layout",
  MAX_LAYOUT_BYTES = 16 * 1024,
  PANELS = [
    "selection",
    "colour",
    "adjust",
    "swatches",
    "outline",
    "export",
  ],
  PHONE_TABS = ["selection", "colour", "swatches", "export"],
  REGIONS = ["left", "right", "bottom"],
  MODES = ["auto", "side", "column", "dock", "custom"],
  SIZE_LIMITS = { left: [200, 520], right: [200, 520], dock: [120, 600] },
  SPAN_LIMITS = [80, 800],
  // The picture keeps this much width while saved column sizes are fitted.
  // 360 is the same reserve the column handles already use while dragging.
  EDITOR_RESERVE = 360,
  // The dock preset's centre row is minmax(220px, 1fr). Fitting a saved dock
  // height leaves at least that much for the picture.
  CENTRE_MIN = 220;

// Saved column and dock sizes are what the person chose. The sizes applied to
// the page can be smaller while the window cannot hold them. Null stays null
// so the stylesheet's own clamp is left alone. The stored sizes are not changed.
export function fitSavedSizes(
  preferred,
  { width, height, left = false, right = false, bottom = false },
) {
  const out = { left: null, right: null, dock: null };
  if (!(width > 0) || !(height > 0)) {
    if (left && preferred.left != null) out.left = preferred.left;
    if (right && preferred.right != null) out.right = preferred.right;
    if (bottom && preferred.dock != null) out.dock = preferred.dock;
    return out;
  }
  const shown = [];
  if (left && preferred.left != null) shown.push("left");
  if (right && preferred.right != null) shown.push("right");
  const room = Math.max(0, width - EDITOR_RESERVE);
  if (shown.length === 2) {
    const sum = preferred.left + preferred.right;
    if (sum > room && sum > 0) {
      out.left = Math.floor((preferred.left * room) / sum);
      out.right = room - out.left;
    } else {
      out.left = preferred.left;
      out.right = preferred.right;
    }
  } else if (shown.length === 1) {
    const key = shown[0];
    out[key] = Math.min(preferred[key], room);
  }
  if (bottom && preferred.dock != null) {
    const maxDock = Math.max(SIZE_LIMITS.dock[0], height - CENTRE_MIN);
    out.dock = Math.min(preferred.dock, maxDock);
  }
  return out;
}

const TITLES = {
  selection: "Selection",
  colour: "Colour",
  adjust: "Adjust",
  swatches: "Swatches",
  outline: "Outline",
  export: "Export",
};
export const panelTitle = (id) => TITLES[id] || id;
const REGION_SPOKEN = {
  left: "the left column",
  right: "the right column",
  bottom: "the bottom dock",
};
export const regionSpoken = (name) => REGION_SPOKEN[name] || name;

const clone = (value) => structuredClone(value);
const blankRegions = () => ({ left: [], right: [], bottom: [] });

export function defaultLayout() {
  return {
    v: 1,
    mode: "auto",
    locked: false,
    collapsed: [],
    // Panels the person has folded or opened. Automatic folding is not recorded
    // here, so a short window can fold Swatches without pinning that fold.
    touched: [],
    hidden: [],
    regions: {
      left: [["selection"]],
      right: [["colour", "adjust", "swatches", "outline", "export"]],
      bottom: [],
    },
    sizes: { left: null, right: null, dock: null },
    spans: {},
    phoneTabs: [...PHONE_TABS],
  };
}

function idList(value, label) {
  if (!Array.isArray(value)) throw Error(label + " must be a list.");
  const seen = new Set();
  for (const id of value) {
    if (!PANELS.includes(id) || seen.has(id))
      throw Error(label + " must name each panel at most once.");
    seen.add(id);
  }
  return value.slice();
}

function readRegions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Regions are missing.");
  const regions = blankRegions(),
    seen = new Set();
  for (const name of REGIONS) {
    const stacks = value[name];
    if (!Array.isArray(stacks)) throw Error("Each region must list its stacks.");
    regions[name] = stacks.map((stack) => {
      if (!Array.isArray(stack) || !stack.length)
        throw Error("A stack needs at least one panel.");
      return stack.map((id) => {
        if (!PANELS.includes(id) || seen.has(id))
          throw Error("Each panel is placed once.");
        seen.add(id);
        return id;
      });
    });
  }
  return { regions, seen };
}

function readSizes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Sizes are missing.");
  const sizes = { left: null, right: null, dock: null };
  for (const key of ["left", "right", "dock"]) {
    const n = value[key];
    if (n === null) continue;
    const [lo, hi] = SIZE_LIMITS[key];
    if (!Number.isInteger(n) || n < lo || n > hi)
      throw Error("A column size is out of range.");
    sizes[key] = n;
  }
  return sizes;
}

function readSpans(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Panel sizes are missing.");
  const spans = {};
  for (const [id, n] of Object.entries(value)) {
    if (!PANELS.includes(id)) throw Error("Unknown panel size.");
    const [lo, hi] = SPAN_LIMITS;
    if (!Number.isInteger(n) || n < lo || n > hi)
      throw Error("A panel size is out of range.");
    spans[id] = n;
  }
  return spans;
}

function readPhoneTabs(value) {
  if (!Array.isArray(value) || value.length !== PHONE_TABS.length)
    throw Error("Phone tabs must list each sheet tab once.");
  const seen = new Set();
  for (const id of value) {
    if (!PHONE_TABS.includes(id) || seen.has(id))
      throw Error("Phone tabs must list each sheet tab once.");
    seen.add(id);
  }
  return value.slice();
}

// Rebuilds the store field by field. Extra fields, including anything that
// would ride in on a prototype, are dropped.
export function validateLayout(source) {
  if (source?.v !== 1 || !MODES.includes(source.mode))
    throw Error("This layout format is not supported.");
  if (typeof source.locked !== "boolean") throw Error("Lock must be yes or no.");
  const collapsed = idList(source.collapsed, "Collapsed panels"),
    touched = idList(source.touched, "Touched panels"),
    hidden = idList(source.hidden, "Hidden panels"),
    { regions, seen } = readRegions(source.regions);
  for (const id of hidden) {
    if (seen.has(id)) throw Error("A hidden panel is also placed.");
  }
  for (const id of PANELS) {
    if (!seen.has(id) && !hidden.includes(id)) throw Error("A panel is missing.");
  }
  return {
    v: 1,
    mode: source.mode,
    locked: source.locked,
    collapsed,
    touched,
    hidden,
    regions,
    sizes: readSizes(source.sizes),
    spans: readSpans(source.spans),
    phoneTabs: readPhoneTabs(source.phoneTabs),
  };
}

export function parseLayout(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES
  )
    throw Error("Saved layout could not be read and was ignored.");
  let source;
  try {
    source = JSON.parse(text);
  } catch {
    throw Error("Saved layout could not be read and was ignored.");
  }
  try {
    return validateLayout(source);
  } catch {
    throw Error("Saved layout could not be read and was ignored.");
  }
}

export function locate(regions, panel) {
  for (const region of REGIONS)
    for (let stack = 0; stack < regions[region].length; stack++) {
      const index = regions[region][stack].indexOf(panel);
      if (index >= 0) return { region, stack, index };
    }
  return null;
}

function blocked(layout) {
  return layout.locked
    ? { layout, changed: false, reason: "locked" }
    : null;
}

function finish(layout) {
  return { layout: validateLayout(layout), changed: true };
}

// Copies the arrangement on screen into `regions` and marks it custom, so a
// later move edits what the person is looking at. `kind` is side, column or
// dock. Hidden panels are left in `hidden` and taken out of the stacks.
export function materialize(layout, kind, presets) {
  if (layout.mode === "custom") return layout;
  if (!presets[kind]) throw Error("Unknown layout.");
  const next = clone(layout);
  const hidden = new Set(next.hidden);
  next.regions = blankRegions();
  for (const name of REGIONS)
    for (const stack of presets[kind][name]) {
      const ids = stack.filter((id) => !hidden.has(id));
      if (ids.length) next.regions[name].push(ids);
    }
  next.mode = "custom";
  return validateLayout(next);
}

export function moveToRegion(layout, panel, region) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel) || !REGIONS.includes(region))
    throw Error("Unknown move.");
  if (layout.hidden.includes(panel))
    return { layout, changed: false, reason: "hidden" };
  const from = locate(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  if (from.region === region)
    return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  next.regions[from.region][from.stack].splice(from.index, 1);
  if (!next.regions[from.region][from.stack].length)
    next.regions[from.region].splice(from.stack, 1);
  if (!next.regions[region].length) next.regions[region].push([panel]);
  else next.regions[region].at(-1).push(panel);
  next.mode = "custom";
  return finish(next);
}

export function moveBy(layout, panel, delta) {
  const stop = blocked(layout);
  if (stop) return stop;
  if ((delta !== -1 && delta !== 1) || !PANELS.includes(panel))
    throw Error("Unknown move.");
  if (layout.hidden.includes(panel))
    return { layout, changed: false, reason: "hidden" };
  const from = locate(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  const index = from.index + delta;
  if (index < 0 || index >= layout.regions[from.region][from.stack].length)
    return { layout, changed: false, reason: "end" };
  const next = clone(layout);
  const stack = next.regions[from.region][from.stack];
  const [item] = stack.splice(from.index, 1);
  stack.splice(index, 0, item);
  next.mode = "custom";
  return finish(next);
}

// `dest.stack` and `dest.index` are positions in the layout as it is now,
// before the panel is lifted out. Dropping on the panel's own gap is not a move.
export function insertPanel(layout, panel, dest) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (
    !PANELS.includes(panel) ||
    !REGIONS.includes(dest?.region) ||
    !Number.isInteger(dest.stack) ||
    !Number.isInteger(dest.index)
  )
    throw Error("Unknown move.");
  if (layout.hidden.includes(panel))
    return { layout, changed: false, reason: "hidden" };
  const from = locate(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  if (
    from.region === dest.region &&
    from.stack === dest.stack &&
    (dest.index === from.index || dest.index === from.index + 1)
  )
    return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  const source = next.regions[from.region][from.stack];
  source.splice(from.index, 1);
  let stackIndex = dest.stack,
    index = dest.index;
  if (
    from.region === dest.region &&
    from.stack === dest.stack &&
    from.index < dest.index
  )
    index -= 1;
  if (!source.length) {
    next.regions[from.region].splice(from.stack, 1);
    if (from.region === dest.region && from.stack < dest.stack) stackIndex -= 1;
  }
  const stacks = next.regions[dest.region];
  if (stackIndex < 0) stackIndex = 0;
  if (stackIndex >= stacks.length) stacks.push([panel]);
  else {
    const at = Math.max(0, Math.min(index, stacks[stackIndex].length));
    stacks[stackIndex].splice(at, 0, panel);
  }
  next.mode = "custom";
  return finish(next);
}

export function hidePanel(layout, panel) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel)) throw Error("Unknown panel.");
  if (layout.hidden.includes(panel))
    return { layout, changed: false, reason: "already" };
  if (PANELS.length - layout.hidden.length <= 1)
    return { layout, changed: false, reason: "last" };
  const from = locate(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  const next = clone(layout);
  next.regions[from.region][from.stack].splice(from.index, 1);
  if (!next.regions[from.region][from.stack].length)
    next.regions[from.region].splice(from.stack, 1);
  next.hidden = [...next.hidden, panel];
  next.mode = "custom";
  return finish(next);
}

// Puts a hidden panel back. `region` is the right column, unless the pinned
// layout has no right column, in which case the caller passes "bottom".
export function showPanel(layout, panel, region = "right") {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel) || !REGIONS.includes(region))
    throw Error("Unknown panel.");
  if (!layout.hidden.includes(panel))
    return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  next.hidden = next.hidden.filter((id) => id !== panel);
  if (!next.regions[region].length) next.regions[region].push([panel]);
  else next.regions[region].at(-1).push(panel);
  next.mode = "custom";
  return finish(next);
}

export function applyPreset(layout, name, presets) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!presets[name]) throw Error("Unknown layout.");
  const next = clone(layout);
  next.mode = name;
  next.regions = clone(presets[name]);
  next.hidden = [];
  next.spans = {};
  return finish(next);
}

export function movePhoneTab(layout, tab, delta) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PHONE_TABS.includes(tab) || (delta !== -1 && delta !== 1))
    throw Error("Unknown move.");
  const index = layout.phoneTabs.indexOf(tab),
    to = index + delta;
  if (to < 0 || to >= layout.phoneTabs.length)
    return { layout, changed: false, reason: "end" };
  const next = clone(layout);
  const [item] = next.phoneTabs.splice(index, 1);
  next.phoneTabs.splice(to, 0, item);
  return finish(next);
}

// The stacks to draw for a named preset or for custom regions, with hidden
// panels removed. Phone and the named presets come from `presets`; custom
// comes from the saved regions.
export function placement(layout, kind, presets) {
  const source = kind === "custom" ? layout.regions : presets[kind];
  const hidden = new Set(layout.hidden),
    regions = blankRegions();
  for (const name of REGIONS)
    for (const stack of source?.[name] || []) {
      const ids = stack.filter((id) => !hidden.has(id));
      if (ids.length) regions[name].push(ids);
    }
  return regions;
}
