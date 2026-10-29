import test from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../src/colour.js";
import { parseRecipeFile, writeRecipe } from "../src/recipe.js";
import { parseSession, writeSession } from "../src/session.js";

function image(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return data;
}
function view(tool = "pick") {
  return {
    zoom: 1,
    fitMode: true,
    panX: 0,
    panY: 0,
    mode: "side",
    overlay: "normal",
    compare: "working",
    wipe: 40,
    tool,
    addSample: false,
    brush: 12,
  };
}
function exp() {
  return { size: "original", format: "png", custom: 512, ground: "#313338" };
}
function doc(name, fill, extra = {}) {
  const width = 2,
    height = 2,
    original = image(width, height, fill),
    pixels = original.slice(),
    overrides = new Int8Array(width * height);
  pixels[0] = fill[0] === 0 ? 9 : 0;
  return {
    name,
    width,
    height,
    still: false,
    original,
    pixels,
    overrides,
    edit: {
      rows: [
        {
          id: 1,
          params: defaults(),
          seeds: [{ x: 0, y: 0 }],
        },
      ],
      active: 0,
      steps: [],
      outline: { on: false, widthPct: 4, colour: "#FFFFFF" },
    },
    svg: null,
    view: view(),
    export: exp(),
    variant: null,
    ...extra,
  };
}

test("a session round-trips two tabs, brushes, an outline, variants and the open tab", () => {
  const first = doc("red.png", [200, 0, 0, 255]);
  first.overrides[1] = 1;
  first.overrides[2] = -1;
  first.edit.outline = { on: true, widthPct: 10, colour: "#00FF00" };
  first.edit.rows[0].params.connected = true;
  const second = doc("blue.png", [0, 0, 180, 255], {
    view: view("add"),
    variant: {
      id: "discord",
      label: "Discord",
      entries: [
        { label: "Primary", hex: "#5865F2", ramp: null },
        { label: "Tone", hex: "#E0B090", ramp: ["#F2D2B6", "#C89678"] },
      ],
    },
  });
  const text = writeSession({ active: 1, documents: [first, second] });
  const opened = parseSession(text);
  assert.equal(opened.active, 1);
  assert.equal(opened.documents.length, 2);
  assert.equal(opened.documents[0].name, "red.png");
  assert.deepEqual([...opened.documents[0].overrides], [0, 1, -1, 0]);
  assert.equal(opened.documents[0].pixels[0], first.pixels[0]);
  assert.deepEqual([...opened.documents[0].original], [...first.original]);
  assert.deepEqual(opened.documents[0].edit.outline, first.edit.outline);
  assert.equal(opened.documents[0].edit.rows[0].params.connected, true);
  assert.equal(opened.documents[1].view.tool, "add");
  assert.equal(opened.documents[1].variant.label, "Discord");
  assert.deepEqual(opened.documents[1].variant.entries[1].ramp, [
    "#F2D2B6",
    "#C89678",
  ]);
  assert.equal(opened.documents[1].edit.steps.length, 0);
});

test("a session without framing fields means framing is off, and a later save can record it", () => {
  const text = writeSession({
      active: 0,
      documents: [doc("one.png", [1, 2, 3, 255])],
    }),
    data = JSON.parse(text);
  delete data.documents[0].export.trim;
  delete data.documents[0].export.padding;
  delete data.documents[0].export.scale;
  const opened = parseSession(JSON.stringify(data));
  assert.deepEqual(
    {
      trim: opened.documents[0].export.trim,
      padding: opened.documents[0].export.padding,
      scale: opened.documents[0].export.scale,
    },
    { trim: false, padding: 0, scale: "smooth" },
  );
  const framed = doc("one.png", [1, 2, 3, 255]);
  framed.export.trim = true;
  framed.export.padding = 12;
  framed.export.scale = "nearest";
  const again = parseSession(
    writeSession({ active: 0, documents: [framed] }),
  );
  assert.equal(again.documents[0].export.trim, true);
  assert.equal(again.documents[0].export.padding, 12);
  assert.equal(again.documents[0].export.scale, "nearest");
  data.documents[0].export.scale = "pixel";
  assert.throws(() => parseSession(JSON.stringify(data)), /export choices/);
  data.documents[0].export.scale = "smooth";
  data.documents[0].export.padding = 900;
  assert.throws(() => parseSession(JSON.stringify(data)), /export choices/);
  data.documents[0].export.padding = 0;
  data.documents[0].export.trim = "yes";
  assert.throws(() => parseSession(JSON.stringify(data)), /export choices/);
});
test("a session without a polygon still opens, and a later save can record one", () => {
  const text = writeSession({
      active: 0,
      documents: [doc("one.png", [1, 2, 3, 255])],
    }),
    opened = parseSession(text);
  assert.equal(opened.documents[0].edit.rows[0].polygon, undefined);
  assert.equal(
    JSON.parse(text).documents[0].edit.rows[0].polygon,
    undefined,
  );
  const shaped = doc("one.png", [1, 2, 3, 255]);
  shaped.edit.rows[0].polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  shaped.view = view("polygon");
  const again = parseSession(writeSession({ active: 0, documents: [shaped] }));
  assert.deepEqual(
    again.documents[0].edit.rows[0].polygon,
    shaped.edit.rows[0].polygon,
  );
  assert.equal(again.documents[0].view.tool, "polygon");
  const data = JSON.parse(text);
  data.documents[0].edit.rows[0].polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  assert.throws(() => parseSession(JSON.stringify(data)), /polygon/);
  data.documents[0].edit.rows[0].polygon = [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 0, y: 1 },
  ];
  assert.throws(() => parseSession(JSON.stringify(data)), /polygon/);
  data.documents[0].edit.rows[0].polygon = [
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  assert.throws(() => parseSession(JSON.stringify(data)), /polygon/);
});
test("a recipe is not a session, and a session is not a recipe", () => {
  const session = writeSession({
    active: 0,
    documents: [doc("one.png", [1, 2, 3, 255])],
  });
  assert.throws(() => parseRecipeFile(session), /recipe|newer|text|colour/);
  const recipe = writeRecipe(
    [
      {
        rows: [
          {
            params: defaults(),
            seeds: [{ hex: "#FF0000" }],
          },
        ],
      },
    ],
    null,
  );
  assert.throws(() => parseSession(recipe), /recipe, not a session/);
});

test("a bad session is refused", () => {
  assert.throws(() => parseSession("{"), /not a Hex Shift session/);
  const text = writeSession({
    active: 0,
    documents: [doc("one.png", [1, 2, 3, 255])],
  });
  const data = JSON.parse(text);
  data.version = 2;
  assert.throws(() => parseSession(JSON.stringify(data)), /newer version/);
  data.version = 1;
  data.documents[0].original = "!!!!";
  assert.throws(() => parseSession(JSON.stringify(data)), /unreadable/);
  data.documents[0].original = JSON.parse(text).documents[0].original;
  data.active = 4;
  assert.throws(() => parseSession(JSON.stringify(data)), /open tab/);
  const fitted = JSON.parse(text);
  fitted.documents[0].view.zoom = 25.5;
  assert.equal(parseSession(JSON.stringify(fitted)).documents[0].view.zoom, 25.5);
  fitted.documents[0].view.zoom = 9000;
  assert.throws(() => parseSession(JSON.stringify(fitted)), /view/);
});
