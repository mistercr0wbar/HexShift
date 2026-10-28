import test from "node:test";
import assert from "node:assert/strict";
import {
  COLOURS_KEY,
  MAX_COLOURS_BYTES,
  createColourStore,
  parseColours,
  validateColours,
} from "../src/colours.js";
import { hsvToHex, rgbToHsv } from "../src/picker.js";

function setup(text = null, fail = false) {
  const messages = [],
    writes = [];
  const storage = {
    getItem: () => text,
    setItem: (key, value) => {
      if (fail) throw Error("Storage is full.");
      writes.push([key, value]);
      text = value;
    },
  };
  return {
    store: createColourStore(
      () => storage,
      (m) => messages.push(m),
    ),
    storage,
    messages,
    writes,
  };
}
test("48 saved colours persist, deduplicate, reorder and remove without storing images", () => {
  const { store, storage, writes } = setup();
  for (let i = 0; i < 48; i++)
    assert.equal(store.add("#" + i.toString(16).padStart(6, "0")), true);
  assert.equal(store.add("#FFFFFF"), false);
  assert.equal(store.add("#000000"), false);
  assert.equal(store.get().saved.length, 48);
  assert.equal(store.move(0, 47), true);
  assert.equal(store.get().saved.at(-1), "#000000");
  assert.equal(store.remove(1), true);
  const reopened = createColourStore(() => storage);
  assert.deepEqual(reopened.get(), store.get());
  assert.deepEqual(Object.keys(JSON.parse(writes.at(-1)[1])), [
    "v",
    "saved",
    "palettes",
  ]);
  assert.equal(writes.at(-1)[0], COLOURS_KEY);
  const copy = store.get();
  copy.saved.length = 0;
  assert.equal(store.get().saved.length, 47);
});
test("saved palettes keep names and colours, enforce all caps and reject duplicate names", () => {
  const { store } = setup();
  const entries = Array.from({ length: 256 }, (_, i) => ({
    hex: "#" + i.toString(16).padStart(6, "0"),
    label: "Colour " + i,
  }));
  assert.equal(store.savePalette("Too big", [...entries, entries[0]]), false);
  for (let i = 0; i < 50; i++)
    assert.equal(
      store.savePalette("Palette " + i, [{ hex: "#abcdef", label: "A" }]),
      true,
    );
  assert.equal(store.savePalette("Extra", entries), false);
  assert.equal(store.get().palettes.length, 50);
  assert.equal(store.get().palettes[0].colours[0].hex, "#ABCDEF");
  store.removePalette(0);
  assert.equal(store.savePalette("palette 1", entries), false);
  assert.equal(store.savePalette("Full", entries), true);
  assert.equal(store.savePalette("", entries), false);
  assert.throws(
    () =>
      validateColours({
        v: 1,
        saved: [],
        palettes: Array.from({ length: 50 }, (_, i) => ({
          name: "Set " + i,
          colours: entries,
        })),
      }),
    /256 KB/,
  );
});
test("unreadable, oversized and unsupported stores are ignored with a visible reason", () => {
  for (const text of [
    "{",
    "null",
    '{"v":2,"saved":[],"palettes":[]}',
    JSON.stringify({ v: 1, saved: ["red"], palettes: [] }),
    " ".repeat(MAX_COLOURS_BYTES + 1),
  ]) {
    const { store, messages, writes } = setup(text);
    assert.deepEqual(store.get(), { v: 1, saved: [], palettes: [] });
    assert.match(messages[0], /could not be read.*ignored/);
    assert.equal(writes.length, 0);
  }
  assert.throws(
    () =>
      parseColours(
        JSON.stringify({
          v: 1,
          saved: Array(49).fill("#000000"),
          palettes: [],
        }),
      ),
    /48/,
  );
  assert.throws(
    () =>
      parseColours(
        JSON.stringify({
          v: 1,
          saved: [],
          palettes: [{ name: "A", colours: [{ hex: "#000000", label: {} }] }],
        }),
      ),
    /labels/,
  );
  const clean = parseColours(
    '{"v":1,"saved":["#abcdef"],"palettes":[],"image":"secret","__proto__":{"polluted":true}}',
  );
  assert.deepEqual(clean, { v: 1, saved: ["#ABCDEF"], palettes: [] });
  assert.equal({}.polluted, undefined);
});
test("failed storage writes preserve the previous state and report the failure", () => {
  const { store, messages } = setup(null, true);
  assert.equal(store.add("#123456"), false);
  assert.deepEqual(store.get().saved, []);
  assert.match(messages[0], /Storage is full/);
  const blocked = createColourStore(() => {
    throw Error("Blocked");
  });
  assert.equal(blocked.add("#123456"), false);
});
test("the HSV picker round trips RGB, including black, white and hue wrap", () => {
  for (const rgb of [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [88, 101, 242],
    [12, 34, 56],
  ]) {
    assert.equal(
      hsvToHex(...rgbToHsv(rgb)),
      "#" +
        rgb
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
    );
  }
  assert.equal(hsvToHex(360, 1, 1), "#FF0000");
});
