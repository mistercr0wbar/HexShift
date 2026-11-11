import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  MODIFIERS,
  DEFAULT_THEME,
  resolveTheme,
  parseThemeSetting,
  contrast,
} from "../src/themes.js";

// Accents the System theme might get from Windows: graphite (a dark grey),
// the default blue, a pale yellow, and none at all.
const SYSTEMS = [
  { accent: "#3a3a3a", dark: true },
  { accent: "#0078d4", dark: false },
  { accent: "#fff4a3", dark: true },
  { accent: null, dark: false },
  {},
];

test("six character themes, Neutral and System each have four modifiers", () => {
  assert.deepEqual(
    THEMES.map((t) => t.name),
    [
      "BARCHORD I",
      "BARCHORD IV",
      "BARCHORD V",
      "BARDON",
      "BARNEY",
      "BARBIE",
      "Neutral",
      "System",
    ],
  );
  assert.deepEqual(
    MODIFIERS.map((m) => m.name),
    ["Default", "Day", "Night", "Contrast"],
  );
  assert.equal(DEFAULT_THEME, "barchord");
});

test("every theme and modifier reads at WCAG AA", () => {
  for (const theme of THEMES)
    for (const { id: modifier } of MODIFIERS)
      for (const system of theme.system ? SYSTEMS : [undefined]) {
        const { tokens: k } = resolveTheme(theme.id, modifier, system),
          where = `${theme.id} ${modifier} ${JSON.stringify(system ?? "")}`,
          panels = [
            k["--ground"],
            k["--surface"],
            k["--chrome"],
            k["--masthead"],
            k["--raised"],
            k["--hover"],
          ],
          textSurfaces = [...panels, k["--accent-soft"]],
          atLeast = (fg, backgrounds, ratio, what) => {
            for (const bg of backgrounds)
              assert.ok(
                contrast(fg, bg) >= ratio,
                `${where}: ${what} ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}`,
              );
          };
        atLeast(k["--ink"], textSurfaces, 7, "text");
        atLeast(k["--muted"], textSurfaces, 4.5, "muted text");
        for (const token of ["--wordmark", "--maker-credit", "--maker-wordmark"])
          atLeast(k[token], [k["--masthead"]], 4.5, token);
        atLeast(k["--accent-text"], textSurfaces, 4.5, "accent text");
        atLeast(
          k["--on-accent"],
          [k["--accent"], k["--accent-hover"]],
          4.5,
          "text on accent",
        );
        atLeast(
          k["--field-line"],
          [k["--raised"], k["--hover"]],
          3,
          "input boundary",
        );
        atLeast(k["--trim"], textSurfaces, 4.5, "trim text");
        atLeast(k["--accent"], panels, 3, "accent fill against panels");
        atLeast(k["--warn"], textSurfaces, 4.5, "warning");
        atLeast(k["--focus"], textSurfaces, 3, "focus ring");
        for (const value of Object.values(k))
          assert.match(value, /^(#[0-9a-f]{6}|0 2px \d+px #[0-9a-f]{8})$/);
      }
});

test("Contrast uses black surfaces with bright character or system accents", () => {
  for (const theme of THEMES.filter((t) => !t.system)) {
    const look = resolveTheme(theme.id, "contrast");
    assert.equal(look.tokens["--ground"], "#000000");
    assert.equal(look.tokens["--surface"], "#000000");
    assert.equal(look.tokens["--chrome"], "#000000");
    assert.ok(look.contrast && look.dark);
    assert.ok(contrast(look.tokens["--accent"], "#000000") >= 8, theme.id);
  }
  const red = resolveTheme("system", "contrast", {
    accent: "#e81123",
    dark: true,
  }).tokens;
  assert.equal(red["--ground"], "#000000");
  assert.ok(contrast(red["--accent"], "#000000") >= 8);
  const [r, g, b] = red["--accent"].match(/\w\w/g).map((v) => parseInt(v, 16));
  assert.ok(r > g && r > b);
});

test("character combinations persist across modifiers and the canvas stays neutral", () => {
  for (const { id: modifier } of MODIFIERS) {
    const iv = resolveTheme("barchord-iv", modifier).tokens;
    const v = resolveTheme("barchord-v", modifier).tokens;
    const barbie = resolveTheme("barbie", modifier).tokens;
    assert.equal(iv["--chrome"], v["--chrome"]);
    assert.notEqual(iv["--accent"], v["--accent"]);
    assert.notEqual(barbie["--accent"], barbie["--trim"]);
    for (const { id } of THEMES) {
      const { tokens } = resolveTheme(id, modifier);
      for (const key of ["--ground", "--checker1", "--checker2"])
        assert.equal(tokens[key], iv[key], `${id} ${modifier} ${key}`);
    }
  }
});

test("System follows the Windows light or dark app mode", () => {
  assert.equal(
    resolveTheme("system", "default", { accent: "#0078d4", dark: false }).dark,
    false,
  );
  assert.equal(
    resolveTheme("system", "default", { accent: "#0078d4", dark: true }).dark,
    true,
  );
  assert.equal(
    resolveTheme("system", "day", { accent: "#0078d4", dark: true }).dark,
    false,
  );
});

test("settings from 3.0 and earlier read as the nearest new look", () => {
  const cases = {
    "": { modifier: null, theme: "barchord", saved: false },
    dark: { modifier: "default", theme: "default", saved: true },
    light: { modifier: "day", theme: "default", saved: true },
    system: { modifier: null, theme: "default", saved: true },
    "dark:graphite": { modifier: "default", theme: "default", saved: true },
    "light:lewd": { modifier: "day", theme: "barchord-iv", saved: true },
    "dark:contrast": { modifier: "contrast", theme: "default", saved: true },
    "dark:dracula": { modifier: "default", theme: "default", saved: true },
    "night:nord": { modifier: "night", theme: "barney", saved: true },
    "day:lude": { modifier: "day", theme: "barchord-iv", saved: true },
    "contrast:everforest": {
      modifier: "contrast",
      theme: "bardon",
      saved: true,
    },
    "default:default": { modifier: "default", theme: "default", saved: true },
    "day:barbie": { modifier: "day", theme: "barbie", saved: true },
    "contrast:system": { modifier: "contrast", theme: "system", saved: true },
  };
  for (const [value, expected] of Object.entries(cases))
    assert.deepEqual(parseThemeSetting(value), expected, value);
});
