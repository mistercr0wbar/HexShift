// The saved workspace. Images never enter this store: only where the panels
// sit, which of them the person has folded or hidden, the column sizes, and
// the order of the phone sheet's tabs.
//
// Version 2 stores each region as a split tree. A split is horizontal or
// vertical. A leaf is a tab group (one panel looks as it does today). Version 1
// is read and migrated in memory: each old stack becomes a vertical split of
// single-panel leaves, and a region's stacks become a horizontal split. Nothing
// here writes storage. Empty nodes collapse. Every panel id appears once.
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
  CENTRE_MIN = 220,
  // Drop zones. "centre" tabs into the group under the pointer. An edge places
  // the panel on that side. "end" appends to an empty region.
  ZONES = ["left", "right", "above", "below", "centre", "end"];

// Saved column and dock sizes are what the person chose. The sizes applied to
// the page can be smaller while the window cannot hold them. Null stays null
// so the stylesheet's own clamp is left alone. The stored sizes are not changed.
// Load, resize, move, restore and the drag preview all ask this one function
// for the outer columns. Tool regions shrink toward the picture's reserve
// first. A tab group is the compact form when panels share a leaf; a panel
// that is still too short scrolls inside itself.
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

export const allocate = fitSavedSizes;

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
const blankRegions = () => ({ left: null, right: null, bottom: null });

function leaf(panels, active) {
  const ids = panels.slice();
  return {
    t: "leaf",
    panels: ids,
    active: ids.includes(active) ? active : ids[0],
  };
}

function stackNode(ids) {
  if (!ids.length) return null;
  if (ids.length === 1) return leaf(ids);
  return { t: "split", d: "v", children: ids.map((id) => leaf([id])), flex: ids.map(() => 1) };
}

// Turns a version 1 region (a list of stacks) into a version 2 tree.
export function stacksToRegions(source, hidden = new Set()) {
  const regions = blankRegions();
  for (const name of REGIONS) {
    const cols = [];
    for (const stack of source?.[name] || []) {
      const ids = stack.filter((id) => !hidden.has(id));
      const node = stackNode(ids);
      if (node) cols.push(node);
    }
    regions[name] =
      cols.length === 0
        ? null
        : cols.length === 1
          ? cols[0]
          : { t: "split", d: "h", children: cols, flex: cols.map(() => 1) };
  }
  return regions;
}

export function defaultLayout() {
  return {
    v: 2,
    mode: "auto",
    locked: false,
    collapsed: [],
    touched: [],
    hidden: [],
    regions: stacksToRegions({
      left: [["selection"]],
      right: [["colour", "adjust", "swatches", "outline", "export"]],
      bottom: [],
    }),
    sizes: { left: null, right: null, dock: null },
    spans: {},
    phoneTabs: [...PHONE_TABS],
  };
}

export function panelsIn(node, out = []) {
  if (!node) return out;
  if (node.t === "leaf") {
    out.push(...node.panels);
    return out;
  }
  for (const child of node.children) panelsIn(child, out);
  return out;
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

function readRegionsV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Regions are missing.");
  const regions = { left: [], right: [], bottom: [] },
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

function readFlex(value, count) {
  if (!Array.isArray(value) || value.length !== count) return Array(count).fill(1);
  const flex = [];
  for (const n of value) {
    if (!Number.isInteger(n) || n < 1 || n > 4000) return Array(count).fill(1);
    flex.push(n);
  }
  return flex;
}

function readNode(value, seen) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("A split is missing.");
  if (value.t === "leaf") {
    if (!Array.isArray(value.panels) || !value.panels.length)
      throw Error("A tab group needs a panel.");
    const panels = [];
    for (const id of value.panels) {
      if (!PANELS.includes(id) || seen.has(id))
        throw Error("Each panel is placed once.");
      seen.add(id);
      panels.push(id);
    }
    return leaf(panels, value.active);
  }
  if (value.t !== "split" || (value.d !== "h" && value.d !== "v"))
    throw Error("A split is missing.");
  if (!Array.isArray(value.children) || value.children.length < 2)
    throw Error("A split needs two sides.");
  const children = value.children.map((child) => readNode(child, seen));
  return { t: "split", d: value.d, children, flex: readFlex(value.flex, children.length) };
}

