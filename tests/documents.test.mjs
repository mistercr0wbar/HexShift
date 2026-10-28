import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/history.js";
import {
  trimHistories,
  selectDocuments,
  MAX_DOCUMENTS,
  HISTORY_BYTES,
} from "../src/documents.js";

function doc() {
  const history = new History();
  const pixels = new Uint8ClampedArray(4),
    overrides = new Int8Array(1);
  for (let i = 0; i < 6; i++)
    history.record(
      { pixels, overrides, meta: { n: i } },
      { pixels, overrides, meta: { n: i + 1 } },
      "Change " + i,
    );
  return { history, pixels, overrides };
}
test("one workspace history budget trims background undo first and preserves redo chains", () => {
  const a = doc(),
    b = doc(),
    active = doc(),
    one = a.history.bytes;
  a.history.move(a);
  a.history.move(a);
  const budget = one + one / 2;
  assert.equal(trimHistories([a, b, active], active, budget), budget);
  assert.equal(a.history.bytes, 0);
  assert.equal(b.history.undoEntries.length, 3);
  assert.equal(active.history.undoEntries.length, 6);
  for (let n = 6; n > 0; n--)
    assert.equal(active.history.move(active).meta.n, n - 1);
  for (let n = 1; n <= 6; n++)
    assert.equal(active.history.move(active, true).meta.n, n);
  // When the budget reaches redo, discard the furthest future first.
  trimHistories([active], active, one / 2);
  assert.equal(active.history.undoEntries.length, 3);
  assert.equal(MAX_DOCUMENTS, 20);
  assert.equal(HISTORY_BYTES, 96 * 1024 * 1024);
});
test("Ctrl toggles selection, Shift selects a range in the current tab order", () => {
  const a = {},
    b = {},
    c = {},
    d = {},
    docs = [a, b, c, d];
  assert.deepEqual(
    [...selectDocuments(docs, new Set([a]), a, c, false)],
    [a, c],
  );
  assert.deepEqual(
    [...selectDocuments(docs, new Set([a, c]), a, a, false)],
    [c],
  );
  assert.deepEqual(
    [...selectDocuments(docs, new Set([a]), d, b, true)],
    [b, c, d],
  );
  assert.deepEqual(
    [...selectDocuments([d, a, c, b], new Set(), a, b, true)],
    [a, c, b],
  );
});
