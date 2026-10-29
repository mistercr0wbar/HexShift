// GIF87a/GIF89a decode and exact-palette encode. Patches stay indexed until composite.
const SIG = ["GIF87a", "GIF89a"];

function text(bytes, i, n) {
  let s = "";
  for (let k = 0; k < n; k++) s += String.fromCharCode(bytes[i + k]);
  return s;
}

function need(bytes, offset, n) {
  if (offset < 0 || offset + n > bytes.length) throw Error("Truncated animation.");
}

function u16(bytes, i) {
  return bytes[i] | (bytes[i + 1] << 8);
}

function skipSubBlocks(bytes, i) {
  while (i < bytes.length) {
    const n = bytes[i++];
    if (n === 0) return i;
    need(bytes, i, n);
    i += n;
  }
  throw Error("Truncated animation.");
}

function readSubBlocks(bytes, i) {
  const parts = [];
  let total = 0;
  while (i < bytes.length) {
    const n = bytes[i++];
    if (n === 0) return { bytes: join(parts, total), offset: i };
    need(bytes, i, n);
    parts.push(bytes.subarray(i, i + n));
    total += n;
    i += n;
  }
  throw Error("Truncated animation.");
}

function join(parts, total) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paletteSize(packed) {
  return 1 << ((packed & 7) + 1);
}

function readPalette(bytes, offset, packed) {
  const n = paletteSize(packed);
  need(bytes, offset, n * 3);
  const colors = new Uint8Array(n * 3);
  colors.set(bytes.subarray(offset, offset + n * 3));
  return { colors, offset: offset + n * 3 };
}

// Walk the file once. Decompress is separate so inspect can refuse before LZW.
export function parseGif(bytes) {
  if (bytes.length < 13 || !SIG.includes(text(bytes, 0, 6)))
    throw Error("Choose a GIF or WebP for the animation prototype.");
  const width = u16(bytes, 6);
  const height = u16(bytes, 8);
  if (width < 1 || height < 1) throw Error("Truncated animation.");
  const packed = bytes[10];
  const background = bytes[11];
  let i = 13;
  let global = null;
  if (packed & 0x80) {
    const got = readPalette(bytes, i, packed);
    global = got.colors;
    i = got.offset;
  }
  const frames = [];
  let gce = null;
  let loop = 0;
  let sawLoop = false;
  while (i < bytes.length) {
    const marker = bytes[i++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      need(bytes, i, 1);
      const label = bytes[i++];
      if (label === 0xf9) {
        need(bytes, i, 6);
        if (bytes[i] !== 4) throw Error("Truncated animation.");
        const flags = bytes[i + 1];
        gce = {
          disposal: (flags >> 2) & 7,
          transparent: flags & 1 ? bytes[i + 4] : -1,
          delayCs: u16(bytes, i + 2),
        };
        i += 6;
      } else if (label === 0xff) {
        need(bytes, i, 1);
        const n = bytes[i];
        need(bytes, i, 1 + n);
        const app = text(bytes, i + 1, n);
        const rest = readSubBlocks(bytes, i + 1 + n);
        if (app === "NETSCAPE2.0" && rest.bytes.length >= 3 && rest.bytes[0] === 1) {
          loop = rest.bytes[1] | (rest.bytes[2] << 8);
          sawLoop = true;
        }
        i = rest.offset;
        gce = null;
      } else {
        i = skipSubBlocks(bytes, i);
        gce = null;
      }
      continue;
    }
    if (marker !== 0x2c) throw Error("Truncated animation.");
    need(bytes, i, 9);
    const left = u16(bytes, i);
    const top = u16(bytes, i + 2);
    const fw = u16(bytes, i + 4);
    const fh = u16(bytes, i + 6);
    const ip = bytes[i + 8];
    i += 9;
    let local = null;
    if (ip & 0x80) {
      const got = readPalette(bytes, i, ip);
      local = got.colors;
      i = got.offset;
    }
    need(bytes, i, 1);
    const minCodeSize = bytes[i++];
    if (minCodeSize < 2 || minCodeSize > 11) throw Error("Truncated animation.");
    const data = readSubBlocks(bytes, i);
    frames.push({
      left,
      top,
      width: fw,
      height: fh,
      interlaced: !!(ip & 0x40),
      minCodeSize,
      lzw: data.bytes,
      palette: local || global,
      disposal: gce ? gce.disposal : 0,
      transparent: gce ? gce.transparent : -1,
      delayCs: gce ? gce.delayCs : 0,
    });
    gce = null;
    i = data.offset;
    if (frames.length > 1000) break;
  }
  if (!frames.length) throw Error("This GIF has no frames.");
  if (!global && frames.some((frame) => !frame.palette))
    throw Error("Truncated animation.");
  return {
    format: "gif",
    width,
    height,
    frames,
    background,
    global,
    loop: sawLoop ? loop : null,
    sawLoop,
  };
}

