import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  MODIFIERS,
  DEFAULT_THEME,
  resolveTheme,
  parseThemeSetting,
  amplify,
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

test("five themes, four modifiers, Default first", () => {
  assert.deepEqual(
    THEMES.map((t) => t.name),
    ["Default", "Lude", "Nord", "Everforest", "System"],
  );
  assert.deepEqual(
    MODIFIERS.map((m) => m.name),
    ["Default", "Day", "Night", "Contrast"],
  );
  assert.equal(DEFAULT_THEME, "default");
});

test("every theme and modifier reads at WCAG AA", () => {
  for (const theme of THEMES)
    for (const { id: modifier } of MODIFIERS)
      for (const system of theme.system ? SYSTEMS : [undefined]) {
        const { tokens: k } = resolveTheme(theme.id, modifier, system),
          where = `${theme.id} ${modifier} ${JSON.stringify(system ?? "")}`,
          panels = [k["--ground"], k["--surface"], k["--raised"]],
          atLeast = (fg, backgrounds, ratio, what) => {
            for (const bg of backgrounds)
              assert.ok(
                contrast(fg, bg) >= ratio,
                `${where}: ${what} ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}`,
              );
          };
        atLeast(k["--ink"], [...panels, k["--accent-soft"]], 7, "text");
        atLeast(k["--muted"], panels, 4.5, "muted text");
        atLeast(
          k["--accent-text"],
          [...panels, k["--accent-soft"]],
          4.5,
          "accent text",
        );
        atLeast(k["--on-accent"], [k["--accent"]], 4.5, "text on accent");
        atLeast(k["--accent"], panels, 3, "accent fill against panels");
        atLeast(k["--warn"], [...panels, k["--accent-soft"]], 4.5, "warning");
        atLeast(k["--focus"], panels, 3, "focus ring");
        for (const value of Object.values(k))
          assert.match(value, /^(#[0-9a-f]{6}|0 2px \d+px #[0-9a-f]{8})$/);
      }
});

test("Contrast is pitch black with the main colour boosted", () => {
  for (const theme of THEMES.filter((t) => !t.system)) {
    const look = resolveTheme(theme.id, "contrast");
    assert.equal(look.tokens["--ground"], "#000000");
    assert.equal(look.tokens["--surface"], "#000000");
    assert.ok(look.contrast && look.dark);
    assert.ok(contrast(look.tokens["--accent"], "#000000") >= 8, theme.id);
  }
  assert.equal(amplify("#e6e6e6"), "#ffffff");
  // Boosting keeps the hue: orange stays orange, green stays green.
  const [r, g, b] = amplify("#e8802e")
    .match(/\w\w/g)
    .map((v) => parseInt(v, 16));
  assert.ok(r > g && g > b);
  // System uses the Windows accent as it is, only brighter on black.
  assert.equal(
    resolveTheme("system", "contrast", { accent: "#e81123", dark: true })
      .tokens["--ground"],
    "#000000",
  );
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
    "": { modifier: null, theme: "default", saved: false },
    dark: { modifier: "default", theme: "default", saved: true },
    light: { modifier: "day", theme: "default", saved: true },
    system: { modifier: null, theme: "default", saved: true },
    "dark:graphite": { modifier: "default", theme: "default", saved: true },
    "light:lewd": { modifier: "day", theme: "lude", saved: true },
    "dark:contrast": { modifier: "contrast", theme: "default", saved: true },
    "dark:dracula": { modifier: "default", theme: "default", saved: true },
    "night:nord": { modifier: "night", theme: "nord", saved: true },
    "contrast:system": { modifier: "contrast", theme: "system", saved: true },
  };
  for (const [value, expected] of Object.entries(cases))
    assert.deepEqual(parseThemeSetting(value), expected, value);
});
