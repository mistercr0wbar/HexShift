// WebP container mux and demux. Still frames are decoded by the pinned libwebp build.
function text(bytes, i, n) {
  let s = "";
  for (let k = 0; k < n; k++) s += String.fromCharCode(bytes[i + k]);
  return s;
}

function need(bytes, offset, n) {
  if (offset < 0 || offset + n > bytes.length) throw Error("Truncated animation.");
}

function u24(bytes, i) {
  return bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
}

function chunksOf(bytes) {
  if (bytes.length < 12 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WEBP")
    throw Error("Choose a GIF or WebP for the animation prototype.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileSize = view.getUint32(4, true);
  if (fileSize + 8 > bytes.length + 1) throw Error("Truncated animation.");
  const end = Math.min(bytes.length, fileSize + 8);
  const chunks = [];
  let i = 12;
  while (i + 8 <= end) {
    const kind = text(bytes, i, 4);
    const len = view.getUint32(i + 4, true);
    const o = i + 8;
    need(bytes, o, len);
    chunks.push({ kind, offset: o, length: len });
    i = o + len + (len & 1);
  }
  return chunks;
}

export function parseWebp(bytes) {
  const chunks = chunksOf(bytes);
  const vp8x = chunks.find((chunk) => chunk.kind === "VP8X");
  let width = 0;
  let height = 0;
  let containerAnimated = false;
  let found = false;
  if (vp8x) {
    if (vp8x.length !== 10) throw Error("Truncated animation.");
    const flags = bytes[vp8x.offset];
    containerAnimated = !!(flags & 2);
    width = 1 + u24(bytes, vp8x.offset + 4);
    height = 1 + u24(bytes, vp8x.offset + 7);
    found = true;
  }
  const anim = chunks.find((chunk) => chunk.kind === "ANIM");
  let background = [0, 0, 0, 0];
  let loop = 1;
  if (anim && containerAnimated) {
    if (anim.length < 6) throw Error("Truncated animation.");
    const o = anim.offset;
    background = [bytes[o + 2], bytes[o + 1], bytes[o], bytes[o + 3]];
    loop = bytes[o + 4] | (bytes[o + 5] << 8);
  }
  const frames = [];
  if (containerAnimated) {
    for (const chunk of chunks) {
      if (chunk.kind !== "ANMF") continue;
      if (chunk.length < 16) throw Error("Truncated animation.");
      const o = chunk.offset;
      const flags = bytes[o + 15];
      frames.push({
        x: u24(bytes, o) * 2,
        y: u24(bytes, o + 3) * 2,
        width: u24(bytes, o + 6) + 1,
        height: u24(bytes, o + 9) + 1,
        durationMs: u24(bytes, o + 12),
        blend: (flags >> 1) & 1,
        disposal: flags & 1,
        payload: bytes.subarray(o + 16, o + chunk.length),
      });
    }
  } else {
    const image = chunks.find((chunk) => chunk.kind === "VP8 " || chunk.kind === "VP8L");
    if (!image) throw Error("Choose a GIF or WebP for the animation prototype.");
    if (!found) {
      width = stillSize(bytes, image).width;
      height = stillSize(bytes, image).height;
    }
    frames.push({
      x: 0,
      y: 0,
      width,
      height,
      durationMs: 0,
      blend: 1,
      disposal: 0,
      payload: bytes.subarray(image.offset - 8, image.offset + image.length),
    });
  }
  if (!frames.length) throw Error("This WebP has no frames.");
  return { format: "webp", width, height, frames, background, loop, containerAnimated };
}

function stillSize(bytes, image) {
  const o = image.offset;
  if (image.kind === "VP8 ") {
    need(bytes, o, 10);
    if (text(bytes, o + 3, 3) !== "\x9d\x01\x2a") throw Error("Truncated animation.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint16(o + 6, true) & 16383,
      height: view.getUint16(o + 8, true) & 16383,
    };
  }
  need(bytes, o, 5);
  if (bytes[o] !== 47) throw Error("Truncated animation.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b = view.getUint32(o + 1, true);
  return { width: (b & 16383) + 1, height: ((b >>> 14) & 16383) + 1 };
}

export function wrapStill(payload) {
  const size = 4 + payload.length;
  const out = new Uint8Array(8 + size);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, size, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(payload, 12);
  return out;
}

function writeU24(out, offset, value) {
  out[offset] = value & 255;
  out[offset + 1] = (value >> 8) & 255;
  out[offset + 2] = (value >> 16) & 255;
}

function chunk(fourcc, payload) {
  const pad = payload.length & 1;
  const out = new Uint8Array(8 + payload.length + pad);
  out[0] = fourcc.charCodeAt(0);
  out[1] = fourcc.charCodeAt(1);
  out[2] = fourcc.charCodeAt(2);
  out[3] = fourcc.charCodeAt(3);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

// frames: full-canvas still-webp chunk lists (no RIFF header), plus duration and dispose/blend.
export function muxWebp({ width, height, loop = 0, background = [0, 0, 0, 0], frames }) {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | 0x10;
  vp8x[4] = (width - 1) & 255;
  vp8x[5] = ((width - 1) >> 8) & 255;
  vp8x[6] = ((width - 1) >> 16) & 255;
  vp8x[7] = (height - 1) & 255;
  vp8x[8] = ((height - 1) >> 8) & 255;
  vp8x[9] = ((height - 1) >> 16) & 255;
  const anim = new Uint8Array(6);
  anim[0] = background[2];
  anim[1] = background[1];
  anim[2] = background[0];
  anim[3] = background[3];
  anim[4] = loop & 255;
  anim[5] = (loop >> 8) & 255;
  const parts = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  for (const frame of frames) {
    const header = new Uint8Array(16);
    writeU24(header, 0, frame.x >> 1);
    writeU24(header, 3, frame.y >> 1);
    writeU24(header, 6, frame.width - 1);
    writeU24(header, 9, frame.height - 1);
    writeU24(header, 12, frame.durationMs || 0);
    header[15] = ((frame.blend ?? 1) << 1) | (frame.disposal ?? 0);
    const payload = new Uint8Array(header.length + frame.chunks.length);
    payload.set(header, 0);
    payload.set(frame.chunks, header.length);
    parts.push(chunk("ANMF", payload));
  }
  let total = 4;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(8 + total);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, total, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  let o = 12;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

export function stripRiff(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 12 || text(view, 0, 4) !== "RIFF" || text(view, 8, 4) !== "WEBP")
    throw Error("This browser cannot decode that WebP frame.");
  return view.subarray(12, view.byteLength);
}