export function lzwDecode(minCodeSize, data, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let mask = (1 << codeSize) - 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const reset = () => {
    codeSize = minCodeSize + 1;
    next = eoi + 1;
    mask = (1 << codeSize) - 1;
  };
  const out = new Uint8Array(pixelCount);
  let outN = 0;
  let acc = 0;
  let nbits = 0;
  let bi = 0;
  const read = () => {
    while (nbits < codeSize) {
      if (bi >= data.length) throw Error("Truncated animation.");
      acc |= data[bi++] << nbits;
      nbits += 8;
    }
    const code = acc & mask;
    acc >>>= codeSize;
    nbits -= codeSize;
    return code;
  };
  let prev = -1;
  let first = 0;
  while (outN < pixelCount) {
    const code = read();
    if (code === clear) {
      reset();
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (code > next) throw Error("Truncated animation.");
    let walk = code;
    let top = 0;
    if (code === next) {
      if (prev < 0) throw Error("Truncated animation.");
      stack[top++] = first;
      walk = prev;
    }
    while (walk >= clear) {
      stack[top++] = suffix[walk];
      walk = prefix[walk];
    }
    first = walk;
    stack[top++] = first;
    while (top > 0) {
      if (outN >= pixelCount) break;
      out[outN++] = stack[--top];
    }
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        codeSize++;
        mask = (1 << codeSize) - 1;
      }
    }
    prev = code;
  }
  if (outN < pixelCount) throw Error("Truncated animation.");
  return out;
}

function deinterlace(indices, width, height) {
  const out = new Uint8Array(indices.length);
  const starts = [0, 4, 2, 1];
  const steps = [8, 8, 4, 2];
  let src = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let y = starts[pass]; y < height; y += steps[pass]) {
      out.set(indices.subarray(src, src + width), y * width);
      src += width;
    }
  }
  return out;
}

export function gifIndices(frame) {
  const count = frame.width * frame.height;
  if (
    count < 1 ||
    frame.left < 0 ||
    frame.top < 0 ||
    frame.left + frame.width > 0x10000 ||
    frame.top + frame.height > 0x10000
  )
    throw Error("Truncated animation.");
  const raw = lzwDecode(frame.minCodeSize, frame.lzw, count);
  return frame.interlaced ? deinterlace(raw, frame.width, frame.height) : raw;
}

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let maxCode = (1 << codeSize) - 1;
  let dict = new Map();
  const reset = () => {
    dict = new Map();
    codeSize = minCodeSize + 1;
    next = eoi + 1;
    maxCode = (1 << codeSize) - 1;
  };
  let acc = 0;
  let nbits = 0;
  let delayBump = false;
  const bytes = [];
  // The decoder widens the code after the entry that crosses the boundary is consumed.
  // One more code is therefore still written at the old width.
  const write = (code) => {
    acc |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      nbits -= 8;
    }
    if (delayBump) {
      codeSize++;
      maxCode = (1 << codeSize) - 1;
      delayBump = false;
    }
  };
  reset();
  write(clear);
  let ent = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const key = ent + "," + indices[i];
    const found = dict.get(key);
    if (found !== undefined) {
      ent = found;
      continue;
    }
    write(ent);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > maxCode && codeSize < 12) delayBump = true;
    } else {
      write(clear);
      reset();
      delayBump = false;
    }
    ent = indices[i];
  }
  write(ent);
  write(eoi);
  while (nbits > 0) {
    bytes.push(acc & 255);
    acc >>>= 8;
    nbits -= 8;
  }
  return Uint8Array.from(bytes);
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    const block = new Uint8Array(1 + n);
    block[0] = n;
    block.set(data.subarray(i, i + n), 1);
    parts.push(block);
  }
  parts.push(new Uint8Array([0]));
  return join(parts, parts.reduce((n, p) => n + p.length, 0));
}

