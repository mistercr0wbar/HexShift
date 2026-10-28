// Screenshots of the built HexShift.html for review and for the website.
//   npm run screenshots             sizes from a phone to 2560 × 1440, Day and Default
//   npm run screenshots -- themes   every theme with every modifier at 1280 × 840
//   npm run screenshots -- website  the website's 1280 × 720 pair
// Images go to screenshots/ (git-ignored). Run `npm run build` first.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { THEMES, MODIFIERS, DEFAULT_THEME } from "../src/themes.js";

const kind = ["themes", "website"].find((k) => process.argv.includes(k));
const sizes =
  kind === "website"
    ? [["website", 1280, 720]]
    : kind === "themes"
      ? [["theme", 1280, 840]]
      : [
          ["phone", 360, 800],
          ["minimum", 720, 540],
          ["desktop", 1280, 840],
          ["full-hd", 1920, 1080],
          ["wide", 2560, 1440],
        ];
const themes = kind === "themes" ? THEMES.map((t) => t.id) : [DEFAULT_THEME];
const out = resolve("screenshots");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const [label, width, height] of sizes)
  for (const theme of themes)
    for (const mode of kind === "themes"
      ? MODIFIERS.map((m) => m.id)
      : ["day", "default"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      // The page reads the stored theme as it starts.
      await page.addInitScript(
        (value) => localStorage.setItem("hexshift-theme", value),
        mode + ":" + theme,
      );
      await page.goto(pathToFileURL(resolve("HexShift.html")).href);
      await page
        .locator("#palette button")
        .first()
        .waitFor({ state: "attached" });
      // The same edit every time: the heart's first colour to Discord blurple.
      // Clicked from script: on phones the swatches sit behind the Selection tab.
      await page.evaluate(() =>
        document.querySelector("#palette button").click(),
      );
      await page.locator("#cancel").waitFor({ state: "hidden" });
      await page.locator("#targetHex").fill("#5865F2");
      await page.locator("#targetHex").press("Tab");
      await page.locator("#cancel").waitFor({ state: "hidden" });
      await page.waitForTimeout(400);
      const name =
        kind === "website"
          ? `hexshift-editor-${mode === "day" ? "light" : "dark"}.png`
          : kind === "themes"
            ? `theme-${theme}-${mode}.png`
            : `${label}-${width}x${height}-${mode}.png`;
      await page.screenshot({ path: resolve(out, name) });
      await page.close();
    }
await browser.close();
console.log("Screenshots in " + out);
