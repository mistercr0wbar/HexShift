import { crc32 } from "./export.js";
// A store-only ZIP: PNG and WebP are already compressed, so deflating them
// again saves nothing. Names are UTF-8 (flag bit 11) and made unique.
export async function zip(files, date = new Date()) {
  if (!files.length || files.length > 1000)
    throw Error("Invalid ZIP contents.");
  const encoder = new TextEncoder(),
    used = new Set(),
    parts = [],
    central = [],
    time =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
    day =
      ((Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
  let offset = 0;
  for (const { name, blob } of files) {
    const data = new Uint8Array(await blob.arrayBuffer()),
      path = encoder.encode(unique(name, used)),
      crc = crc32(data),
      local = new Uint8Array(30 + path.length),
      entry = new Uint8Array(46 + path.length),
      l = new DataView(local.buffer),
      c = new DataView(entry.buffer);
    if (offset + local.length + data.length > 0xffffffff)
      throw Error("The ZIP would be larger than 4 GB.");
    l.setUint32(0, 0x04034b50, true);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // made by: ZIP 2.0
    // The fields from "version needed" to the name length are the same in both.
    for (const [v, at] of [
      [l, 4],
      [c, 6],
    ]) {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 4, 0, true); // stored
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, day, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, path.length, true);
    }
    c.setUint32(42, offset, true);
    local.set(path, 30);
    entry.set(path, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, e) => n + e.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
// Plain file names only (no folders), with " (2)" added to repeats.
function unique(name, used) {
  const clean =
      String(name)
        .replace(/[\x00-\x1f\x7f/\\:]/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 120) || "image",
    dot = clean.lastIndexOf("."),
    stem = dot > 0 ? clean.slice(0, dot) : clean,
    ext = dot > 0 ? clean.slice(dot) : "";
  let candidate = clean;
  for (let n = 2; used.has(candidate.toLowerCase()); n++)
    candidate = stem + " (" + n + ")" + ext;
  used.add(candidate.toLowerCase());
  return candidate;
}