function putU16(out, value) {
  out.push(value & 255, (value >> 8) & 255);
}

// frames: { indices, left, top, width, height, delayCs, disposal, transparent, interlaced }
// palette: Uint8Array RGB triples. transparent index may point at a dummy colour.
export function encodeGif({ width, height, palette, background = 0, loop = 0, frames }) {
  const colors = palette.length / 3;
  if (!Number.isInteger(colors) || colors < 1 || colors > 256)
    throw Error("GIF palette is larger than 256 colours.");
  let sizeBits = 0;
  while (1 << (sizeBits + 1) < colors) sizeBits++;
  const table = 1 << (sizeBits + 1);
  const packed = new Uint8Array(table * 3);
  packed.set(palette);
  const out = [];
  const push = (...bytes) => out.push(...bytes);
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  putU16(out, width);
  putU16(out, height);
  push(0x80 | (sizeBits << 4) | sizeBits, background & 255, 0);
  for (let i = 0; i < packed.length; i++) push(packed[i]);
  push(
    0x21,
    0xff,
    0x0b,
    0x4e,
    0x45,
    0x54,
    0x53,
    0x43,
    0x41,
    0x50,
    0x45,
    0x32,
    0x2e,
    0x30,
    0x03,
    0x01,
    loop & 255,
    (loop >> 8) & 255,
    0x00,
  );
  const minCodeSize = Math.max(2, sizeBits + 1);
  for (const frame of frames) {
    const disposal = (frame.disposal || 0) & 7;
    const transparent = frame.transparent ?? -1;
    const flags = (disposal << 2) | (transparent >= 0 ? 1 : 0);
    push(0x21, 0xf9, 0x04, flags);
    putU16(out, frame.delayCs || 0);
    push(transparent >= 0 ? transparent : 0, 0x00);
    push(0x2c);
    putU16(out, frame.left || 0);
    putU16(out, frame.top || 0);
    putU16(out, frame.width);
    putU16(out, frame.height);
    push(frame.interlaced ? 0x40 : 0x00);
    const indices = frame.interlaced
      ? interlace(frame.indices, frame.width, frame.height)
      : frame.indices;
    const lzw = lzwEncode(indices, minCodeSize);
    push(minCodeSize);
    const blocks = subBlocks(lzw);
    for (let i = 0; i < blocks.length; i++) push(blocks[i]);
  }
  push(0x3b);
  return Uint8Array.from(out);
}

function interlace(indices, width, height) {
  const out = new Uint8Array(indices.length);
  const starts = [0, 4, 2, 1];
  const steps = [8, 8, 4, 2];
  let dst = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let y = starts[pass]; y < height; y += steps[pass]) {
      out.set(indices.subarray(y * width, (y + 1) * width), dst);
      dst += width;
    }
  }
  return out;
}

export function rgbaToPalette(frames) {
  const index = new Map();
  const colors = [];
  let transparent = -1;
  const planes = [];
  for (const frame of frames) {
    const indices = new Uint8Array(frame.data.length / 4);
    for (let p = 0, i = 0; p < frame.data.length; p += 4, i++) {
      const a = frame.data[p + 3];
      let key;
      if (a === 0) key = "t";
      else if (a !== 255) throw Error("GIF cannot store partial transparency.");
      else key = frame.data[p] + "," + frame.data[p + 1] + "," + frame.data[p + 2];
      let at = index.get(key);
      if (at === undefined) {
        if (index.size === 256) throw Error("GIF palette is larger than 256 colours.");
        at = index.size;
        index.set(key, at);
        if (key === "t") {
          transparent = at;
          colors.push(0, 0, 0);
        } else colors.push(frame.data[p], frame.data[p + 1], frame.data[p + 2]);
      }
      indices[i] = at;
    }
    planes.push(indices);
  }
  return { palette: Uint8Array.from(colors), transparent, planes };
}
