import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LAYOUT_BYTES,
  PANELS,
  defaultLayout,
  hidePanel,
  materialize,
  moveBy,
  movePhoneTab,
  moveToRegion,
  panelsIn,
  parseLayout,
  placePanel,
  placeRelative,
  placement,
  showPanel,
  applyPreset,
  validateLayout,
  fitSavedSizes,
} from "../src/layout.js";

const presets = {
  side: {
    left: [["selection"]],
    right: [["colour", "adjust", "swatches", "outline", "export"]],
    bottom: [],
  },
  column: {
    left: [],
    right: [["selection", "colour", "adjust", "swatches", "outline", "export"]],
    bottom: [],
  },
  dock: {
    left: [],
    right: [],
    bottom: [["selection"], ["colour", "adjust"], ["swatches", "outline", "export"]],
  },
};

test("the default layout is valid and keeps every panel once", () => {
  const layout = validateLayout(defaultLayout());
  assert.equal(layout.v, 2);
  assert.equal(layout.mode, "auto");
  assert.equal(layout.locked, false);
  assert.deepEqual(layout.collapsed, ["adjust"]);
  assert.deepEqual(panelsIn(layout.regions.left), ["selection"]);
  assert.deepEqual(panelsIn(layout.regions.right), [
    "colour",
    "adjust",
    "swatches",
    "outline",
    "export",
  ]);
  assert.equal(layout.regions.bottom, null);
  const placed = REGIONS(layout)
    .flat()
    .sort();
  assert.deepEqual(placed, [...PANELS].sort());
});

function REGIONS(layout) {
  return Object.values(layout.regions).map((node) => panelsIn(node));
}

test("a saved layout round-trips and drops fields that are not part of it", () => {
  const text =
    '{"v":1,"mode":"auto","locked":false,"collapsed":[],"touched":[],"hidden":[],"regions":{"left":[["selection"]],"right":[["colour","adjust","swatches","outline","export"]],"bottom":[]},"sizes":{"left":null,"right":null,"dock":null},"spans":{},"phoneTabs":["selection","colour","swatches","export"],"image":"secret","__proto__":{"polluted":true}}';
  const clean = parseLayout(text);
  assert.equal(clean.v, 2);
  assert.equal(clean.image, undefined);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(panelsIn(clean.regions.left), ["selection"]);
  assert.equal(clean.regions.left.t, "leaf");
  assert.equal(clean.regions.right.t, "split");
  assert.equal(clean.regions.right.d, "v");
  assert.equal(clean.regions.bottom, null);
  assert.deepEqual(clean.phoneTabs, [
    "selection",
    "colour",
    "swatches",
    "export",
  ]);
});

test("unreadable, oversized and unsupported layouts are ignored", () => {
  for (const text of [
    "{",
    "null",
    "[]",
    '{"v":2,"mode":"auto","locked":false,"collapsed":[],"touched":[],"hidden":[],"regions":{},"sizes":{},"spans":{},"phoneTabs":[]}',
    " ".repeat(MAX_LAYOUT_BYTES + 1),
    JSON.stringify({ ...defaultLayout(), mode: "floating" }),
    JSON.stringify({
      ...defaultLayout(),
      regions: {
        left: [["selection"]],
        right: [["selection"]],
        bottom: [],
      },
    }),
    JSON.stringify({
      ...defaultLayout(),
      sizes: { left: 10, right: null, dock: null },
    }),
    JSON.stringify({
      ...defaultLayout(),
      phoneTabs: ["selection", "colour", "swatches", "selection"],
    }),
  ])
    assert.throws(() => parseLayout(text), /could not be read and was ignored/);
});

test("moving a panel changes its region and refuses a locked or no-op move", () => {
  const start = materialize(defaultLayout(), "side", presets);
  const moved = moveToRegion(start, "outline", "bottom");
  assert.equal(moved.changed, true);
  assert.deepEqual(panelsIn(moved.layout.regions.bottom), ["outline"]);
  assert.equal(panelsIn(moved.layout.regions.right).includes("outline"), false);
  assert.equal(moved.layout.mode, "custom");
  assert.equal(moveToRegion(moved.layout, "outline", "bottom").reason, "already");
  const locked = { ...moved.layout, locked: true };
  assert.equal(moveToRegion(locked, "colour", "left").reason, "locked");
  const up = moveBy(start, "adjust", -1);
  assert.deepEqual(panelsIn(up.layout.regions.right).slice(0, 2), [
    "adjust",
    "colour",
  ]);
  assert.equal(moveBy(start, "colour", -1).reason, "end");
  assert.equal(moveBy(start, "export", 1).reason, "end");
});

