import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, DEFAULT_THEME, themeTokens, contrast } from "../src/themes.js";

test("ten themes, graphite by default, one high contrast", () => {
  assert.equal(THEMES.length, 10);
  assert.equal(DEFAULT_THEME, "graphite");
  assert.equal(THEMES.filter((t) => t.contrast).length, 1);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
});

test("every theme reads at WCAG AA in both modes", () => {
  for (const theme of THEMES)
    for (const mode of ["dark", "light"]) {
      const k = themeTokens(theme.id, mode),
        where = `${theme.id} ${mode}`,
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
      atLeast(k["--warn"], [...panels, k["--accent-soft"]], 4.5, "warning");
      atLeast(k["--focus"], panels, 3, "focus ring");
      for (const value of Object.values(k))
        assert.match(value, /^(#[0-9a-f]{6}|0 2px \d+px #[0-9a-f]{8})$/);
    }
});

test("unknown themes fall back to graphite", () => {
  assert.deepEqual(
    themeTokens("nope", "dark"),
    themeTokens("graphite", "dark"),
  );
});