function readRegionsV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Regions are missing.");
  const regions = blankRegions(),
    seen = new Set();
  for (const name of REGIONS) {
    if (!Object.hasOwn(value, name)) throw Error("Regions are missing.");
    regions[name] = value[name] == null ? null : readNode(value[name], seen);
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

function finishFields(source, regions) {
  return {
    v: 2,
    mode: source.mode,
    locked: source.locked,
    collapsed: idList(source.collapsed, "Collapsed panels"),
    touched: idList(source.touched, "Touched panels"),
    hidden: idList(source.hidden, "Hidden panels"),
    regions,
    sizes: readSizes(source.sizes),
    spans: readSpans(source.spans),
    phoneTabs: readPhoneTabs(source.phoneTabs),
  };
}

function assertCovered(hidden, seen) {
  for (const id of hidden) {
    if (seen.has(id)) throw Error("A hidden panel is also placed.");
  }
  for (const id of PANELS) {
    if (!seen.has(id) && !hidden.includes(id)) throw Error("A panel is missing.");
  }
}

// Rebuilds the store field by field. Extra fields, including anything that
// would ride in on a prototype, are dropped. Version 1 is migrated and returned
// as version 2; the caller decides whether to write that back.
export function validateLayout(source) {
  if (!MODES.includes(source?.mode)) throw Error("This layout format is not supported.");
  if (typeof source?.locked !== "boolean") throw Error("Lock must be yes or no.");
  if (source.v === 1) {
    const { regions, seen } = readRegionsV1(source.regions),
      hidden = idList(source.hidden, "Hidden panels");
    assertCovered(hidden, seen);
    const next = finishFields(source, stacksToRegions(regions));
    next.hidden = hidden;
    return next;
  }
  if (source.v !== 2) throw Error("This layout format is not supported.");
  const { regions, seen } = readRegionsV2(source.regions),
    hidden = idList(source.hidden, "Hidden panels");
  assertCovered(hidden, seen);
  const next = finishFields(source, regions);
  next.hidden = hidden;
  return next;
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

function findNode(node, panel, path = []) {
  if (!node) return null;
  if (node.t === "leaf") {
    const index = node.panels.indexOf(panel);
    if (index < 0) return null;
    return { path, index, node };
  }
  for (let i = 0; i < node.children.length; i++) {
    const hit = findNode(node.children[i], panel, path.concat(i));
    if (hit) return hit;
  }
  return null;
}

function findIn(regions, panel) {
  for (const region of REGIONS) {
    const hit = findNode(regions[region], panel);
    if (hit) return { region, ...hit };
  }
  return null;
}

export function locate(regions, panel) {
  const hit = findIn(regions, panel);
  if (!hit) return null;
  const order = panelsIn(regions[hit.region]);
  return {
    region: hit.region,
    index: order.indexOf(panel),
    tabIndex: hit.index,
    tabs: hit.node.panels.slice(),
    active: hit.node.active,
    path: hit.path.slice(),
  };
}

function blocked(layout) {
  return layout.locked ? { layout, changed: false, reason: "locked" } : null;
}

function finish(layout) {
  return { layout: validateLayout(layout), changed: true };
}

function updateAt(node, path, fn) {
  if (!path.length) return fn(node);
  const [index, ...rest] = path;
  const children = node.children.slice();
  children[index] = updateAt(children[index], rest, fn);
  return { t: "split", d: node.d, children, flex: node.flex };
}

function parentOf(node, path) {
  if (!path.length) return null;
  let current = node;
  for (let i = 0; i < path.length - 1; i++) current = current.children[path[i]];
  return current;
}

// Drops a panel and collapses a leaf or a split that can no longer stand.
function without(node, id) {
  if (!node) return null;
  if (node.t === "leaf") {
    if (!node.panels.includes(id)) return node;
    const panels = node.panels.filter((item) => item !== id);
    if (!panels.length) return null;
    return leaf(panels, node.active === id ? panels[0] : node.active);
  }
  const children = [],
    flex = [];
  node.children.forEach((child, i) => {
    const next = without(child, id);
    if (!next) return;
    children.push(next);
    flex.push(node.flex?.[i] ?? 1);
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { t: "split", d: node.d, children, flex };
}

function appendLeaf(node, panel) {
  const added = leaf([panel]);
  if (!node) return added;
  if (node.t === "leaf")
    return { t: "split", d: "v", children: [node, added], flex: [1, 1] };
  if (node.d === "v")
    return {
      t: "split",
      d: "v",
      children: [...node.children, added],
      flex: [...(node.flex || node.children.map(() => 1)), 1],
    };
  const children = node.children.slice();
  children[children.length - 1] = appendLeaf(children[children.length - 1], panel);
  return { t: "split", d: "h", children, flex: node.flex };
}

function insertZone(root, target, panel, zone) {
  const hit = findNode(root, target);
  if (!hit) return appendLeaf(root, panel);
  if (zone === "centre")
    return updateAt(root, hit.path, (node) => leaf([...node.panels, panel], panel));
  const dir = zone === "left" || zone === "right" ? "h" : "v",
    before = zone === "left" || zone === "above",
    added = leaf([panel]);
  if (!hit.path.length) {
    const children = before ? [added, root] : [root, added];
    return { t: "split", d: dir, children, flex: [1, 1] };
  }
  const parentPath = hit.path.slice(0, -1),
    index = hit.path.at(-1);
  return updateAt(root, parentPath, (parent) => {
    if (parent.d === dir) {
      const children = parent.children.slice(),
        at = before ? index : index + 1;
      children.splice(at, 0, added);
      const flex = (parent.flex || parent.children.map(() => 1)).slice();
      flex.splice(at, 0, 1);
      return { t: "split", d: dir, children, flex };
    }
    const kids = before ? [added, parent.children[index]] : [parent.children[index], added];
    const children = parent.children.slice();
    children[index] = { t: "split", d: dir, children: kids, flex: [1, 1] };
    return { t: "split", d: parent.d, children, flex: parent.flex };
  });
}

// True when `panel` is already the single-panel leaf immediately on `zone`'s
// side of `target`, so the drop would not move it.
function alreadyBeside(root, panel, target, zone) {
  const hit = findNode(root, target);
  if (!hit) return false;
  const parent = parentOf(root, hit.path);
  if (!parent || parent.t !== "split") return false;
  const dir = zone === "left" || zone === "right" ? "h" : "v";
  if (parent.d !== dir) return false;
  const index = hit.path.at(-1);
  const neighbor = parent.children[zone === "left" || zone === "above" ? index - 1 : index + 1];
  return neighbor?.t === "leaf" && neighbor.panels.length === 1 && neighbor.panels[0] === panel;
}

// Copies the arrangement on screen into `regions` and marks it custom, so a
// later move edits what the person is looking at. `kind` is side, column or
// dock. Hidden panels are left in `hidden` and taken out of the tree.
export function materialize(layout, kind, presets) {
  if (layout.mode === "custom") return layout;
  if (!presets[kind]) throw Error("Unknown layout.");
  const next = clone(layout);
  next.regions = stacksToRegions(presets[kind], new Set(next.hidden));
  next.mode = "custom";
  return validateLayout(next);
}

export function moveToRegion(layout, panel, region) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel) || !REGIONS.includes(region)) throw Error("Unknown move.");
  if (layout.hidden.includes(panel)) return { layout, changed: false, reason: "hidden" };
  const from = locate(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  if (from.region === region) return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  for (const name of REGIONS) next.regions[name] = without(next.regions[name], panel);
  next.regions[region] = appendLeaf(next.regions[region], panel);
  next.mode = "custom";
  return finish(next);
}

export function canStep(regions, panel, delta) {
  const hit = findIn(regions, panel);
  if (!hit || (delta !== -1 && delta !== 1)) return false;
  if (hit.node.panels.length > 1) {
    const index = hit.index + delta;
    return index >= 0 && index < hit.node.panels.length;
  }
  if (!hit.path.length) return false;
  const parent = parentOf(regions[hit.region], hit.path);
  if (!parent || parent.d !== "v") return false;
  const index = hit.path.at(-1) + delta;
  return index >= 0 && index < parent.children.length;
}

export function moveBy(layout, panel, delta) {
  const stop = blocked(layout);
  if (stop) return stop;
  if ((delta !== -1 && delta !== 1) || !PANELS.includes(panel)) throw Error("Unknown move.");
  if (layout.hidden.includes(panel)) return { layout, changed: false, reason: "hidden" };
  const from = findIn(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  if (!canStep(layout.regions, panel, delta))
    return { layout, changed: false, reason: "end" };
  const next = clone(layout);
  const root = next.regions[from.region];
  const hit = findNode(root, panel);
  if (hit.node.panels.length > 1) {
    const panels = hit.node.panels.slice();
    const [item] = panels.splice(hit.index, 1);
    panels.splice(hit.index + delta, 0, item);
    next.regions[from.region] = updateAt(root, hit.path, (node) => leaf(panels, node.active));
  } else {
    const parentPath = hit.path.slice(0, -1),
      index = hit.path.at(-1);
    next.regions[from.region] = updateAt(root, parentPath, (node) => {
      const children = node.children.slice();
      const [item] = children.splice(index, 1);
      children.splice(index + delta, 0, item);
      const flex = (node.flex || children.map(() => 1)).slice();
      if (flex.length === node.children.length) {
        const [share] = flex.splice(index, 1);
        flex.splice(index + delta, 0, share);
      }
      return { t: "split", d: "v", children, flex };
    });
  }
  next.mode = "custom";
  return finish(next);
}

// `dest.zone` is left, right, above, below, centre or end. `dest.target` is
// the panel under the pointer, omitted when the zone is the end of a region.
// The same function builds the drag preview and the committed layout.
export function placePanel(layout, panel, dest) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (
    !PANELS.includes(panel) ||
    !REGIONS.includes(dest?.region) ||
    !ZONES.includes(dest.zone) ||
    (dest.zone !== "end" && !PANELS.includes(dest.target))
  )
    throw Error("Unknown move.");
  if (layout.hidden.includes(panel)) return { layout, changed: false, reason: "hidden" };
  if (!locate(layout.regions, panel)) throw Error("Missing panel.");
  if (dest.zone !== "end" && dest.target === panel)
    return { layout, changed: false, reason: "already" };
  if (dest.zone === "centre") {
    const host = findNode(layout.regions[dest.region], dest.target);
    if (host?.node.panels.includes(panel))
      return { layout, changed: false, reason: "already" };
  } else if (
    dest.zone !== "end" &&
    alreadyBeside(layout.regions[dest.region], panel, dest.target, dest.zone)
  )
    return { layout, changed: false, reason: "already" };
  if (dest.zone !== "end" && dest.zone !== "centre" && !findNode(layout.regions[dest.region], dest.target)) {
    // The target lives in another region. Placing beside it means moving there.
  } else if (dest.zone !== "end" && !findIn(layout.regions, dest.target))
    throw Error("Missing panel.");
  const next = clone(layout);
  for (const name of REGIONS) next.regions[name] = without(next.regions[name], panel);
  if (!findNode(next.regions[dest.region], dest.target) && dest.zone !== "end")
    next.regions[dest.region] = appendLeaf(next.regions[dest.region], panel);
  else if (dest.zone === "end")
    next.regions[dest.region] = appendLeaf(next.regions[dest.region], panel);
  else
    next.regions[dest.region] = insertZone(
      next.regions[dest.region],
      dest.target,
      panel,
      dest.zone,
    );
  next.mode = "custom";
  const result = finish(next);
  if (JSON.stringify(result.layout.regions) === JSON.stringify(layout.regions))
    return { layout, changed: false, reason: "already" };
  return result;
}

function neighborPanel(root, hit, dir) {
  const order = panelsIn(root),
    mine = new Set(hit.node.panels);
  let i = dir > 0 ? order.indexOf(hit.node.panels.at(-1)) + 1 : order.indexOf(hit.node.panels[0]) - 1;
  while (i >= 0 && i < order.length) {
    if (!mine.has(order[i])) return order[i];
    i += dir;
  }
  return null;
}

// Menu placements. Centre groups this panel with a neighbour. An edge places
// it on that side of a neighbour, or lifts it out of a tab group.
export function placeRelative(layout, panel, zone) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!["left", "right", "above", "below", "centre"].includes(zone) || !PANELS.includes(panel))
    throw Error("Unknown move.");
  if (layout.hidden.includes(panel)) return { layout, changed: false, reason: "hidden" };
  const from = findIn(layout.regions, panel);
  if (!from) throw Error("Missing panel.");
  const root = layout.regions[from.region];
  const hit = findNode(root, panel);
  if (zone === "centre" || hit.node.panels.length === 1) {
    const toward = zone === "left" || zone === "above" ? -1 : 1;
    const neighbor =
      zone === "centre" || hit.node.panels.length === 1
        ? neighborPanel(root, hit, zone === "centre" ? 1 : toward) ||
          neighborPanel(root, hit, zone === "centre" ? -1 : -toward)
        : null;
    if (!neighbor) return { layout, changed: false, reason: "end" };
    const moved = placePanel(layout, panel, { region: from.region, zone, target: neighbor });
    return moved.changed ? { ...moved, beside: neighbor } : moved;
  }
  const other = hit.node.panels.find((id) => id !== panel);
  const moved = placePanel(layout, panel, { region: from.region, zone, target: other });
  return moved.changed ? { ...moved, beside: other } : moved;
}