test("a drop tabs into the centre and places the panel beside an edge", () => {
  const start = materialize(defaultLayout(), "dock", presets);
  const above = placePanel(start, "outline", {
    region: "bottom",
    zone: "above",
    target: "swatches",
  });
  assert.deepEqual(panelsIn(above.layout.regions.bottom.children[2]), [
    "outline",
    "swatches",
    "export",
  ]);
  const same = placePanel(start, "outline", {
    region: "bottom",
    zone: "below",
    target: "swatches",
  });
  assert.equal(same.reason, "already");
  const toLeft = placePanel(start, "selection", {
    region: "left",
    zone: "end",
  });
  assert.deepEqual(panelsIn(toLeft.layout.regions.left), ["selection"]);
  assert.equal(panelsIn(toLeft.layout.regions.bottom).includes("selection"), false);
  const beside = placePanel(start, "adjust", {
    region: "bottom",
    zone: "left",
    target: "colour",
  });
  assert.deepEqual(panelsIn(beside.layout.regions.bottom.children[1]), ["adjust"]);
  assert.deepEqual(panelsIn(beside.layout.regions.bottom.children[2]), ["colour"]);
  const side = materialize(defaultLayout(), "side", presets);
  const nested = placePanel(side, "adjust", {
    region: "right",
    zone: "left",
    target: "swatches",
  });
  const wrapped = nested.layout.regions.right.children.find(
    (node) => node.t === "split",
  );
  assert.equal(wrapped.d, "h");
  assert.deepEqual(panelsIn(wrapped), ["adjust", "swatches"]);
  const tabs = placePanel(start, "adjust", {
    region: "bottom",
    zone: "centre",
    target: "colour",
  });
  const group = tabs.layout.regions.bottom.children[1];
  assert.equal(group.t, "leaf");
  assert.deepEqual(group.panels, ["colour", "adjust"]);
  assert.equal(group.active, "adjust");
  const menu = placeRelative(start, "adjust", "centre");
  assert.equal(menu.changed, true);
  assert.equal(menu.beside, "swatches");
  assert.equal(menu.layout.regions.bottom.children[2].children[0].t, "leaf");
  assert.deepEqual(menu.layout.regions.bottom.children[2].children[0].panels, [
    "swatches",
    "adjust",
  ]);
});

test("hide and show keep every panel and will not hide the last one", () => {
  let layout = materialize(defaultLayout(), "side", presets);
  for (const id of ["colour", "adjust", "swatches", "outline", "export"])
    layout = hidePanel(layout, id).layout;
  assert.equal(hidePanel(layout, "selection").reason, "last");
  const back = showPanel(layout, "outline", "right");
  assert.deepEqual(panelsIn(back.layout.regions.right), ["outline"]);
  assert.equal(back.layout.hidden.includes("outline"), false);
  const placed = placement(back.layout, "custom", presets);
  assert.deepEqual(panelsIn(placed.left), ["selection"]);
  assert.deepEqual(panelsIn(placed.right), ["outline"]);
});

test("phone tab order moves without touching regions, and a preset restores them", () => {
  const start = defaultLayout();
  const shifted = movePhoneTab(start, "export", -1);
  assert.deepEqual(shifted.layout.phoneTabs, [
    "selection",
    "colour",
    "export",
    "swatches",
  ]);
  assert.equal(shifted.layout.mode, "auto");
  assert.equal(movePhoneTab(start, "selection", -1).reason, "end");
  const pinned = materialize(start, "side", presets);
  const hidden = hidePanel(pinned, "swatches").layout;
  const restored = applyPreset(hidden, "dock", presets);
  assert.equal(restored.layout.mode, "dock");
  assert.deepEqual(restored.layout.hidden, []);
  assert.equal(restored.layout.regions.bottom.t, "split");
  assert.equal(restored.layout.regions.bottom.d, "h");
  assert.equal(restored.layout.regions.bottom.children.length, 3);
});

test("version 1 dock stacks migrate to a horizontal split and are not rewritten here", () => {
  const saved = {
    v: 1,
    mode: "dock",
    locked: false,
    collapsed: ["swatches"],
    touched: ["swatches"],
    hidden: [],
    regions: presets.dock,
    sizes: { left: null, right: null, dock: 480 },
    spans: { colour: 80 },
    phoneTabs: ["selection", "colour", "swatches", "export"],
  };
  const clean = validateLayout(saved);
  assert.equal(clean.v, 2);
  assert.equal(clean.mode, "dock");
  assert.equal(clean.regions.bottom.d, "h");
  assert.deepEqual(
    clean.regions.bottom.children.map((node) => panelsIn(node)),
    [["selection"], ["colour", "adjust"], ["swatches", "outline", "export"]],
  );
  assert.equal(clean.sizes.dock, 480);
  assert.equal(clean.spans.colour, 80);
  assert.deepEqual(clean.collapsed, ["swatches"]);
  assert.equal(saved.v, 1);
});

test("saved column sizes fit the window and the stored choice is not rewritten", () => {
  const preferred = { left: 520, right: 520, dock: 600 };
  const narrow = fitSavedSizes(preferred, {
    width: 800,
    height: 640,
    left: true,
    right: true,
    bottom: true,
  });
  assert.equal(narrow.left + narrow.right, 440);
  assert.ok(narrow.left < 520 && narrow.right < 520);
  assert.equal(narrow.dock, 420);
  assert.deepEqual(preferred, { left: 520, right: 520, dock: 600 });
  const wide = fitSavedSizes(preferred, {
    width: 1920,
    height: 1000,
    left: true,
    right: true,
    bottom: false,
  });
  assert.deepEqual(
    { left: wide.left, right: wide.right, dock: wide.dock },
    { left: 520, right: 520, dock: null },
  );
  const one = fitSavedSizes(
    { left: null, right: 520, dock: null },
    { width: 800, height: 720, left: false, right: true, bottom: false },
  );
  assert.deepEqual(one, { left: null, right: 440, dock: null });
  const unknown = fitSavedSizes(preferred, {
    width: 0,
    height: 0,
    left: true,
    right: true,
    bottom: true,
  });
  assert.deepEqual(unknown, preferred);
});
