// The three defects found in the 3.5.0 release. Each one failed on the
// shipped page before the repair.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const settled = (page) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false");
async function ready(page) {
  await expect(page.locator("#palette button").first()).toBeVisible();
  await settled(page);
}
async function openPanel(page, id) {
  const toggle = page.locator(`.panel[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
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
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await ready(page);
});

test("a short Colour panel scrolls instead of covering Adjust", async ({
  page,
}) => {
  const split = page.getByRole("separator", { name: "Resize Colour", exact: true });
  await split.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowUp");
  await page.reload();
  await ready(page);
  const boxes = await page.evaluate(() => {
    const colour = document.querySelector("[data-panel=colour]");
    const adjust = document.querySelector("[data-panel=adjust]");
    const body = colour.querySelector(".panel-body");
    const bodyBox = body.getBoundingClientRect();
    return {
      bodyBottom: bodyBox.bottom,
      nextTop: adjust.getBoundingClientRect().top,
      stored: JSON.parse(localStorage.getItem("hexshift-layout")).spans.colour,
      scrolls: body.scrollHeight > body.clientHeight + 1,
    };
  });
  expect(boxes.stored).toBe(80);
  expect(boxes.scrolls).toBe(true);
  expect(boxes.bodyBottom).toBeLessThanOrEqual(boxes.nextTop + 1);
  const reached = await page.evaluate(() => {
    const body = document.querySelector("#colourBody");
    const last = body.querySelector("#protect");
    body.scrollTop = body.scrollHeight;
    last.focus();
    const bodyBox = body.getBoundingClientRect();
    const box = last.getBoundingClientRect();
    const seen = Math.min(box.bottom, bodyBox.bottom) - Math.max(box.top, bodyBox.top);
    return seen > 8 && body.scrollTop > 0;
  });
  expect(reached).toBe(true);
});

test("restored variant previews export the palette shown on those previews", async ({
  page,
}) => {
  const bytes = await sharp({
    create: { width: 12, height: 8, channels: 4, background: "#e02020" },
  })
    .png()
    .toBuffer();
  await page.locator("#fileInput").setInputFiles(
    ["one.png", "two.png"].map((name) => ({
      name,
      mimeType: "image/png",
      buffer: bytes,
    })),
  );
  await expect(page.locator("#fileName")).toHaveText("two.png");
  await ready(page);
  await page.keyboard.press("Control+1");
  await ready(page);
  await openPanel(page, "swatches");
  await page.locator("#palette button").first().click();
  await settled(page);
  await page.locator("#makeVariants").click();
  await expect(page.locator("#exportVariants")).toBeVisible();
  await expect(page.locator("#variantsLabel")).toHaveText(
    "Variants: Discord buttons",
  );
  const previewLabels = await page
    .locator("#variants .variant span")
    .allTextContents();
  expect(previewLabels).toEqual(["Primary", "Secondary", "Success", "Danger"]);
  await page.keyboard.press("Control+2");
  await ready(page);
  await page.locator("#paletteSet").selectOption("rainbow");
  await page.keyboard.press("Control+1");
  await ready(page);
  await expect(page.locator("#variants .variant span")).toHaveText(
    previewLabels,
  );
  await expect(page.locator("#paletteSet")).toHaveValue("rainbow");
  await expect(page.locator("#variantsLabel")).toHaveText(
    "Variants: Discord buttons",
  );
  await expect(page.locator("#variants")).not.toHaveClass(/stale/);
  const download = page.waitForEvent("download");
  await page.locator("#exportVariants").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-variants-discord\.zip$/);
  const pack = unzip(await readFile(await file.path()));
  const names = Object.keys(pack).map((name) => name.replace(/^.*-/, ""));
  expect(names).toEqual([
    "5865f2.png",
    "4e5058.png",
    "248046.png",
    "da373c.png",
  ]);
});

test("editing Saved colours does not change variants already made from it", async ({
  page,
}) => {
  await openPanel(page, "swatches");
  await page.locator("#palette button").first().click();
  await settled(page);
  await page.locator("#targetHex").fill("#112233");
  await page.locator("#targetHex").press("Tab");
  await page.locator("#saveCurrentColour").click();
  await page.locator("#targetHex").fill("#445566");
  await page.locator("#targetHex").press("Tab");
  await page.locator("#saveCurrentColour").click();
  await page.locator("#paletteSet").selectOption("saved");
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variants .variant")).toHaveCount(2);
  await expect(page.locator("#variantsLabel")).toHaveText(
    "Variants: Saved colours",
  );
  await page.locator("#targetHex").fill("#778899");
  await page.locator("#targetHex").press("Tab");
  await page.locator("#saveCurrentColour").click();
  await expect(page.locator("#variants .variant")).toHaveCount(2);
  await expect(page.locator("#presets button")).toHaveCount(3);
  const download = page.waitForEvent("download");
  await page.locator("#exportVariants").click();
  const file = await download;
  const pack = unzip(await readFile(await file.path()));
  expect(Object.keys(pack).map((name) => name.replace(/^.*-/, ""))).toEqual([
    "112233.png",
    "445566.png",
  ]);
});

test("saved custom column widths keep the picture usable when the window narrows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPanel(page, "outline");
  await page.locator('[data-panel="outline"] .panel-menu').click();
  await page
    .getByRole("menuitem", { name: "Move to left column", exact: true })
    .click();
  for (const [id, key] of [
    ["splitLeft", "ArrowRight"],
    ["splitRight", "ArrowLeft"],
  ]) {
    await page.locator("#" + id).focus();
    for (let i = 0; i < 25; i++) await page.keyboard.press(key);
  }
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("hexshift-layout")).sizes,
  );
  expect(before.left + before.right).toBeGreaterThan(440);
  await page.setViewportSize({ width: 800, height: 720 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "custom");
  const narrow = await page.evaluate(() => ({
    window: innerWidth,
    page: document.documentElement.scrollWidth,
    canvas: document.querySelector(".centre").getBoundingClientRect().width,
    stored: JSON.parse(localStorage.getItem("hexshift-layout")).sizes,
    left: document.querySelector('[data-region="left"]').getBoundingClientRect()
      .width,
  }));
  expect(narrow.canvas).toBeGreaterThanOrEqual(360);
  expect(narrow.page).toBeLessThanOrEqual(narrow.window + 1);
  expect(narrow.stored.left).toBe(before.left);
  expect(narrow.stored.right).toBe(before.right);
  expect(narrow.left).toBeLessThan(before.left);
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-region="left"]')
            .getBoundingClientRect().width,
      ),
    )
    .toBeGreaterThan(before.left - 2);
});
