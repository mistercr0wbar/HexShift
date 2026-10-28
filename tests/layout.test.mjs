import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LAYOUT_BYTES,
  PANELS,
  defaultLayout,
  hidePanel,
  insertPanel,
  materialize,
  moveBy,
  movePhoneTab,
  moveToRegion,
  parseLayout,
  placement,
  showPanel,
  applyPreset,
  validateLayout,
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
  assert.equal(layout.mode, "auto");
  assert.equal(layout.locked, false);
  const placed = Object.values(layout.regions).flat(2).sort();
  assert.deepEqual(placed, [...PANELS].sort());
});

test("a saved layout round-trips and drops fields that are not part of it", () => {
  const text =
    '{"v":1,"mode":"auto","locked":false,"collapsed":[],"touched":[],"hidden":[],"regions":{"left":[["selection"]],"right":[["colour","adjust","swatches","outline","export"]],"bottom":[]},"sizes":{"left":null,"right":null,"dock":null},"spans":{},"phoneTabs":["selection","colour","swatches","export"],"image":"secret","__proto__":{"polluted":true}}';
  const clean = parseLayout(text);
  assert.equal(clean.image, undefined);
  assert.equal({}.polluted, undefined);
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
  assert.deepEqual(moved.layout.regions.bottom, [["outline"]]);
  assert.equal(moved.layout.regions.right[0].includes("outline"), false);
  assert.equal(moved.layout.mode, "custom");
  assert.equal(moveToRegion(moved.layout, "outline", "bottom").reason, "already");
  const locked = { ...moved.layout, locked: true };
  assert.equal(moveToRegion(locked, "colour", "left").reason, "locked");
  const up = moveBy(start, "adjust", -1);
  assert.deepEqual(up.layout.regions.right[0].slice(0, 2), ["adjust", "colour"]);
  assert.equal(moveBy(start, "colour", -1).reason, "end");
  assert.equal(moveBy(start, "export", 1).reason, "end");
});

test("a drop uses the gap it was aimed at, including across stacks", () => {
  const start = materialize(defaultLayout(), "dock", presets);
  // Outline is index 1 of bottom stack 2. Insert it before Swatches (index 0).
  const before = insertPanel(start, "outline", {
    region: "bottom",
    stack: 2,
    index: 0,
  });
  assert.deepEqual(before.layout.regions.bottom[2], [
    "outline",
    "swatches",
    "export",
  ]);
  const same = insertPanel(start, "outline", {
    region: "bottom",
    stack: 2,
    index: 1,
  });
  assert.equal(same.reason, "already");
  const toLeft = insertPanel(start, "selection", {
    region: "left",
    stack: 0,
    index: 0,
  });
  assert.deepEqual(toLeft.layout.regions.left, [["selection"]]);
  assert.equal(
    toLeft.layout.regions.bottom.some((stack) => stack.includes("selection")),
    false,
  );
});

test("hide and show keep every panel and will not hide the last one", () => {
  let layout = materialize(defaultLayout(), "side", presets);
  for (const id of ["colour", "adjust", "swatches", "outline", "export"])
    layout = hidePanel(layout, id).layout;
  assert.equal(hidePanel(layout, "selection").reason, "last");
  const back = showPanel(layout, "outline", "right");
  assert.deepEqual(back.layout.regions.right, [["outline"]]);
  assert.equal(back.layout.hidden.includes("outline"), false);
  const placed = placement(back.layout, "custom", presets);
  assert.deepEqual(placed.left, [["selection"]]);
  assert.deepEqual(placed.right, [["outline"]]);
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
  assert.equal(restored.layout.regions.bottom.length, 3);
});
