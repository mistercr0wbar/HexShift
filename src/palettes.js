import { oklchToRgb, toHex } from "./colour.js";
// Built-in sets. A skin-tone entry is a ramp: the colours one tone uses, main
// tone first (see docs/research.md for the sources).
const tones = (name, rows) => ({
  id: "skin-" + name.toLowerCase(),
  label: "Skin tones · " + name,
  entries: ["Light", "Medium-light", "Medium", "Medium-dark", "Dark"].map(
    (label, i) => ({
      label,
      hex: "#" + rows[i][0],
      ramp: rows[i].map((v) => "#" + v),
    }),
  ),
});
export const SETS = [
  {
    id: "discord",
    label: "Discord buttons",
    entries: [
      { label: "Primary", hex: "#5865F2" },
      { label: "Secondary", hex: "#4E5058" },
      { label: "Success", hex: "#248046" },
      { label: "Danger", hex: "#DA373C" },
    ],
  },
  {
    id: "rainbow",
    label: "Rainbow · equal brightness",
    entries: Array.from({ length: 12 }, (_, i) => {
      const hex = toHex(...oklchToRgb(0.7, 0.15, i * 30 + 25));
      return { label: hex, hex };
    }),
  },
  tones("Fluent", [
    ["FFD7C2", "F1B99B"],
    ["EEBFAA", "D6A089"],
    ["C68D7B", "A9715F"],
    ["966661", "764C49"],
    ["573739", "341A1C"],
  ]),
  tones("Twemoji", [
    ["F7DECE", "E0AA94"],
    ["F3D2A2", "D2A077"],
    ["D4AB88", "B78B60"],
    ["AF7E57", "90603E"],
    ["7C533E", "583529"],
  ]),
  tones("Noto", [
    ["F9DDBD", "EFB682", "B26830"],
    ["E0BB95", "D19661", "8D542E"],
    ["BA8D68", "9A6648", "62392B"],
    ["A56C43", "824624", "422319"],
    ["70534A", "58382B"],
  ]),
  tones("OpenMoji", [
    ["FADCBC", "DEBB90"],
    ["DEBB90", "C19A65"],
    ["C19A65", "A57939"],
    ["A57939", "6A462F"],
    ["6A462F", "352318"],
  ]),
];
export const MAX_PALETTE_BYTES = 256 * 1024,
  MAX_PALETTE_COLOURS = 1024;
const byte = (v) => {
  const n = Number(v);
  return /^\d{1,3}$/.test(v) && n <= 255 ? n : NaN;
};
// Reads GIMP .gpl, JASC-PAL .pal, Paint.NET .txt, Lospec .hex, or pasted text
// listing hex colours or "R G B" rows. Returns [{ hex, label }] with repeats
// removed; throws with a reason when nothing usable is found.
export function parsePalette(text) {
  if (typeof text !== "string") throw Error("A palette must be text.");
  if (new TextEncoder().encode(text).length > MAX_PALETTE_BYTES)
    throw Error("Palette files must be 256 KB or smaller.");
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/),
    out = [],
    seen = new Set();
  const add = (rgb, label = "") => {
    if (rgb.some((v) => !Number.isInteger(v)))
      throw Error("Invalid colour in palette.");
    const hex = toHex(...rgb);
    if (seen.has(hex)) return;
    seen.add(hex);
    if (out.length >= MAX_PALETTE_COLOURS)
      throw Error("Palettes can have at most 1,024 colours.");
    out.push({ hex, label: label.trim().slice(0, 60) || hex });
  };
  const first = lines[0].trim();
  if (first === "GIMP Palette") {
    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || /^(Name|Columns):/i.test(t)) continue;
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(t);
      if (!m) throw Error("This GIMP palette has a line that is not a colour.");
      add([byte(m[1]), byte(m[2]), byte(m[3])], m[4]);
    }
  } else if (first === "JASC-PAL") {
    const count = Number(lines[2]?.trim());
    if (lines[1]?.trim() !== "0100" || !Number.isInteger(count))
      throw Error("This JASC palette has an invalid header.");
    const rows = lines
      .slice(3)
      .map((l) => l.trim())
      .filter(Boolean);
    if (rows.length !== count)
      throw Error(
        "This JASC palette's colour count does not match its header.",
      );
    for (const row of rows) {
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(row);
      if (!m) throw Error("This JASC palette has a line that is not a colour.");
      add([byte(m[1]), byte(m[2]), byte(m[3])]);
    }
  } else {
    // Paint.NET (AARRGGBB), Lospec .hex and pasted lists: hex anywhere on a
    // line, or a line of three numbers. Lines with neither are skipped.
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith(";") || t.startsWith("//")) continue;
      const argb = /^([\da-f]{2})([\da-f]{6})$/i.exec(t);
      if (argb) {
        add([0, 2, 4].map((i) => parseInt(argb[2].slice(i, i + 2), 16)));
        continue;
      }
      // Bare hex only as a whole line (Lospec), so words like "facade" in
      // pasted prose are not read as colours.
      const hexes = /^[\da-f]{6}$/i.test(t)
        ? [t]
        : t.match(/#[\da-f]{6}\b|#[\da-f]{3}\b/gi);
      if (hexes) {
        for (const h of hexes) {
          let s = h.replace("#", "");
          if (s.length === 3) s = [...s].map((c) => c + c).join("");
          add([0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)));
        }
        continue;
      }
      const m = /^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/.exec(t);
      if (m) add([byte(m[1]), byte(m[2]), byte(m[3])]);
    }
  }
  if (!out.length) throw Error("No colours were found in this palette.");
  return out;
}
// A GIMP palette, which GIMP, Inkscape, Krita, Aseprite and Lospec all read.
export function writeGpl(name, entries) {
  const clean = (s) =>
    String(s)
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim();
  return (
    "GIMP Palette\nName: " +
    (clean(name) || "Hex Shift") +
    "\nColumns: 0\n#\n" +
    entries
      .map(({ hex, label }) => {
        const [r, g, b] = [1, 3, 5].map((i) =>
          parseInt(hex.slice(i, i + 2), 16),
        );
        return (
          [r, g, b].map((v) => String(v).padStart(3)).join(" ") +
          "\t" +
          clean(label || hex)
        );
      })
      .join("\n") +
    "\n"
  );
}
// Whether a dropped or opened file should be read as a palette, not an image.
export const isPaletteFile = (file) =>
  /\.(gpl|hex|pal|txt)$/i.test(file.name || "") || file.type === "text/plain";
