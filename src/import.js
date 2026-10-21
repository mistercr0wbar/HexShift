import DOMPurify from "dompurify";
import { MAX_PIXELS } from "./engine.js";
export function dimensions(w, h) {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 8192 ||
    h > 8192 ||
    w * h > MAX_PIXELS
  )
    throw Error(
      "Image too large. Use at most 4,194,304 pixels and 8,192 pixels on either side.",
    );
  return { width: w, height: h };
}
export function inspectRaster(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    text = (i, n) => String.fromCharCode(...bytes.subarray(i, i + n));
  const need = (offset, n) => {
    if (offset + n > bytes.length) throw Error("Truncated image header.");
  };
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") {
    need(0, 33);
    if (v.getUint32(8) !== 13 || text(12, 4) !== "IHDR")
      throw Error("Invalid PNG header.");
    return {
      ...dimensions(v.getUint32(16), v.getUint32(20)),
      type: "image/png",
    };
  }
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) {
    need(0, 13);
    return {
      ...dimensions(v.getUint16(6, true), v.getUint16(8, true)),
      type: "image/gif",
      still: true,
    };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i < bytes.length) {
      need(i, 2);
      if (bytes[i++] !== 255) throw Error("Invalid JPEG marker.");
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      need(i, 2);
      const len = v.getUint16(i);
      if (len < 2) throw Error("Invalid JPEG segment.");
      need(i, len);
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (len < 8) throw Error("Invalid JPEG dimensions.");
        return {
          ...dimensions(v.getUint16(i + 5), v.getUint16(i + 3)),
          type: "image/jpeg",
        };
      }
      i += len;
    }
    throw Error("JPEG dimensions could not be read.");
  }
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    need(0, 20);
    if (v.getUint32(4, true) + 8 !== bytes.length)
      throw Error("Invalid WebP container length.");
    let i = 12;
    while (i + 8 <= bytes.length) {
      const kind = text(i, 4),
        len = v.getUint32(i + 4, true),
        o = i + 8;
      need(o, len);
      if (kind === "VP8X") {
        if (len !== 10) throw Error("Invalid WebP header.");
        const w = 1 + bytes[o + 4] + (bytes[o + 5] << 8) + (bytes[o + 6] << 16),
          h = 1 + bytes[o + 7] + (bytes[o + 8] << 8) + (bytes[o + 9] << 16);
        return {
          ...dimensions(w, h),
          type: "image/webp",
          still: !!(bytes[o] & 2),
        };
      }
      if (kind === "VP8 ") {
        need(o, 10);
        if (text(o + 3, 3) !== "\x9d\x01\x2a")
          throw Error("Invalid WebP frame.");
        return {
          ...dimensions(
            v.getUint16(o + 6, true) & 16383,
            v.getUint16(o + 8, true) & 16383,
          ),
          type: "image/webp",
        };
      }
      if (kind === "VP8L") {
        need(o, 5);
        if (bytes[o] !== 47) throw Error("Invalid WebP frame.");
        const b = v.getUint32(o + 1, true);
        return {
          ...dimensions((b & 16383) + 1, ((b >>> 14) & 16383) + 1),
          type: "image/webp",
        };
      }
      i = o + len + (len & 1);
    }
  }
  throw Error(
    "Choose a PNG, JPEG, WebP, GIF, or supported static SVG. The file contents must match the format.",
  );
}
const tags = [
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
];
const attrs = [
  "id",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "dx",
  "dy",
  "rotate",
  "textLength",
  "lengthAdjust",
  "href",
];
const presentation = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
]);
export function guardSvg(text) {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw Error("SVG files must be 2 MiB or smaller.");
  if (
    /<!DOCTYPE|<!ENTITY|<\?/i.test(
      text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, ""),
    )
  )
    throw Error(
      "SVG document types, entities, and processing instructions are not supported.",
    );
  const doc = new DOMParser().parseFromString(text, "image/svg+xml"),
    root = doc.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    doc.querySelector("parsererror")
  )
    throw Error("Invalid SVG document.");
  const all = [root, ...root.querySelectorAll("*")];
  if (all.length > 5000)
    throw Error("SVG has too many elements (maximum 5,000).");
  const allowedTags = new Set(tags.map((s) => s.toLowerCase())),
    allowedAttrs = new Set(attrs.map((s) => s.toLowerCase())),
    ids = new Map(),
    references = [];
  function checkValue(value) {
    if (
      /[\\\u0000-\u001f]|\/\*|@|(?:https?|file|data|javascript):|\/\//i.test(
        value,
      )
    )
      throw Error("SVG external or active content is not supported.");
    if (
      /url\s*\(/i.test(value) &&
      !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/.test(value)
    )
      throw Error("Only internal SVG references are supported.");
  }
  for (const el of all) {
    let depth = 0;
    for (let p = el; p; p = p.parentElement)
      if (++depth > 64) throw Error("SVG nesting exceeds 64 levels.");
    if (
      el.namespaceURI !== root.namespaceURI ||
      !allowedTags.has(el.localName.toLowerCase())
    )
      throw Error(
        "Unsupported SVG element: " +
          el.localName +
          ". Use a static vector without filters or embedded images.",
      );
    if (el.hasAttribute("style")) {
      const style = el.getAttribute("style");
      if (/@|\/\*|[\\\u0000-\u001f]/.test(style))
        throw Error("Unsupported SVG style syntax.");
      for (const declaration of style.split(";")) {
        if (!declaration.trim()) continue;
        const colon = declaration.indexOf(":"),
          key = declaration.slice(0, colon).trim().toLowerCase(),
          val = declaration.slice(colon + 1).trim();
        if (
          colon < 0 ||
          !presentation.has(key) ||
          !val ||
          /!important/i.test(val)
        )
          throw Error("Unsupported SVG style declaration.");
        el.setAttribute(key, val);
      }
      el.removeAttribute("style");
    }
    for (const a of [...el.attributes]) {
      if (a.name === "xmlns" || a.name === "xmlns:xlink") {
        if (
          ![
            "http://www.w3.org/2000/svg",
            "http://www.w3.org/1999/xlink",
          ].includes(a.value)
        )
          throw Error("Unsupported SVG namespace.");
        continue;
      }
      if (
        /^on/i.test(a.name) ||
        !allowedAttrs.has(a.localName.toLowerCase()) ||
        (a.namespaceURI && a.namespaceURI !== "http://www.w3.org/1999/xlink")
      )
        throw Error("Unsupported SVG attribute: " + a.name);
      checkValue(a.value);
      if (a.localName === "href" && !/^#[\w.-]+$/.test(a.value))
        throw Error("Only internal SVG references are supported.");
      const ref =
        a.localName === "href"
          ? a.value.match(/^#([\w.-]+)$/)
          : a.value.match(/^url\(\s*['"]?#([\w.-]+)['"]?\s*\)$/);
      if (ref) references.push({ el, id: ref[1] });
    }
    if (el.id) {
      if (!/^[\w.-]+$/.test(el.id) || ids.has(el.id))
        throw Error("SVG IDs must be unique simple identifiers.");
      ids.set(el.id, el);
    }
  }
  const edges = new Map(all.map((el) => [el, [...el.children]]));
  for (const { el, id } of references) {
    if (!ids.has(id)) throw Error("SVG contains a missing reference.");
    edges.get(el).push(ids.get(id));
  }
  const visiting = new Set(),
    done = new Set();
  function visit(el) {
    if (visiting.has(el)) throw Error("Cyclic SVG reference.");
    if (done.has(el)) return;
    visiting.add(el);
    for (const child of edges.get(el) || []) visit(child);
    visiting.delete(el);
    done.add(el);
  }
  for (const el of all) visit(el);
  const box = (root.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  let w = Number(root.getAttribute("width")?.replace(/px$/, "")),
    h = Number(root.getAttribute("height")?.replace(/px$/, ""));
  if (!w || !h) {
    if (
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      box[2] <= 0 ||
      box[3] <= 0
    )
      throw Error("SVG needs positive dimensions or a valid viewBox.");
    const scale = 512 / Math.max(box[2], box[3]);
    w = Math.max(1, Math.round(box[2] * scale));
    h = Math.max(1, Math.round(box[3] * scale));
  }
  dimensions(w, h);
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  const clean = DOMPurify.sanitize(
    new XMLSerializer().serializeToString(root),
    {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: [...attrs, "xmlns", "xmlns:xlink"],
      PARSER_MEDIA_TYPE: "application/xhtml+xml",
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    },
  );
  // Sanitization must not silently remove accepted artwork. Validate the serialized result again structurally.
  // DOMPurify also reports removing its own HTML body wrapper, which was never
  // part of the admitted SVG. Every removal from the actual SVG is an error.
  const removed = DOMPurify.removed.filter(
    (item) => item.attribute || item.element?.localName !== "body",
  );
  if (removed.length)
    throw Error(
      "SVG contains unsupported content removed by the sanitizer: " +
        removed
          .map((item) => item.attribute?.name || item.element?.localName)
          .join(", "),
    );
  return {
    blob: new Blob([clean], { type: "image/svg+xml" }),
    width: w,
    height: h,
    type: "image/svg+xml",
  };
}
export async function decodeBlob(blob, signal) {
  if (!(blob instanceof Blob) || !blob.size) throw Error("The file is empty.");
  if (blob.size > 16 * 1024 * 1024)
    throw Error("Image files must be 16 MiB or smaller.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  const prefix = new TextDecoder()
    .decode(bytes.subarray(0, 512))
    .replace(/^\uFEFF/, "")
    .trimStart();
  const svg =
    /^(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
      prefix,
    ) || prefix.startsWith("<");
  let info = svg
    ? guardSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    : inspectRaster(bytes);
  const source = info.blob || new Blob([bytes], { type: info.type });
  let bitmap, url;
  try {
    signal?.throwIfAborted();
    // createImageBitmap is specified to take the first frame of animated images.
    if (
      typeof createImageBitmap === "function" &&
      info.type !== "image/svg+xml"
    )
      bitmap = await createImageBitmap(source);
    else {
      url = URL.createObjectURL(source);
      bitmap = await new Promise((resolve, reject) => {
        const im = new Image();
        const abort = () => {
          im.src = "";
          reject(new DOMException("Cancelled", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        im.onload = () => {
          signal?.removeEventListener("abort", abort);
          resolve(im);
        };
        im.onerror = () => {
          signal?.removeEventListener("abort", abort);
          reject(Error("This image could not be decoded."));
        };
        im.src = url;
      });
    }
    signal?.throwIfAborted();
    const w = bitmap.width || bitmap.naturalWidth,
      h = bitmap.height || bitmap.naturalHeight;
    dimensions(w, h);
    // EXIF orientation may swap JPEG axes; total dimensions must still agree.
    if (!(
      (w === info.width && h === info.height) ||
      (info.type === "image/jpeg" && w === info.height && h === info.width)
    ))
      throw Error("Decoded dimensions do not match the file header.");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw Error("Canvas is unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    canvas.width = canvas.height = 1;
    return { width: w, height: h, pixels, still: info.still };
  } finally {
    bitmap?.close?.();
    if (url) URL.revokeObjectURL(url);
  }
}
