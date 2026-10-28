// Screenshots of the built HexShift.html for review and for the website.
//   npm run screenshots            sizes from a phone to 2560 × 1440, both themes
//   npm run screenshots -- website the website's 1280 × 720 pair
// Images go to screenshots/ (git-ignored). Run `npm run build` first.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const website = process.argv.includes("website");
const sizes = website
  ? [["website", 1280, 720]]
  : [
      ["phone", 360, 800],
      ["minimum", 720, 540],
      ["desktop", 1280, 840],
      ["full-hd", 1920, 1080],
      ["wide", 2560, 1440],
    ];
const out = resolve("screenshots");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const [label, width, height] of sizes)
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(resolve("HexShift.html")).href);
    await page
      .locator("#palette button")
      .first()
      .waitFor({ state: "attached" });
    await page.locator("#theme").selectOption(theme);
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
    const name = website
      ? `hexshift-editor-${theme}.png`
      : `${label}-${width}x${height}-${theme}.png`;
    await page.screenshot({ path: resolve(out, name) });
    await page.close();
  }
await browser.close();
console.log("Screenshots in " + out);