export function setActive(layout, panel) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel)) throw Error("Unknown panel.");
  const from = findIn(layout.regions, panel);
  if (!from) return { layout, changed: false, reason: "hidden" };
  if (from.node.panels.length < 2 || from.node.active === panel)
    return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  next.regions[from.region] = updateAt(next.regions[from.region], from.path, (node) =>
    leaf(node.panels, panel),
  );
  return finish(next);
}

export function setFlex(layout, region, path, flex) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!REGIONS.includes(region) || !Array.isArray(path)) throw Error("Unknown move.");
  const node = path.length ? path.reduce((current, index) => current?.children?.[index], layout.regions[region]) : layout.regions[region];
  if (!node || node.t !== "split" || !Array.isArray(flex) || flex.length !== node.children.length)
    return { layout, changed: false, reason: "already" };
  const clean = [];
  for (const n of flex) {
    if (!Number.isInteger(n) || n < 1 || n > 4000)
      return { layout, changed: false, reason: "already" };
    clean.push(n);
  }
  if (node.flex && clean.every((n, i) => n === node.flex[i]))
    return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  const apply = (current) => ({ t: "split", d: current.d, children: current.children, flex: clean });
  next.regions[region] = path.length ? updateAt(next.regions[region], path, apply) : apply(next.regions[region]);
  next.mode = "custom";
  return finish(next);
}

