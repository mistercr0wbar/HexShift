import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sample from "../../src/sample.js";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { THEMES, MODIFIERS, resolveTheme } from "../../src/themes.js";
const svg = (body, attrs = "") => ({
  name: "asset.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" ${attrs}>${body}</svg>`,
  ),
});
// Treatment, colour model, selection preview, background and view are
// segmented radio groups; the group keeps the old control id.
const choose = (page, id, value) =>
  page.locator(`#${id} input[value="${value}"]`).check();
// Picks a theme and modifier from the theme menu, then closes it.
async function look(page, theme, modifier) {
  await page.locator("#themeMenu summary").click();
  await page.locator(`#uiTheme input[value="${theme}"]`).check();
  await page.locator(`#theme input[value="${modifier}"]`).check();
  await page.keyboard.press("Escape");
}
const token = (page, name) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
// Reads a stored ZIP back through its central directory.
function unzip(buffer) {
  const v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    end = buffer.length - 22,
    files = {};
  let at = v.getUint32(end + 16, true);
  for (let i = v.getUint16(end + 10, true); i > 0; i--) {
    const size = v.getUint32(at + 20, true),
      nameLength = v.getUint16(at + 28, true),
      offset = v.getUint32(at + 42, true),
      name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8"),
      start = offset + 30 + v.getUint16(offset + 26, true);
    files[name] = buffer.subarray(start, start + size);
    at += 46 + nameLength;
  }
  return files;
}
async function exportFile(page) {
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  return {
    name: file.suggestedFilename(),
    bytes: await readFile(await file.path()),
  };
}
async function ready(page) {
  await expect(page.locator("#palette button").first()).toBeVisible();
  await expect(page.locator("#cancel")).toBeHidden();
}
async function pick(page) {
  await page.locator("#palette button").first().click();
  await expect(page.locator("#cancel")).toBeHidden();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});
test("sample, modes, exact target, undo/redo and export", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await pick(page);
  await choose(page, "mode", "flat");
  await page.locator("#targetHex").fill("#12AB34");
  await page.locator("#targetHex").press("Tab");
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#targetResult")).toContainText("achieved #12AB34");
  await page.locator("#apply").click();
  await ready(page);
  await expect(page.locator("#editState")).toHaveText("No pending edit");
  await page.locator("#undo").click();
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await page.locator("#redo").click();
  await ready(page);
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  expect(errors).toEqual([]);
});
test("valid static SVG preserves viewBox aspect ratio; malicious inputs preserve document", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles(svg('<rect width="10" height="5" fill="#f00"/>'));
  await expect(page.locator("#fileDims")).toContainText("512 × 256");
  await ready(page);
  for (const bad of [
    svg("<script>alert(1)</script>"),
    svg('<rect width="10" height="5" onload="alert(1)"/>'),
    svg('<image href="https://example.com/private.png"/>'),
    svg('<rect style="fill:url(https://example.com/x)"/>'),
    svg('<g id="a" clip-path="url(#a)"/>'),
    svg('<filter id="f"><feImage href="https://example.com/x.png"/></filter>'),
    svg('<filter id="f"><feImage href="#r"/></filter><rect id="r"/>'),
    svg('<rect fill="red" style="mix-blend-mode:url(#x)"/>'),
    svg('<rect fill="red" style="mix-blend-mode:hard-mix"/>'),
    svg('<rect fill="red"/>', 'xmlns:evil="https://example.com"'),
  ]) {
    await page.locator("#fileInput").setInputFiles(bad);
    await expect(page.locator("#status")).toContainText("Could not open");
    await expect(page.locator("#fileDims")).toContainText("512 × 256");
  }
});
test("malformed, oversized and misleading file types are rejected by contents", async ({
  page,
}) => {
  for (const input of [
    {
      name: "a.png",
      mimeType: "image/png",
      buffer: Buffer.from("<html>not an image</html>"),
    },
    {
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(16 * 1024 * 1024 + 1),
    },
  ]) {
    await page.locator("#fileInput").setInputFiles(input);
    await expect(page.locator("#status")).toContainText("Could not open");
    await expect(page.locator("#fileDims")).toHaveText("128 × 128");
  }
  await page.locator("#fileInput").setInputFiles({
    name: "<script>bad</script>.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(sample.split(",")[1], "base64"),
  });
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText(
    "<script>bad</script>.bin",
  );
  expect(await page.locator("#fileName script").count()).toBe(0);
});
test("lossless WebP export decodes to the exact PNG pixel values", async ({
  page,
}) => {
  await pick(page);
  await choose(page, "overlay", "normal");
  let download = page.waitForEvent("download");
  await page.locator("#export").click();
  const png = await readFile(await (await download).path());
  await page.locator("#format").selectOption("webp");
  download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.webp$/);
  const webp = await readFile(await file.path());
  const a = await sharp(png).ensureAlpha().raw().toBuffer(),
    b = await sharp(webp).ensureAlpha().raw().toBuffer();
  expect([...b]).toEqual([...a]);
});
test("shift lands on the target in both colour models", async ({ page }) => {
  await pick(page);
  for (const model of ["oklch", "hsl"]) {
    await choose(page, "model", model);
    await page.locator("#targetHex").fill("#5865F2");
    await page.locator("#targetHex").press("Tab");
    await expect(page.locator("#cancel")).toBeHidden();
    await expect(page.locator("#targetResult")).toContainText(
      "Requested #5865F2 · achieved #5865F2",
    );
    await expect(page.locator("#capWarning")).toBeHidden();
  }
  await expect(page.locator("#dsLabel")).toHaveText("Saturation");
});
test("outline appears in the export and the real-size preview", async ({
  page,
}) => {
  await pick(page);
  await page.locator("#outlinePanel summary").click();
  await page.locator("#outline").check();
  await page.locator("#outlineHex").fill("#00FF00");
  await page.locator("#outlineWidth").fill("10");
  await expect(page.locator("#outlineWidthValue")).toContainText("10%");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const { data, info } = await sharp(
    await readFile(await (await download).path()),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBeGreaterThanOrEqual(128);
  let green = 0;
  for (let i = 0; i < data.length; i += 4)
    if (
      data[i] === 0 &&
      data[i + 1] === 255 &&
      data[i + 2] === 0 &&
      data[i + 3] === 255
    )
      green++;
  expect(green).toBeGreaterThan(200);
  await page
    .locator("#previewGround")
    .selectOption({ label: "Primary button" });
  const tiles = page.locator("#previewTiles canvas");
  await expect(tiles).toHaveCount(5);
  const lit = await tiles.nth(4).evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(100);
});
test("platform sizes export at their dimensions and within their limits", async ({
  page,
}) => {
  await pick(page);
  for (const [id, width, height, limit] of [
    ["discord-emoji", 128, 128, 256],
    ["discord-sticker", 320, 320, 512],
    ["slack-emoji", 128, 128, 128],
    ["telegram-sticker", 512, 512, 512],
    ["telegram-emoji", 100, 100, 256],
    ["youtube-emoji", 48, 48, 1024],
  ]) {
    await page.locator("#size").selectOption(id);
    await expect(page.locator("#sizeReadout")).toContainText(
      width + " × " + height + " PNG",
    );
    const { name, bytes } = await exportFile(page);
    expect(name).toMatch(new RegExp("-" + id + "\\.png$"));
    const info = await sharp(bytes).metadata();
    expect([info.width, info.height]).toEqual([width, height]);
    expect(bytes.length).toBeLessThanOrEqual(limit * 1024);
  }
  await page.locator("#size").selectOption("twitch-emotes");
  await expect(page.locator("#format")).toBeDisabled();
  await expect(page.locator("#export")).toHaveText("Export ZIP");
  const pack = await exportFile(page);
  expect(pack.name).toMatch(/-twitch-emotes\.zip$/);
  const entries = unzip(pack.bytes);
  expect(Object.keys(entries).map((n) => n.replace(/^.*-/, ""))).toEqual([
    "112px.png",
    "56px.png",
    "28px.png",
  ]);
  for (const [entry, data] of Object.entries(entries)) {
    const info = await sharp(data).metadata();
    expect(info.width + "px.png").toBe(entry.replace(/^.*-/, ""));
  }
  await page.locator("#size").selectOption("custom");
  await page.locator("#customSize").fill("40");
  await expect(page.locator("#sizeReadout")).toContainText("40 × 40 PNG");
  const custom = await exportFile(page);
  expect((await sharp(custom.bytes).metadata()).width).toBe(40);
});
test("WhatsApp packs a small WebP sticker and tray icon, or says why not", async ({
  page,
  browserName,
}) => {
  await pick(page);
  const webp = await page.evaluate(() =>
    document
      .createElement("canvas")
      .toDataURL("image/webp")
      .startsWith("data:image/webp"),
  );
  if (browserName !== "webkit") expect(webp).toBe(true);
  await page.locator("#size").selectOption("whatsapp-sticker");
  if (!webp) {
    await expect(page.locator("#sizeReadout")).toContainText(
      "can't be made in this browser",
    );
    await page.locator("#export").click();
    await expect(page.locator("#status")).toContainText(
      "can't be made in this browser",
    );
    return;
  }
  await expect(page.locator("#sizeReadout")).toContainText("small WebP");
  const pack = await exportFile(page),
    entries = unzip(pack.bytes),
    names = Object.keys(entries);
  expect(names.map((n) => n.replace(/^.*-/, ""))).toEqual([
    "sticker.webp",
    "tray.png",
  ]);
  const sticker = entries[names[0]],
    tray = entries[names[1]];
  expect(sticker.length).toBeLessThanOrEqual(100 * 1024);
  expect(tray.length).toBeLessThanOrEqual(50 * 1024);
  const a = await sharp(sticker).metadata(),
    b = await sharp(tray).metadata();
  expect([a.format, a.width, a.height, a.hasAlpha]).toEqual([
    "webp",
    512,
    512,
    true,
  ]);
  expect([b.format, b.width, b.height]).toEqual(["png", 96, 96]);
  await page.locator("#size").selectOption("original");
  await page.locator("#format").selectOption("webp-small");
  await expect(page.locator("#export")).toHaveText("Export WebP");
  const small = await exportFile(page);
  expect((await sharp(small.bytes).metadata()).format).toBe("webp");
});
test("SVGs draw at the chosen size and redraw only after confirmation", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles(
      svg(
        '<rect width="10" height="5" fill="#f00"/>',
        'width="32.5" height="16.25"',
      ),
    );
  await expect(page.locator("#fileDims")).toHaveText("512 × 256");
  await expect(page.locator("#svgSizeGroup")).toBeVisible();
  await page.locator("#svgSize").selectOption("256");
  await expect(page.locator("#fileDims")).toHaveText("256 × 128");
  await expect(page.locator("#status")).toContainText(
    "Redrew asset.svg at 256 px",
  );
  await ready(page);
  await pick(page);
  await choose(page, "mode", "flat");
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await page.locator("#svgSize").selectOption("1024");
  await expect(page.locator("#replaceTitle")).toHaveText(
    "Redraw the SVG at a new size?",
  );
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.locator("#svgSize")).toHaveValue("256");
  await expect(page.locator("#fileDims")).toHaveText("256 × 128");
  await page.locator("#svgSize").selectOption("1024");
  await page.getByRole("button", { name: "Redraw", exact: true }).click();
  await expect(page.locator("#fileDims")).toHaveText("1024 × 512");
  await page.locator("#fileInput").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(sample.split(",")[1], "base64"),
  });
  await expect(page.locator("#fileDims")).toHaveText("128 × 128");
  await expect(page.locator("#svgSizeGroup")).toBeHidden();
});
test("colour names, rgb() and the screen picker set the target", async ({
  page,
  browser,
}) => {
  await pick(page);
  await page.locator("#targetHex").fill("rebeccapurple");
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #663399",
  );
  await page.locator("#targetHex").fill("rgb(88 101 242)");
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #5865F2",
  );
  await page.locator("#targetHex").fill("not a colour");
  await expect(page.locator("#targetHex")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.addInitScript(() => {
    let calls = 0;
    window.EyeDropper = class {
      async open() {
        if (calls++)
          throw new DOMException(
            "The user canceled the selection.",
            "AbortError",
          );
        return { sRGBHex: "#248046" };
      }
    };
  });
  await page.reload();
  await ready(page);
  await pick(page);
  await page.locator("#eyeDropper").click();
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #248046",
  );
  await page.locator("#eyeDropper").click();
  await expect(page.locator("#status")).toHaveText("No colour was picked.");
  const context = await browser.newContext(),
    plain = await context.newPage();
  await plain.addInitScript(() => delete window.EyeDropper);
  await plain.goto("/");
  await ready(plain);
  await expect(plain.locator("#eyeDropper")).toBeHidden();
  await context.close();
});
test("in the Windows app the screen picker asks the host and takes only its answer", async ({
  page,
}) => {
  // Stands in for WebView2's chrome.webview and the host's replies.
  await page.addInitScript(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      sent: [],
      postMessage(message) {
        this.sent.push(message);
      },
      addEventListener(type, listener) {
        if (type === "message") listeners.push(listener);
      },
      reply(data) {
        for (const listener of listeners) listener({ data });
      },
    };
    // WebView2 has EyeDropper too, but the host's picker is the one used.
    window.EyeDropper = class {
      async open() {
        throw new Error("EyeDropper was used");
      }
    };
  });
  await page.reload();
  await ready(page);
  await pick(page);
  await page.locator("#eyeDropper").click();
  expect(await page.evaluate(() => window.chrome.webview.sent)).toEqual([
    "pick-colour",
  ]);
  const reply = (data) =>
    page.evaluate((d) => window.chrome.webview.reply(d), data);
  await reply({ type: "picked-colour", hex: "#248046" });
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #248046",
  );
  await reply({ type: "picked-colour", hex: null });
  await expect(page.locator("#status")).toHaveText("No colour was picked.");
  await reply({ type: "something-else", hex: "#FF0000" });
  await reply("#FF0000");
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #248046",
  );
});
test("palettes open from files and paste, and save as GIMP palettes", async ({
  page,
}) => {
  await page.locator("#palettePanel summary").click();
  await page.locator("#paletteInput").setInputFiles({
    name: "brand.gpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(
      "GIMP Palette\nName: Brand\n#\n 18 171  52\tGreen\n255 128   0\tOrange\n",
    ),
  });
  await expect(page.locator("#paletteSet")).toHaveValue(/^user-/);
  await expect(page.locator("#presets button")).toHaveCount(2);
  await pick(page);
  await page.getByRole("button", { name: "Green #12AB34" }).click();
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #12AB34",
  );
  // A palette dropped or opened as an image file is still read as a palette.
  await page.locator("#fileInput").setInputFiles({
    name: "lospec.hex",
    mimeType: "text/plain",
    buffer: Buffer.from("ff0000\n00ff00\n0000ff\n"),
  });
  await expect(page.locator("#presets button")).toHaveCount(3);
  await expect(page.locator("#fileDims")).toHaveText("128 × 128");
  // Firefox hides the data of a synthetic paste event, so this part runs
  // where the browser passes it through.
  const synthetic = await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "x");
    return (
      new ClipboardEvent("paste", {
        clipboardData: data,
      }).clipboardData?.getData("text/plain") === "x"
    );
  });
  if (synthetic) {
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "#111111, #222222, #333333, #444444");
      document.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    });
    await expect(page.locator("#presets button")).toHaveCount(4);
    await expect(page.locator("#paletteSet option:checked")).toHaveText(
      "Pasted palette",
    );
  }
  await page.locator("#paletteSet").selectOption("skin-noto");
  const download = page.waitForEvent("download");
  await page.locator("#savePalette").click();
  const file = await download;
  // WebKit on Linux turns spaces in download names into underscores.
  expect(file.suggestedFilename()).toMatch(/^Skin[ _]tones[ _]Noto\.gpl$/);
  const text = await readFile(await file.path(), "utf8");
  expect(text.startsWith("GIMP Palette\nName: Skin tones · Noto\n")).toBe(true);
  expect(text).toContain("249 221 189\tLight");
  expect(text).toContain("178 104  48\tLight shade 2");
  expect(
    text
      .trim()
      .split("\n")
      .filter((l) => /^\s*\d/.test(l)),
  ).toHaveLength(14);
});
test("variants preview each colour and export the same bytes as a single edit", async ({
  page,
}) => {
  await pick(page);
  await page.locator("#palettePanel summary").click();
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variants .variant")).toHaveCount(4);
  await expect(page.locator("#exportVariants")).toBeVisible();
  const lit = await page
    .locator("#variants canvas")
    .first()
    .evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    });
  expect(lit).toBeGreaterThan(100);
  const pack = await (async () => {
    const download = page.waitForEvent("download");
    await page.locator("#exportVariants").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/-variants-discord\.zip$/);
    return unzip(await readFile(await file.path()));
  })();
  expect(Object.keys(pack).map((n) => n.replace(/^.*-/, ""))).toEqual([
    "5865f2.png",
    "4e5058.png",
    "248046.png",
    "da373c.png",
  ]);
  await page.locator("#variants .variant").first().click();
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#targetResult")).toContainText(
    "Requested #5865F2",
  );
  const single = await exportFile(page);
  expect(single.name).toMatch(/-5865f2\.png$/);
  expect(Buffer.compare(single.bytes, pack[Object.keys(pack)[0]])).toBe(0);
  // Skin tones: five variants, each a two- or three-colour tone.
  await page.locator("#paletteSet").selectOption("skin-fluent");
  await expect(page.locator("#variants")).toBeHidden();
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variants .variant")).toHaveCount(5);
  await page.locator("#variants .variant", { hasText: /^Medium$/ }).click();
  await expect(page.locator("#targetResult")).toContainText(
    "Tone #C68D7B · #A9715F",
  );
  await page.locator("#hueTol").fill("90");
  await expect(page.locator("#variantsNote")).toBeVisible();
  await expect(page.locator("#variants")).toHaveClass(/stale/);
});
const raw = async (bytes) =>
  (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
    .data;
test("the colour map changes several colours at once, with undo", async ({
  page,
}) => {
  const rows = page.locator("#colourMap .map-select");
  await pick(page);
  await page.locator("#targetHex").fill("#248046");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("→ #248046");
  await page.locator("#addRow").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(1)).toContainText("Pick a colour");
  await page.getByRole("button", { name: "Pick #000000" }).click();
  await expect(page.locator("#cancel")).toBeHidden();
  await page.locator("#targetHex").fill("#FFFFFF");
  await expect(rows.nth(1)).toContainText("#000000 → #FFFFFF");
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(rows.nth(1)).toContainText(" px");
  // One export carries both: a green heart with a white outline.
  const both = await exportFile(page),
    source = await raw(Buffer.from(sample.split(",")[1], "base64")),
    out = await raw(both.bytes);
  expect(both.name).toMatch(/-shifted\.png$/);
  const centre = (64 * 128 + 64) * 4;
  expect(out[centre + 1]).toBeGreaterThan(out[centre] + 40);
  let outline = 0;
  for (let i = 0; i < source.length; i += 4)
    if (
      source[i + 3] === 255 &&
      source[i] + source[i + 1] + source[i + 2] === 0
    ) {
      expect(Math.min(out[i], out[i + 1], out[i + 2])).toBeGreaterThan(230);
      outline++;
    }
  expect(outline).toBeGreaterThan(20);
  // Each row keeps its own target; removing one is undoable.
  await rows.first().click();
  await expect(page.locator("#targetHex")).toHaveValue("#248046");
  await page.getByRole("button", { name: "Remove colour 2" }).click();
  await expect(rows).toHaveCount(1);
  await page.locator("#undo").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("#000000 → #FFFFFF");
});
test("map all colours, then save a recipe, apply it and batch it into a ZIP", async ({
  page,
}) => {
  const rows = page.locator("#colourMap .map-select");
  await page.locator("#mapAll").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("unchanged");
  await expect(page.locator("#editState")).toHaveText("No pending edit");
  await page.locator("#targetHex").fill("#5865F2");
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await expect(page.locator("#cancel")).toBeHidden();
  const edited = await raw((await exportFile(page)).bytes);
  await page.locator("#recipePanel summary").click();
  const saving = page.waitForEvent("download");
  await page.locator("#saveRecipe").click();
  const file = await saving;
  expect(file.suggestedFilename()).toBe("red_heart-recipe.json");
  const text = await readFile(await file.path(), "utf8"),
    recipe = JSON.parse(text);
  expect(recipe).toMatchObject({ format: "hexshift-recipe", version: 1 });
  expect(recipe.steps).toHaveLength(1);
  expect(recipe.steps[0].rows).toHaveLength(2);
  // On a fresh page the recipe gives the same pixels.
  await page.reload();
  await ready(page);
  await page.locator("#recipePanel summary").click();
  await page.locator("#recipeInput").setInputFiles({
    name: "heart.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(page.locator("#status")).toContainText("Applied heart.json");
  await expect(page.locator("#cancel")).toBeHidden();
  const replayed = await raw((await exportFile(page)).bytes);
  expect(Buffer.compare(replayed, edited)).toBe(0);
  // A malformed recipe is refused without touching the image.
  await page.locator("#recipeInput").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"hexshift-recipe","version":9,"steps":[]}'),
  });
  await expect(page.locator("#status")).toContainText("newer version");
  // Batch: two images and one broken file, into one ZIP.
  const heart = Buffer.from(sample.split(",")[1], "base64"),
    batching = page.waitForEvent("download");
  await page.locator("#batchInput").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: heart },
    { name: "two.png", mimeType: "image/png", buffer: heart },
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("nope") },
  ]);
  const batch = await batching;
  expect(batch.suggestedFilename()).toBe("hexshift-batch.zip");
  const files = unzip(await readFile(await batch.path()));
  expect(Object.keys(files).sort()).toEqual([
    "errors.txt",
    "one-shifted.png",
    "two-shifted.png",
  ]);
  expect(files["errors.txt"].toString()).toContain("broken.png");
  expect(Buffer.compare(await raw(files["one-shifted.png"]), edited)).toBe(0);
  await expect(page.locator("#batchNote")).toContainText("Done: 2 of 3 images");
});
test("brush overrides, history and preview background do not alter export alpha", async ({
  page,
}) => {
  await page.locator("#brushPanel").locator("summary").click();
  await page.locator("#brushAdd").click();
  const box = await page.locator("#resultCanvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#coverage")).toContainText("pixels selected");
  await choose(page, "mode", "transparent");
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await page.locator("#undo").click();
  await expect(page.locator('#mode input[value="shift"]')).toBeChecked();
  await page.locator("#redo").click();
  await expect(page.locator('#mode input[value="transparent"]')).toBeChecked();
  await choose(page, "background", "white");
  await expect(page.locator("#cancel")).toBeHidden();
  const alpha = await page
    .locator("#resultCanvas")
    .evaluate((c) => c.getContext("2d").getImageData(64, 64, 1, 1).data[3]);
  expect(alpha).toBeLessThan(255);
});
test("responsive workspace, keyboard palette and theme persist without image storage", async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 800],
    [768, 1024],
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#export")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width < 960) {
      const canvas = await page.locator("#viewport").boundingBox(),
        controls = await page.locator(".inspector").boundingBox();
      expect(canvas.y).toBeLessThan(controls.y);
    }
  }
  await look(page, "default", "night");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#palette button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#seeds .seed")).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "hexshift-theme",
  ]);
});
test("network and content security policy block external resources and script injection", async ({
  page,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.injected=true";
    document.body.append(script);
  });
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await pick(page);
  expect(external).toEqual([]);
});
test("worker fallback remains editable", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw Error("Blocked worker");
      }
    };
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173");
  await ready(page);
  await pick(page);
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await context.close();
});
test("portable HTML opens without a server", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("file:///" + resolve("HexShift.html").replaceAll("\\", "/"));
  await ready(page);
  await pick(page);
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await context.close();
});
test("rapid edits and export during processing save the latest preview", async ({
  page,
}) => {
  await pick(page);
  await choose(page, "mode", "flat");
  await page.locator("#targetHex").fill("#FF0000");
  await page.locator("#targetHex").fill("#00FF00");
  await page.locator("#targetHex").fill("#123456");
  await page.locator("#targetHex").press("Tab");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const image = await sharp(await readFile(await (await download).path()))
    .ensureAlpha()
    .raw()
    .toBuffer();
  let matched = 0;
  for (let i = 0; i < image.length; i += 4)
    if (image[i] === 18 && image[i + 1] === 52 && image[i + 2] === 86)
      matched++;
  expect(matched).toBeGreaterThan(100);
  await expect(page.locator("#targetResult")).toContainText("achieved #123456");
});
test("large images remain cancellable and a new edit resumes processing", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await sharp({
    create: { width: 2048, height: 2048, channels: 4, background: "#FF0000" },
  })
    .png()
    .toBuffer();
  await page.locator("#fileInput").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await expect(page.locator("#fileDims")).toContainText("2048 × 2048");
  await ready(page);
  // Edits at this size now finish in well under a second, so cancel in the
  // same task as the pick instead of racing the worker.
  await page.evaluate(() => {
    document.querySelector("#palette button").click();
    document.getElementById("cancel").click();
  });
  await expect(page.locator("#status")).toContainText("cancelled");
  await choose(page, "mode", "flat");
  await expect(page.locator("#cancel")).toBeHidden({ timeout: 60000 });
  await expect(page.locator("#editState")).toHaveText("Pending edit");
});
test("SVG geometry, styles, gradients and hostile XML limits", async ({
  page,
}) => {
  const good = svg(
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="10" height="5" style="fill:url(#g);opacity:0.8"/>',
  );
  await page.locator("#fileInput").setInputFiles(good);
  await expect(page.locator("#fileDims")).toContainText("512 × 256");
  await ready(page);
  const raw = (name, text) => ({
    name,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(text),
  });
  // Five levels of ten uses each: 100,000 copies if expanded.
  let explosive = '<g id="l0"><rect width="1" height="1"/></g>';
  for (let i = 1; i <= 5; i++)
    explosive +=
      `<g id="l${i}">` + `<use href="#l${i - 1}"/>`.repeat(10) + "</g>";
  const bad = [
    svg("<g>".repeat(65) + "<rect/>" + "</g>".repeat(65)),
    svg("<rect/>".repeat(5001)),
    // Entities that nest, read files or declare parameters stay refused.
    raw(
      "laughs.svg",
      '<!DOCTYPE svg [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>&b;</title></svg>',
    ),
    raw(
      "external.svg",
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///C:/Windows/win.ini">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>&x;</title></svg>',
    ),
    raw(
      "parameter.svg",
      '<!DOCTYPE svg [<!ENTITY % p "x">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    ),
    svg(
      '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
    ),
    // <use> may not multiply past the element limit, loop, or leave the file.
    svg(`<defs>${explosive}</defs><use href="#l5"/>`),
    svg('<g id="a"><use href="#a"/></g>'),
    svg('<use href="https://example.com/a.svg#x"/>'),
    svg('<use href="#missing"/>'),
    // Stylesheets: simple rules only, nothing external.
    svg(
      '<style>@import url(https://example.com/x.css);</style><rect width="10" height="5"/>',
    ),
    svg(
      '<style>rect{fill:url(https://example.com/x)}</style><rect width="10" height="5"/>',
    ),
    svg('<style>g rect{fill:red}</style><rect width="10" height="5"/>'),
    svg('<foo:bar xmlns:foo="https://example.com"/>'),
  ];
  for (const input of bad) {
    await page.locator("#fileInput").setInputFiles(input);
    await expect(page.locator("#status")).toContainText("Could not open");
    await expect(page.locator("#fileDims")).toContainText("512 × 256");
  }
});
test("SVGs exported by Illustrator, Inkscape and icon tools open and draw", async ({
  page,
}) => {
  const at = (x, y) =>
    page
      .locator("#resultCanvas")
      .evaluate(
        (c, [x, y]) => [...c.getContext("2d").getImageData(x, y, 1, 1).data],
        [x, y],
      );
  const near = (actual, hex) => {
    const want = hex.match(/../g).map((v) => parseInt(v, 16));
    for (let i = 0; i < 3; i++)
      expect(
        Math.abs(actual[i] - want[i]),
        `${actual} vs #${hex}`,
      ).toBeLessThan(4);
    expect(actual[3]).toBe(255);
  };
  for (const [file, dims, samples] of [
    // Document type with namespace and style entities, a stylesheet, the
    // <switch> wrapper, private data and a hidden layer.
    [
      "illustrator-export.svg",
      "512 × 512",
      [
        [100, 256, "e8384f"],
        [400, 256, "1e5bc6"],
        [300, 256, "1e5bc6"],
      ],
    ],
    // Editor namespaces, metadata, chained gradients, clip units, a hidden text.
    [
      "inkscape-export.svg",
      "512 × 256",
      [
        [100, 128, "ff8000"],
        [40, 120, "ff8000"],
        [400, 128, "00ff00"],
      ],
    ],
    // <use> with offsets and inherited fill, and a symbol scaled by its viewBox.
    [
      "use-symbol.svg",
      "512 × 256",
      [
        [64, 64, "d32f2f"],
        [192, 64, "1565c0"],
        [280, 20, "2e7d32"],
        [384, 128, "ffffff"],
      ],
    ],
  ]) {
    await page
      .locator("#fileInput")
      .setInputFiles(resolve("tests/fixtures/" + file));
    await expect(page.locator("#fileName")).toHaveText(file);
    await expect(page.locator("#fileDims")).toContainText(dims);
    await ready(page);
    await expect(page.locator("#status")).not.toContainText("Could not open");
    for (const [x, y, hex] of samples) near(await at(x, y), hex);
  }
});
test("Fluent Color SVG filters, mask types and blend modes", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles(resolve("tests/fixtures/1st_place_medal_color.svg"));
  await expect(page.locator("#fileDims")).toContainText("512 × 512");
  await ready(page);
  const shadow = svg(
    '<defs><filter id="s" x="0" y="0" width="10" height="5" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"/><feBlend mode="normal" in="SourceGraphic" in2="bg" result="shape"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hard"/><feOffset dx="-0.2" dy="0.2"/><feGaussianBlur stdDeviation="0.2"/><feComposite in2="hard" operator="arithmetic" k2="-1" k3="1"/><feBlend mode="normal" in2="shape"/></filter><mask id="m" mask-type="alpha"><rect width="10" height="5" fill="#000"/></mask></defs><g filter="url(#s)" mask="url(#m)"><rect width="10" height="5" fill="#f00"/><rect width="10" height="5" fill="#00f" style="mix-blend-mode:multiply"/></g>',
  );
  await page.locator("#fileInput").setInputFiles(shadow);
  await expect(page.locator("#fileDims")).toContainText("512 × 256");
  await ready(page);
  await expect(page.locator("#status")).not.toContainText("Could not open");
});
test("wide screens show the canvas over three side-by-side panels; phones switch panels with tabs", async ({
  page,
}) => {
  const box = (selector) => page.locator(selector).boundingBox();
  const [selection, colour, exported] = await Promise.all(
    ["selection", "colour", "export"].map((p) =>
      box(`.panel[data-panel="${p}"]`),
    ),
  );
  expect(selection.y).toBe(colour.y);
  expect(colour.y).toBe(exported.y);
  expect(selection.x).toBeLessThan(colour.x);
  expect(colour.x).toBeLessThan(exported.x);
  expect((await box("#viewport")).height).toBeGreaterThanOrEqual(300);
  await expect(page.locator(".dock-tabs")).toBeHidden();
  // Treatment choices answer the arrow keys like any radio group.
  await pick(page);
  await page.locator('#mode input[value="shift"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('#mode input[value="flat"]')).toBeChecked();
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#targetResult")).toContainText("achieved");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator(".dock-tabs")).toBeVisible();
  await expect(page.locator("#targetHex")).toBeVisible();
  await expect(page.locator("#size")).toBeHidden();
  await page.locator('.dock-tabs [data-tab="export"]').click();
  await expect(page.locator("#size")).toBeVisible();
  await expect(page.locator("#targetHex")).toBeHidden();
  await page.locator('.dock-tabs [data-tab="selection"]').click();
  await expect(page.locator("#palette button").first()).toBeVisible();
});
test("on touch screens controls are finger-sized and two fingers pinch to zoom", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Mobile emulation and multi-touch input use Chromium.",
  );
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#palette button").first()).toBeAttached();
  await expect(page.locator("#cancel")).toBeHidden();
  for (const selector of [
    "#open",
    "#undo",
    "#export",
    "#zoomIn",
    "#mode label",
    ".dock-tabs button",
    "#targetHex",
  ]) {
    const heights = await page
      .locator(selector)
      .evaluateAll((els) =>
        els
          .filter((el) => el.offsetParent)
          .map((el) => el.getBoundingClientRect().height),
      );
    expect(heights.length, selector).toBeGreaterThan(0);
    for (const h of heights) expect(h, selector).toBeGreaterThanOrEqual(40);
  }
  const before = await page.locator("#zoomReadout").textContent();
  const space = await page.locator(".after .canvas-space").boundingBox();
  const cx = space.x + space.width / 2,
    cy = space.y + space.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type, spread) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [
              { x: cx - spread, y: cy, id: 1 },
              { x: cx + spread, y: cy, id: 2 },
            ],
    });
  await touch("touchStart", 30);
  for (const spread of [45, 60, 75, 90]) await touch("touchMove", spread);
  await touch("touchEnd", 0);
  await expect(page.locator("#zoomReadout")).not.toHaveText(before);
  // A pinch never picks a colour.
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  await context.close();
});
test("touch-sized tools, wipe comparison, keyboard text shortcuts and zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await choose(page, "view", "wipe");
  await expect(page.locator("#wipeControl")).toBeVisible();
  await page.locator("#wipe").fill("25");
  await expect(page.locator("#wipeCanvas")).toHaveCSS(
    "clip-path",
    "inset(0px 75% 0px 0px)",
  );
  await page.locator("#targetHex").focus();
  await page.locator("#targetHex").press("ControlOrMeta+A");
  await page.locator("#targetHex").press("Backspace");
  await expect(page.locator("#targetHex")).toHaveValue("");
  await page.locator("#targetHex").fill("#ABC");
  await page.locator("#targetHex").press("Tab");
  await expect(page.locator("#targetHex")).toHaveValue("#AABBCC");
  await page.locator("#zoomIn").click();
  await expect(page.locator("#zoomReadout")).not.toHaveText("100%");
});
test("offline shell, cache isolation and PWA manifest", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Service-worker lifecycle coverage uses Chromium; static policy tests also cover all cache branches.",
  );
  // Production installs only register over HTTPS; local test registers the same shell explicitly.
  await page.evaluate(async () => {
    await caches.open("another-app");
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await ready(page);
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
  expect(await page.evaluate(() => caches.has("another-app"))).toBe(true);
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  await page.context().setOffline(true);
  await page.reload();
  await ready(page);
  await pick(page);
  await page.context().setOffline(false);
});
test("themes and modifiers apply, persist in the one theme setting and pass accessibility checks", async ({
  page,
  browserName,
}) => {
  test.setTimeout(150000);
  await pick(page);
  await page.locator("#themeMenu summary").click();
  await expect(page.locator("#uiTheme label")).toHaveCount(5);
  await expect(page.locator("#theme label")).toHaveText([
    "Default",
    "Day",
    "Night",
    "Contrast",
  ]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".theme-pop")).toBeHidden();
  await look(page, "nord", "night");
  expect(await token(page, "--surface")).toBe("#21262f");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => [
      Object.keys(localStorage),
      localStorage.getItem("hexshift-theme"),
    ]),
  ).toEqual([["hexshift-theme"], "night:nord"]);
  await page.reload();
  await ready(page);
  expect(await token(page, "--surface")).toBe("#21262f");
  await expect(page.locator('#uiTheme input[value="nord"]')).toBeChecked();
  await expect(page.locator('#theme input[value="night"]')).toBeChecked();
  // Contrast: pitch black with the theme's main colour boosted.
  await look(page, "lude", "contrast");
  expect(await token(page, "--ground")).toBe("#000000");
  expect(await token(page, "--accent")).toBe(
    resolveTheme("lude", "contrast").tokens["--accent"],
  );
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  // Every theme with every modifier, in one engine (the default look is
  // checked in all three by the next test).
  if (browserName !== "chromium") return;
  await pick(page);
  for (const { id } of THEMES)
    for (const { id: modifier } of MODIFIERS) {
      await look(page, id, modifier);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          theme: id + " " + modifier,
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
});
test("the System theme follows the colours the Windows app sends", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage() {},
      addEventListener(type, listener) {
        if (type === "message") listeners.push(listener);
      },
      reply(data) {
        for (const listener of listeners) listener({ data });
      },
    };
  });
  await page.reload();
  await ready(page);
  await look(page, "system", "default");
  const send = (data) =>
    page.evaluate((d) => window.chrome.webview.reply(d), data);
  await send({ type: "system-colours", accent: "#0078D4", dark: false });
  const light = resolveTheme("system", "default", {
    accent: "#0078d4",
    dark: false,
  }).tokens;
  expect(await token(page, "--accent")).toBe(light["--accent"]);
  expect(await token(page, "--ground")).toBe(light["--ground"]);
  await send({ type: "system-colours", accent: "#E81123", dark: true });
  const dark = resolveTheme("system", "default", {
    accent: "#e81123",
    dark: true,
  }).tokens;
  expect(await token(page, "--accent")).toBe(dark["--accent"]);
  expect(await token(page, "--ground")).toBe("#141414");
  // Contrast keeps the Windows accent over pitch black.
  await look(page, "system", "contrast");
  expect(await token(page, "--ground")).toBe("#000000");
  expect(await token(page, "--accent")).toBe(
    resolveTheme("system", "contrast", { accent: "#e81123", dark: true })
      .tokens["--accent"],
  );
  // Anything else from the host is ignored.
  for (const bad of [
    { type: "system-colours", accent: "red", dark: true },
    { type: "system-colours", accent: "#00FF00" },
    { type: "other", accent: "#00FF00", dark: true },
    "#00FF00",
  ])
    await send(bad);
  expect(await token(page, "--accent")).toBe(
    resolveTheme("system", "contrast", { accent: "#e81123", dark: true })
      .tokens["--accent"],
  );
});
test("accessibility in light/dark themes and at 200 percent zoom", async ({
  page,
}) => {
  for (const theme of ["day", "default"]) {
    await look(page, "default", theme);
    await pick(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page.evaluate(() => (document.body.style.zoom = "2"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#export")).toBeInViewport();
});
test("replacement confirmation is transactional and cancellation retains edits", async ({
  page,
}) => {
  await pick(page);
  await page
    .locator("#fileInput")
    .setInputFiles(svg('<rect width="10" height="5" fill="#f00"/>'));
  await expect(page.locator("#replaceDialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.locator("#fileDims")).toHaveText("128 × 128");
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await page
    .locator("#fileInput")
    .setInputFiles(svg('<rect width="10" height="5" fill="#0f0"/>'));
  await expect(page.locator("#replaceDialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Open new image", exact: true })
    .click();
  await expect(page.locator("#fileDims")).toHaveText("512 × 256");
  await ready(page);
});

test("JPEG/WebP signatures and animated GIF first-frame import", async ({
  page,
}) => {
  for (const format of ["jpeg", "webp"]) {
    const buffer = await sharp({
      create: { width: 8, height: 4, channels: 4, background: "#ff0000" },
    })
      [format]()
      .toBuffer();
    await page.locator("#fileInput").setInputFiles({
      name: "image." + format,
      mimeType: "application/octet-stream",
      buffer,
    });
    await expect(page.locator("#fileDims")).toHaveText("8 × 4");
    await ready(page);
  }
  // Two one-pixel frames, red then blue. createImageBitmap must pick the first.
  const gif = Buffer.from([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 0, 0, 0, 0, 255, 33,
    249, 4, 0, 1, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 33,
    249, 4, 0, 1, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 76, 1, 0, 59,
  ]);
  await page.locator("#fileInput").setInputFiles({
    name: "animated.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await expect(page.locator("#fileDims")).toHaveText("1 × 1 · first frame");
  await ready(page);
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const rgba = await sharp(await readFile(await (await download).path()))
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect([...rgba]).toEqual([255, 0, 0, 255]);
});

test("repeated imports release fallback pixel buffers", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Backing-store measurements use Chromium CDP; processing correctness is covered in all engines.",
  );
  test.setTimeout(90000);
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw Error("Exercise fallback");
      }
    };
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173");
  await ready(page);
  const cdp = await context.newCDPSession(page),
    fixture = await sharp({
      create: { width: 512, height: 512, channels: 4, background: "#f00000" },
    })
      .png()
      .toBuffer();
  async function load() {
    await page.locator("#fileInput").setInputFiles({
      name: "memory.png",
      mimeType: "image/png",
      buffer: fixture,
    });
    await expect(page.locator("#fileDims")).toHaveText("512 × 512");
    await ready(page);
  }
  await load();
  await cdp.send("HeapProfiler.collectGarbage");
  const first = await cdp.send("Runtime.getHeapUsage");
  for (let i = 0; i < 8; i++) await load();
  await cdp.send("HeapProfiler.collectGarbage");
  const last = await cdp.send("Runtime.getHeapUsage");
  expect(
    (last.backingStorageSize || last.usedSize) -
      (first.backingStorageSize || first.usedSize),
  ).toBeLessThan(16 * 1024 * 1024);
  await context.close();
});
