import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  deltasFor,
  fromModel,
  hueDistance,
  parseColour,
  toHex,
  toModel,
} from "../src/colour.js";
import { prepare, processImage, validateEdit } from "../src/engine.js";
import {
  SETS,
  isPaletteFile,
  parsePalette,
  writeGpl,
} from "../src/palettes.js";
import { monotoneCubic, rampShift, shadeGroups } from "../src/tones.js";
test("typed colours: hex, rgb() and hsl() in both syntaxes, opaque only", () => {
  for (const [text, rgb] of [
    ["#5865F2", [88, 101, 242]],
    ["5865f2", [88, 101, 242]],
    [" #ABC ", [170, 187, 204]],
    ["rgb(88, 101, 242)", [88, 101, 242]],
    ["RGB(88 101 242)", [88, 101, 242]],
    ["rgb(100% 0% 50%)", [255, 0, 128]],
    ["rgba(1, 2, 3, 1)", [1, 2, 3]],
    ["rgb(1 2 3 / 100%)", [1, 2, 3]],
    ["hsl(0, 100%, 50%)", [255, 0, 0]],
    ["hsl(120deg 100% 25%)", [0, 128, 0]],
    ["hsl(-240 100% 50%)", [0, 255, 0]],
  ])
    assert.deepEqual(parseColour(text), rgb, text);
  for (const bad of [
    "",
    "blue",
    "#12345",
    "rgb(256, 0, 0)",
    "rgb(-1 0 0)",
    "rgba(1, 2, 3, 0.5)",
    "rgb(1, 2)",
    "hsl(0, 100, 50)",
    "hsl(0 120% 50%)",
    "rgb(1, 2, 3, 4, 5)",
  ])
    assert.equal(parseColour(bad), null, bad);
});
test("palette files: GIMP, JASC, Paint.NET, Lospec and pasted lists", () => {
  const hexes = (text) => parsePalette(text).map((e) => e.hex);
  assert.deepEqual(
    parsePalette(
      "GIMP Palette\nName: Brand\nColumns: 4\n# comment\n 88 101 242\tBlurple\n255 255 255 White\n",
    ),
    [
      { hex: "#5865F2", label: "Blurple" },
      { hex: "#FFFFFF", label: "White" },
    ],
  );
  assert.deepEqual(hexes("JASC-PAL\r\n0100\r\n2\r\n255 0 0\r\n0 0 255\r\n"), [
    "#FF0000",
    "#0000FF",
  ]);
  assert.deepEqual(hexes("; Paint.NET Palette\nFFFF0000\n8000FF00\n"), [
    "#FF0000",
    "#00FF00",
  ]);
  assert.deepEqual(hexes("ff0000\n00ff00\nff0000\n"), ["#FF0000", "#00FF00"]);
  assert.deepEqual(
    hexes("Brand: #5865F2, #fff; a facade of 248046 and 10 20 30\n10, 20, 30"),
    ["#5865F2", "#FFFFFF", "#0A141E"],
  );
  for (const [bad, reason] of [
    ["", /No colours/],
    ["hello world", /No colours/],
    ["GIMP Palette\nnot a colour\n", /not a colour/],
    ["GIMP Palette\n300 0 0\n", /Invalid colour/],
    ["JASC-PAL\n0100\n3\n1 2 3\n", /count/],
    ["JASC-PAL\n9999\n1\n1 2 3\n", /header/],
    ["#ffffff\n".repeat(40000), /256 KB/],
    [
      Array.from(
        { length: 1025 },
        (_, i) => "#" + i.toString(16).padStart(6, "0"),
      ).join("\n"),
      /1,024/,
    ],
  ])
    assert.throws(() => parsePalette(bad), reason);
  assert.ok(isPaletteFile({ name: "brand.GPL", type: "" }));
  assert.ok(isPaletteFile({ name: "x", type: "text/plain" }));
  assert.ok(!isPaletteFile({ name: "heart.svg", type: "image/svg+xml" }));
});
test("GIMP palettes written by Hex Shift read back the same", () => {
  for (const set of SETS) {
    const entries = set.entries.map(({ hex, label }) => ({ hex, label }));
    assert.deepEqual(parsePalette(writeGpl(set.label, entries)), entries);
  }
  assert.ok(
    writeGpl("A\nB", [{ hex: "#010203", label: "x\ty" }]).startsWith(
      "GIMP Palette\nName: A B\n",
    ),
  );
});
test("built-in sets: valid colours, rainbow at one brightness, five skin tones each", () => {
  for (const set of SETS)
    for (const entry of set.entries) {
      assert.match(entry.hex, /^#[\dA-F]{6}$/);
      if (entry.ramp) assert.equal(entry.ramp[0], entry.hex);
    }
  const rainbow = SETS.find((s) => s.id === "rainbow").entries;
  assert.equal(rainbow.length, 12);
  for (const { hex } of rainbow) {
    const l = toModel(
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
      "oklch",
    )[2];
    assert.ok(Math.abs(l - 0.7) < 0.01, hex);
  }
  const skins = SETS.filter((s) => s.id.startsWith("skin-"));
  assert.equal(skins.length, 4);
  for (const s of skins) assert.equal(s.entries.length, 5);
});
test("monotone curve passes through every anchor and never reverses", () => {
  const xs = [0, 0.2, 0.45, 0.5, 1],
    ys = [0, 0.6, 0.62, 0.9, 1],
    f = monotoneCubic(xs, ys);
  xs.forEach((x, i) => assert.ok(Math.abs(f(x) - ys[i]) < 1e-12));
  let previous = -Infinity;
  for (let x = 0; x <= 1; x += 1 / 512) {
    assert.ok(f(x) >= previous - 1e-12);
    previous = f(x);
  }
});
test("shade groups split light and shadow by weight", () => {
  const groups = shadeGroups(
    [
      { h: 50, s: 0.5, l: 0.8, weight: 80 },
      { h: 51, s: 0.5, l: 0.79, weight: 10 },
      { h: 40, s: 0.6, l: 0.5, weight: 20 },
    ],
    2,
  );
  assert.equal(groups.length, 2);
  assert.ok(Math.abs(groups[0].l - 0.5) < 1e-9);
  assert.equal(groups[1].weight, 90);
  assert.equal(shadeGroups([{ h: 0, s: 0, l: 0.5, weight: 1 }], 3).length, 1);
});
// A 10 × 10 image: 80 pixels of main yellow, 20 of shadow.
async function twoShades() {
  const data = new Uint8ClampedArray(400);
  for (let i = 0; i < 100; i++)
    data.set(i < 80 ? [255, 200, 61, 255] : [224, 161, 0, 255], i * 4);
  return prepare(10, 10, data);
}
const shiftWith = async (image, extra) =>
  processImage(
    image,
    { ...defaults(), hueTol: 60, shadeTol: 100, ...extra },
    [{ x: 0, y: 0 }],
    new Int8Array(100),
  );
test("a skin-tone ramp lands each shade exactly on its tone colour", async () => {
  const image = await twoShades();
  for (const set of SETS.filter((s) => s.id.startsWith("skin-")))
    for (const { ramp } of set.entries) {
      const r = await shiftWith(image, { ramp, target: ramp[0] }),
        main = toHex(...r.pixels.subarray(0, 3)),
        shadow = toHex(...r.pixels.subarray(360, 363)),
        byLight = [...ramp].sort(
          (a, b) =>
            toModel(
              [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)),
              "oklch",
            )[2] -
            toModel(
              [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)),
              "oklch",
            )[2],
        );
      assert.equal(main, byLight.at(-1), set.id + " main");
      assert.equal(shadow, byLight[0], set.id + " shadow");
    }
});
test("a one-colour ramp is exactly the single-target shift", async () => {
  const image = await twoShades(),
    target = "#C68D7B",
    deltas = deltasFor([255, 200, 61], [198, 141, 123], "oklch");
  const plain = await shiftWith(image, { target, ...deltas }),
    ramp = await shiftWith(image, { target, ramp: [target] });
  assert.deepEqual([...ramp.pixels], [...plain.pixels]);
  assert.equal(toHex(...plain.pixels.subarray(0, 3)), target);
});
test("ramp hues unwrap across 0°, so mid shades stay red instead of turning cyan", () => {
  // Cyan shades onto a pink-red ramp: the offsets are about +165° and -175°,
  // which must blend through 180°, not back through 0°.
  const p = { ...defaults(), ramp: ["#FF0060", "#FF3000"] },
    samples = [
      { h: 200, s: 0.3, l: 0.45, weight: 1, neutral: false },
      { h: 210, s: 0.3, l: 0.7, weight: 1, neutral: false },
    ],
    shift = rampShift(p, samples);
  for (let l = 0.45; l <= 0.7; l += 0.05) {
    const out = shift(fromModel(205, 0.3, l, "oklch")),
      h = toModel(out, "oklch")[0];
    assert.ok(
      hueDistance(h, 20) < 45,
      "hue " + h.toFixed(1) + " at L " + l.toFixed(2),
    );
  }
});
test("edits reject malformed ramps", () => {
  const ok = { ...defaults() };
  for (const ramp of [[], ["#12"], Array(9).fill("#FFFFFF"), "#FFFFFF", [1]])
    assert.throws(
      () => validateEdit({ ...ok, ramp }, [], new Int8Array(1), 1, 1),
      /ramp/,
    );
  validateEdit(
    { ...ok, ramp: ["#FFFFFF", "#000"] },
    [],
    new Int8Array(1),
    1,
    1,
  );
});