export function hidePanel(layout, panel) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel)) throw Error("Unknown panel.");
  if (layout.hidden.includes(panel)) return { layout, changed: false, reason: "already" };
  if (PANELS.length - layout.hidden.length <= 1)
    return { layout, changed: false, reason: "last" };
  if (!locate(layout.regions, panel)) throw Error("Missing panel.");
  const next = clone(layout);
  for (const name of REGIONS) next.regions[name] = without(next.regions[name], panel);
  next.hidden = [...next.hidden, panel];
  next.mode = "custom";
  return finish(next);
}

// Puts a hidden panel back. `region` is the right column, unless the pinned
// layout has no right column, in which case the caller passes "bottom".
export function showPanel(layout, panel, region = "right") {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PANELS.includes(panel) || !REGIONS.includes(region)) throw Error("Unknown panel.");
  if (!layout.hidden.includes(panel)) return { layout, changed: false, reason: "already" };
  const next = clone(layout);
  next.hidden = next.hidden.filter((id) => id !== panel);
  next.regions[region] = appendLeaf(next.regions[region], panel);
  next.mode = "custom";
  return finish(next);
}

export function applyPreset(layout, name, presets) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!presets[name]) throw Error("Unknown layout.");
  const next = clone(layout);
  next.mode = name;
  next.regions = stacksToRegions(presets[name]);
  next.hidden = [];
  next.spans = {};
  return finish(next);
}

export function movePhoneTab(layout, tab, delta) {
  const stop = blocked(layout);
  if (stop) return stop;
  if (!PHONE_TABS.includes(tab) || (delta !== -1 && delta !== 1)) throw Error("Unknown move.");
  const index = layout.phoneTabs.indexOf(tab),
    to = index + delta;
  if (to < 0 || to >= layout.phoneTabs.length)
    return { layout, changed: false, reason: "end" };
  const next = clone(layout);
  const [item] = next.phoneTabs.splice(index, 1);
  next.phoneTabs.splice(to, 0, item);
  return finish(next);
}

// The tree to draw for a named preset or for custom regions, with hidden
// panels removed. Phone and the named presets come from `presets`; custom
// comes from the saved regions.
export function placement(layout, kind, presets) {
  if (kind === "custom") {
    const hidden = new Set(layout.hidden),
      regions = blankRegions();
    for (const name of REGIONS) {
      let node = layout.regions[name];
      for (const id of hidden) node = without(node, id);
      regions[name] = node;
    }
    return regions;
  }
  return stacksToRegions(presets[kind], new Set(layout.hidden));
}
