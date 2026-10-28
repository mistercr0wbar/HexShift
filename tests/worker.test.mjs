import test from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../src/colour.js";

test("worker keeps three prepared images, invalidates revisions, releases closed tabs and rejects stale work", async () => {
  const messages = [];
  globalThis.self = { postMessage: (m) => messages.push(m) };
  await import("../src/worker.js");
  let sequence = 0;
  const image = async (key, red) => {
    const imageId = ++sequence;
    await self.onmessage({
      data: {
        type: "image",
        imageId,
        editId: 1,
        cacheKey: key,
        width: 1,
        height: 1,
        pixels: new Uint8ClampedArray([red, 20, 20, 255]),
      },
    });
    await self.onmessage({
      data: {
        type: "edit",
        imageId,
        editId: 2,
        rows: [{ id: 1, params: defaults(), seeds: [] }],
        active: 0,
        overrides: new Int8Array(1),
      },
    });
    const result = messages.at(-1);
    assert.equal(result.type, "result");
    return result.pixels[0];
  };
  assert.equal(await image("1:1", 100), 100);
  assert.equal(await image("2:1", 110), 110);
  assert.equal(await image("3:1", 120), 120);
  // A key identifies immutable pixels. A different payload with the same key
  // proves reuse (ordinary callers always send the key's original pixels).
  assert.equal(await image("1:1", 200), 100);
  assert.equal(await image("4:1", 130), 130);
  assert.equal(await image("2:1", 210), 210); // least-recently-used entry evicted
  assert.equal(await image("1:2", 220), 220); // edited revision is a fresh image
  await self.onmessage({ data: { type: "release", documentId: 1 } });
  await self.onmessage({
    data: {
      type: "edit",
      imageId: sequence,
      editId: 3,
      rows: [{ id: 1, params: defaults(), seeds: [] }],
      active: 0,
      overrides: new Int8Array(1),
    },
  });
  assert.equal(
    messages.at(-1).type,
    "error",
    "a closed image is no longer retained as the active worker image",
  );
  assert.equal(await image("1:2", 230), 230);
  messages.length = 0;
  const a = self.onmessage({
    data: {
      type: "image",
      imageId: 999,
      editId: 1,
      cacheKey: "9:1",
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([1, 2, 3, 255]),
    },
  });
  await self.onmessage({ data: { type: "cancel", imageId: 1000, editId: 2 } });
  await a;
  assert.deepEqual(messages, []);
  delete globalThis.self;
});
