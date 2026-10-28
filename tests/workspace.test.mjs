import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_COLLAPSE,
  PANELS,
  PHONE_MAX,
  PRESETS,
  SIDE_MIN,
  presetFor,
} from "../src/workspace.js";

test("the window's size picks the layout", () => {
  // Phones, whatever the orientation.
  assert.equal(presetFor(360, 800), "phone");
  assert.equal(presetFor(PHONE_MAX, 400), "phone");
  assert.equal(presetFor(PHONE_MAX + 1, 400), "column");
  // Landscape: side columns from 1100 px, one column below that.
  assert.equal(presetFor(1920, 1080), "side");
  assert.equal(presetFor(SIDE_MIN, 700), "side");
  assert.equal(presetFor(SIDE_MIN - 1, 700), "column");
  assert.equal(presetFor(800, 600), "column");
  // A square window counts as landscape.
  assert.equal(presetFor(900, 900), "column");
  // Portrait, 760 px or wider: a dock under the image.
  assert.equal(presetFor(768, 1024), "dock");
  assert.equal(presetFor(1200, 1600), "dock");
  assert.equal(presetFor(1080, 1920), "dock");
});

test("every layout holds every panel exactly once", () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), [
    "column",
    "dock",
    "phone",
    "side",
  ]);
  for (const [name, regions] of Object.entries(PRESETS)) {
    const placed = Object.values(regions).flat(2).sort();
    assert.deepEqual(placed, [...PANELS].sort(), name);
  }
});

test("the default layout is the agreed one", () => {
  assert.deepEqual(PRESETS.side.left, [["selection"]]);
  assert.deepEqual(PRESETS.side.right, [
    ["colour", "adjust", "swatches", "outline", "export"],
  ]);
  assert.deepEqual(PRESETS.side.bottom, []);
  // The dock has three columns, and the phone's sheet one place for all.
  assert.equal(PRESETS.dock.bottom.length, 3);
  assert.equal(PRESETS.phone.bottom.length, 1);
});

test("short windows fold Swatches, then Outline, then Export and Selection", () => {
  assert.deepEqual(AUTO_COLLAPSE, [
    "swatches",
    "outline",
    "export",
    "selection",
  ]);
  for (const id of AUTO_COLLAPSE) assert.ok(PANELS.includes(id));
});
