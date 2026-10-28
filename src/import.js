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
// Filter primitives, each with the attributes it adds. Attributes are admitted
// for every element, like the rest of the allowlist. feImage is never listed:
// it draws other content into the render.
const filterPrimitives = {
  feFlood: [],
  feBlend: ["in2", "mode"],
  feColorMatrix: ["type", "values"],
  feOffset: ["dx", "dy"],
  feGaussianBlur: ["stdDeviation", "edgeMode"],
  feComposite: ["in2", "operator", "k1", "k2", "k3", "k4"],
};
// Presentation properties exporters write that a static drawing can honour
// (display:none hides a layer; color feeds currentColor).
const DRAWING_EXTRAS = [
  "color",
  "display",
  "visibility",
  "overflow",
  "paint-order",
  "vector-effect",
  "letter-spacing",
  "word-spacing",
  "font-stretch",
  "font-variant",
  "text-decoration",
  "direction",
  "baseline-shift",
  "color-interpolation",
  "color-rendering",
  "text-rendering",
  "image-rendering",
];
// Style properties that change nothing in a still picture (editor hints, text
// layout for features not drawn here). Dropped, never refused.
const NO_EFFECT_STYLE =
  /^(?:-[\w-]+|font-variant-[\w-]+|font-feature-settings|font-variation-settings|font-kerning|line-height|text-align|text-indent|text-transform|writing-mode|white-space|inline-size|shape-inside|shape-padding|shape-margin|solid-color|solid-opacity|enable-background)$/;
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
  "filter",
  ...Object.keys(filterPrimitives),
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
  "clipPathUnits",
  ...DRAWING_EXTRAS,
  "shape-rendering",
  "mask-type",
  "filter",
  "filterUnits",
  "primitiveUnits",
  "color-interpolation-filters",
  "flood-color",
  "flood-opacity",
  "in",
  "result",
  ...Object.values(filterPrimitives).flat(),
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
  ...DRAWING_EXTRAS,
  "shape-rendering",
  "mask-type",
  "filter",
  "color-interpolation-filters",
  "flood-color",
  "flood-opacity",
]);
// SVG ignores these as attributes, so they stay in `style`, limited to keywords.
const styleOnly = new Map([
  [
    "mix-blend-mode",
    new Set([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
      "plus-lighter",
    ]),
  ],
  ["isolation", new Set(["auto", "isolate"])],
]);
// Absolute CSS lengths in pixels; percentages and font-relative units have no
// fixed size, so the viewBox decides.
const UNITS = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};
export function svgLength(value) {
  const m =
    /^\s*(\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(
      value || "",
    );
  if (!m) return NaN;
  const v =
    Number(m[1] + (m[2] ? "e" + m[2] : "")) *
    UNITS[(m[3] || "px").toLowerCase()];
  return Number.isFinite(v) ? v : NaN;
}
export const SVG_EDGES = [256, 512, 1024, 2048];
const SVG_NS = "http://www.w3.org/2000/svg",
  XLINK_NS = "http://www.w3.org/1999/xlink",
  MAX_SVG_ELEMENTS = 5000;
// Drawing programs leave notes for themselves in what they export. Elements and
// attributes in these namespaces never draw anything, so they are dropped;
// any other foreign namespace is still refused.
const EDITOR_NAMESPACES = [
  /^http:\/\/www\.inkscape\.org\/namespaces\/inkscape$/,
  /^http:\/\/(?:inkscape\.sourceforge\.net|sodipodi\.sourceforge\.net)\/DTD\/sodipodi-0\.dtd$/,
  /^http:\/\/ns\.adobe\.com\/[\w./-]+$/,
  /^http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#$/,
  /^http:\/\/purl\.org\/dc\/elements\/1\.1\/$/,
  /^http:\/\/(?:creativecommons\.org|web\.resource\.org\/cc)\/ns#$/,
  /^http:\/\/www\.bohemiancoding\.com\/sketch\/ns$/,
  /^http:\/\/www\.serif\.com\/$/,
  /^http:\/\/www\.figma\.com\/figma\/ns$/,
];
const isEditorNamespace = (uri) =>
  !!uri && EDITOR_NAMESPACES.some((pattern) => pattern.test(uri));
// Exporters' document types: an external DTD is never fetched, and the only
// entities accepted are plain-text ones as Illustrator writes them (namespace
// addresses, and style declarations in older files). They cannot nest or refer
// outside the file, and the expanded text is capped. Processing instructions
// (stylesheet links, metadata packets) are dropped. Anything else in a DTD is
// refused.
function prepareSvgText(text) {
  text = text.replace(/^\uFEFF/, "");
  const declaration = /^\s*<\?xml\s[^?]*\?>/i.exec(text)?.[0] || "";
  let body = text.slice(declaration.length).replace(/<\?[\s\S]*?\?>/g, "");
  const doctype =
    /^((?:\s|<!--[\s\S]*?-->)*)<!DOCTYPE\s+svg(?:\s+(?:PUBLIC\s+(?:"[^"<>]*"|'[^'<>]*')\s+(?:"[^"<>]*"|'[^'<>]*')|SYSTEM\s+(?:"[^"<>]*"|'[^'<>]*')))?\s*(?:\[([\s\S]*?)\]\s*)?>/i.exec(
      body,
    );
  if (doctype) {
    const names = new Map();
    let subset = (doctype[2] || "").replace(/<!--[\s\S]*?-->/g, "");
    subset = subset.replace(
      /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+"([\w\s#.:;%,()\/+-]{0,256})"\s*>/g,
      (_, name, value) => {
        if (names.has(name) || names.size >= 32)
          throw Error("SVG document type declares too many entities.");
        names.set(name, value);
        return "";
      },
    );
    if (subset.trim())
      throw Error(
        "SVG document types may only declare plain-text entities; other declarations are not supported.",
      );
    body =
      doctype[1] +
      body
        .slice(doctype[0].length)
        .replace(/&([A-Za-z_][\w.-]*);/g, (ref, name) =>
          names.has(name) ? names.get(name) : ref,
        );
    if (body.length > 4 * 1024 * 1024)
      throw Error("SVG entities expand past 4 MiB.");
  }
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(body))
    throw Error(
      "SVG document types, entities, and processing instructions are not supported.",
    );
  return declaration + body;
}
// Simple stylesheets (class, id and element selectors, as Illustrator and many
// icon sets write them) are folded into each element's style attribute, ahead
// of its own declarations, so the usual style checks then apply to every value.
function inlineStyleSheets(root) {
  const sheets = [...root.getElementsByTagNameNS(SVG_NS, "style")];
  if (!sheets.length) return;
  const rules = [];
  let order = 0;
  for (const sheet of sheets) {
    const css = sheet.textContent.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/@|\\|<|url\s*\(\s*['"]?(?!#)/i.test(css))
      throw Error("SVG stylesheets may only contain simple rules.");
    const block = /([^{}]+)\{([^{}]*)\}/g;
    let rest = css,
      m;
    while ((m = block.exec(css))) {
      rest = rest.replace(m[0], "");
      for (const selector of m[1].split(",")) {
        const s = selector.trim();
        const parts =
          /^(\*|[A-Za-z][\w-]*)?((?:\.[\w-]+)*)(#[\w.-]+)?((?:\.[\w-]+)*)$/.exec(
            s,
          );
        if (!s || !parts || (!parts[1] && !parts[2] && !parts[3] && !parts[4]))
          throw Error("Unsupported SVG stylesheet selector: " + s);
        const classes = (parts[2] + parts[4]).split(".").filter(Boolean);
        rules.push({
          tag: parts[1] && parts[1] !== "*" ? parts[1].toLowerCase() : null,
          classes,
          id: parts[3]?.slice(1) || null,
          weight:
            (parts[3] ? 100 : 0) +
            classes.length * 10 +
            (parts[1] && parts[1] !== "*" ? 1 : 0),
          order: order++,
          declarations: m[2].trim(),
        });
      }
    }
    if (rest.trim())
      throw Error("SVG stylesheets may only contain simple rules.");
    sheet.remove();
  }
  rules.sort((a, b) => a.weight - b.weight || a.order - b.order);
  for (const el of root.querySelectorAll("*")) {
    const own = el.getAttribute("class")?.trim().split(/\s+/) || [];
    const matched = rules
      .filter(
        (r) =>
          (!r.tag || el.localName.toLowerCase() === r.tag) &&
          (!r.id || el.id === r.id) &&
          r.classes.every((c) => own.includes(c)),
      )
      .map((r) => r.declarations.replace(/;\s*$/, ""))
      .filter(Boolean);
    if (matched.length) {
      const inline = el.getAttribute("style");
      el.setAttribute("style", [...matched, inline].filter(Boolean).join(";"));
    }
  }
}
// <use> and <symbol> become plain copies, so nothing reaches the renderer by
// reference. Every copy counts against the element limit, so references that
// multiply (a use of a group of uses of \u2026) are refused instead of freezing.
function expandUses(root, count) {
  const queue = [...root.getElementsByTagNameNS(SVG_NS, "use")];
  while (queue.length) {
    const use = queue.shift();
    const href =
      use.getAttribute("href") ?? use.getAttributeNS(XLINK_NS, "href") ?? "";
    const ref = /^#([\w.-]+)$/.exec(href.trim());
    if (!ref) throw Error("Only internal SVG references are supported.");
    const target = root.ownerDocument.getElementById(ref[1]);
    if (!target || !root.contains(target))
      throw Error("SVG contains a missing reference.");
    if (target === use || target.contains(use))
      throw Error("Cyclic SVG reference.");
    count += 1 + target.querySelectorAll("*").length;
    if (count > MAX_SVG_ELEMENTS)
      throw Error("SVG has too many elements (maximum 5,000).");
    const doc = root.ownerDocument,
      group = doc.createElementNS(SVG_NS, "g");
    for (const a of [...use.attributes])
      if (!["x", "y", "width", "height", "href"].includes(a.localName))
        group.setAttributeNS(a.namespaceURI, a.name, a.value);
    const x = Number(use.getAttribute("x")) || 0,
      y = Number(use.getAttribute("y")) || 0;
    if (x || y)
      group.setAttribute(
        "transform",
        (
          (use.getAttribute("transform") || "") + ` translate(${x} ${y})`
        ).trim(),
      );
    let copy;
    if (target.localName === "symbol" || target.localName === "svg") {
      // A symbol draws like a nested <svg> sized by the use (100% by default).
      copy = doc.createElementNS(SVG_NS, "svg");
      for (const name of ["viewBox", "preserveAspectRatio"])
        if (target.hasAttribute(name))
          copy.setAttribute(name, target.getAttribute(name));
      copy.setAttribute(
        "width",
        use.getAttribute("width") || target.getAttribute("width") || "100%",
      );
      copy.setAttribute(
        "height",
        use.getAttribute("height") || target.getAttribute("height") || "100%",
      );
      for (const child of target.childNodes) copy.append(child.cloneNode(true));
    } else copy = target.cloneNode(true);
    // Copies keep pointing at the original's gradients, masks and clips, so
    // their own ids go: ids must stay unique.
    copy.removeAttribute("id");
    for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
    group.append(copy);
    use.replaceWith(group);
    queue.push(...group.getElementsByTagNameNS(SVG_NS, "use"));
  }
  // Symbols never draw on their own; as <defs> they keep their ids for the
  // references inside the copies.
  for (const symbol of [...root.getElementsByTagNameNS(SVG_NS, "symbol")]) {
    const defs = root.ownerDocument.createElementNS(SVG_NS, "defs");
    if (symbol.id) defs.id = symbol.id;
    const g = root.ownerDocument.createElementNS(SVG_NS, "g");
    g.append(...symbol.childNodes);
    defs.append(g);
    symbol.replaceWith(defs);
  }
}
// Removes what exporters add that never draws: editor metadata and namespaces,
// Illustrator's private data and its <switch> fallback, and attributes with no
// effect on the picture. Runs before the checks, which then see plain SVG.
function normaliseSvg(root) {
  const editorElements = [...root.querySelectorAll("*")].filter(
    (el) =>
      isEditorNamespace(el.namespaceURI) ||
      (el.namespaceURI === SVG_NS &&
        ["metadata", "foreignObject"].includes(el.localName)),
  );
  for (const el of editorElements) el.remove();
  // Illustrator wraps the artwork in <switch> with a foreignObject first; with
  // that gone, the first remaining child is what any viewer would draw.
  for (const sw of [...root.getElementsByTagNameNS(SVG_NS, "switch")]) {
    const g = root.ownerDocument.createElementNS(SVG_NS, "g");
    for (const a of [...sw.attributes])
      if (
        !/^(?:requiredFeatures|requiredExtensions|systemLanguage)$/.test(
          a.localName,
        )
      )
        g.setAttributeNS(a.namespaceURI, a.name, a.value);
    if (sw.firstElementChild) g.append(sw.firstElementChild);
    sw.replaceWith(g);
  }
  inlineStyleSheets(root);
  for (const el of [root, ...root.querySelectorAll("*")]) {
    // xlink:href is the older spelling of href; browsers draw both alike.
    if (el.hasAttributeNS(XLINK_NS, "href")) {
      if (!el.hasAttribute("href"))
        el.setAttribute("href", el.getAttributeNS(XLINK_NS, "href"));
      el.removeAttributeNS(XLINK_NS, "href");
    }
    for (const a of [...el.attributes]) {
      const prefixed = a.name.startsWith("xmlns:");
      if (
        isEditorNamespace(a.namespaceURI) ||
        (prefixed && (isEditorNamespace(a.value) || a.value === SVG_NS)) ||
        a.namespaceURI === "http://www.w3.org/XML/1998/namespace" ||
        (a.namespaceURI === null &&
          /^(?:version|baseProfile|class|enable-background|data-[\w-]+)$/.test(
            a.name,
          ))
      )
        el.removeAttributeNS(a.namespaceURI, a.localName);
    }
  }
  expandUses(root, 1 + root.querySelectorAll("*").length);
}
export function guardSvg(text, edge = 512) {
  if (!SVG_EDGES.includes(edge)) throw Error("Unsupported SVG size.");
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw Error("SVG files must be 2 MiB or smaller.");
  text = prepareSvgText(text);
  const doc = new DOMParser().parseFromString(text, "image/svg+xml"),
    root = doc.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== SVG_NS ||
    doc.querySelector("parsererror")
  )
    throw Error("Invalid SVG document.");
  if (1 + root.querySelectorAll("*").length > MAX_SVG_ELEMENTS)
    throw Error("SVG has too many elements (maximum 5,000).");
  normaliseSvg(root);
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
          ". Use a static vector without scripts or embedded images.",
      );
    const kept = [];
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
          colon >= 0 &&
          (NO_EFFECT_STYLE.test(key) ||
            (/^marker(?:-start|-mid|-end)?$/.test(key) &&
              val.toLowerCase() === "none"))
        )
          continue;
        if (colon >= 0 && styleOnly.has(key)) {
          if (!styleOnly.get(key).has(val.toLowerCase()))
            throw Error("Unsupported SVG style declaration.");
          kept.push(key + ":" + val.toLowerCase());
          continue;
        }
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
    // Written back after the attribute check so `style` itself is never admitted raw.
    if (kept.length) el.setAttribute("style", kept.join(";"));
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
      .map(Number),
    hasBox =
      box.length === 4 &&
      box.every(Number.isFinite) &&
      box[2] > 0 &&
      box[3] > 0;
  // The stated size gives the shape; the drawing is rendered at `edge` pixels
  // on its longest side, so small icons (Fluent Color is 32 × 32) stay sharp.
  let sw = svgLength(root.getAttribute("width")),
    sh = svgLength(root.getAttribute("height"));
  if (!(sw > 0 && sh > 0)) {
    if (!hasBox)
      throw Error("SVG needs positive dimensions or a valid viewBox.");
    sw = box[2];
    sh = box[3];
  } else if (!hasBox) root.setAttribute("viewBox", "0 0 " + sw + " " + sh);
  const scale = Math.min(
      edge / Math.max(sw, sh),
      Math.sqrt(MAX_PIXELS / (sw * sh)),
    ),
    w = Math.min(8192, Math.max(1, Math.round(sw * scale))),
    h = Math.min(8192, Math.max(1, Math.round(sh * scale)));
  dimensions(w, h);
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  const clean = DOMPurify.sanitize(
    new XMLSerializer().serializeToString(root),
    {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: [...attrs, "xmlns", "xmlns:xlink", "style"],
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
export async function decodeBlob(blob, signal, { svgEdge = 512 } = {}) {
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
    ? guardSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes), svgEdge)
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
    return {
      width: w,
      height: h,
      pixels,
      still: info.still,
      svg: info.type === "image/svg+xml",
    };
  } finally {
    bitmap?.close?.();
    if (url) URL.revokeObjectURL(url);
  }
}
