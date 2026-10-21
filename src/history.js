// Small metadata snapshots and contiguous changed runs, never a bitmap per control edit.
function diff(a, b) {
  const runs = [];
  let bytes = 0;
  // Merge short equal gaps (notably alpha between RGB edits). Otherwise a
  // recolour could allocate millions of tiny JavaScript patch objects.
  for (let i = 0; i < a.length;) {
    if (a[i] === b[i]) {
      i++;
      continue;
    }
    const start = i;
    let end = ++i;
    while (i < a.length && i - end < 32) {
      if (a[i] !== b[i]) end = i + 1;
      i++;
    }
    const before = a.slice(start, end),
      after = b.slice(start, end);
    runs.push({ start, before, after });
    bytes += before.byteLength + after.byteLength + 128;
  }
  return { runs, bytes };
}
export class History {
  constructor(maxEntries = 30, maxBytes = 96 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.clear();
  }
  clear() {
    this.undoEntries = [];
    this.redoEntries = [];
    this.bytes = 0;
  }
  record(before, after, label) {
    const pixels =
        before.pixels === after.pixels
          ? { runs: [], bytes: 0 }
          : diff(before.pixels, after.pixels),
      mask = diff(before.overrides, after.overrides);
    const oldMeta = JSON.stringify(before.meta),
      newMeta = JSON.stringify(after.meta);
    if (!pixels.runs.length && !mask.runs.length && oldMeta === newMeta) return;
    const entry = {
      pixels,
      mask,
      before: before.meta,
      after: after.meta,
      label,
      bytes:
        pixels.bytes + mask.bytes + oldMeta.length * 2 + newMeta.length * 2,
    };
    for (const e of this.redoEntries) this.bytes -= e.bytes;
    this.redoEntries = [];
    this.undoEntries.push(entry);
    this.bytes += entry.bytes;
    while (
      this.undoEntries.length > this.maxEntries ||
      this.bytes > this.maxBytes
    ) {
      const e = this.undoEntries.shift();
      this.bytes -= e.bytes;
    }
  }
  move(state, redo = false) {
    const from = redo ? this.redoEntries : this.undoEntries,
      to = redo ? this.undoEntries : this.redoEntries,
      e = from.pop();
    if (!e) return null;
    for (const [key, patch] of [
      ["pixels", e.pixels],
      ["overrides", e.mask],
    ])
      for (const r of patch.runs)
        state[key].set(redo ? r.after : r.before, r.start);
    to.push(e);
    return {
      meta: structuredClone(redo ? e.after : e.before),
      pixelsChanged: !!e.pixels.runs.length,
      label: e.label,
    };
  }
}
