import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const settled = (page) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false");
async function ready(page) {
  await expect(page.locator("#palette button").first()).toBeVisible();
  await settled(page);
}
async function panel(page, id) {
  const toggle = page.locator(`[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
async function colour(page, hex) {
  await page.locator("#pickerHex").fill(hex);
  await page.locator("#pickerHex").press("Tab");
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});
test("saving colours preserves variant previews, and an empty Saved colours palette cannot make variants", async ({
  page,
}) => {
  await page.locator("#palette button").first().click();
  await panel(page, "swatches");
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variants button")).toHaveCount(4);
  await expect(page.locator("#exportVariants")).toBeVisible();
  await page.locator("#saveCurrentColour").click();
  await expect(page.locator("#variants button")).toHaveCount(4);
  await page.locator("#paletteSet").selectOption("saved");
  await page.locator("#savedColours button").first().press("Delete");
  await expect(page.locator("#makeVariants")).toBeDisabled();
});
test("picker drags leave the canvas and panels steady, and Alt/F10 stay inside the picker", async ({
  page,
}) => {
  await page.locator("#palette button").first().click();
  await page.locator("#targetColour").click();
  const boxes = () =>
    page.evaluate(() =>
      ["#viewport", ".mapbar", ".statusbar", ".panel"].flatMap((selector) =>
        [...document.querySelectorAll(selector)].map((el) => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        }),
      ),
    );
  const before = await boxes(),
    square = await page.locator(".picker-square").boundingBox();
  await page.mouse.move(square.x + 2, square.y + 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(
      square.x + (square.width * i) / 31,
      square.y + (square.height * i) / 31,
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await boxes()).toEqual(before);
  }
  await page.mouse.up();
  await settled(page);
  await page.keyboard.press("F10");
  await expect(page.locator(".picker-square")).toBeFocused();
  await page.keyboard.press("Alt");
  await expect(page.locator(".picker-square")).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect
    .poll(async () => {
      const box = await page.locator("#colourPicker").boundingBox();
      return (
        box.x >= 0 &&
        box.x + box.width <= 360 &&
        box.y >= 0 &&
        box.y + box.height <= 800
      );
    })
    .toBe(true);
});
test("holding a saved colour offers touch actions without selecting it", async ({
  page,
}) => {
  await page.locator("#targetColour").click();
  await colour(page, "#112233");
  await page.locator("#pickerSave").click();
  await colour(page, "#445566");
  const slot = page.locator("#colourPicker .saved-slot").first();
  await slot.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
  });
  await expect(
    page.getByRole("menuitem", { name: "Remove colour", exact: true }),
  ).toBeVisible();
  await slot.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.locator("#targetHex")).toHaveValue("#445566");
  await page
    .getByRole("menuitem", { name: "Remove colour", exact: true })
    .click();
  await expect(slot).toBeDisabled();
});
test("picker edits by keyboard and RGB, saves 48 stable slots, and survives reload without images", async ({
  page,
}) => {
  await page.locator("#palette button").first().click();
  await page.locator("#targetColour").click();
  const pop = page.locator("#colourPicker");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".saved-slot")).toHaveCount(48);
  await colour(page, "#5865F2");
  await expect(page.locator("#targetHex")).toHaveValue("#5865F2");
  await pop.getByLabel("Red", { exact: true }).fill("36");
  await pop.getByLabel("Green", { exact: true }).fill("128");
  await pop.getByLabel("Blue", { exact: true }).fill("70");
  await pop.getByLabel("Blue", { exact: true }).press("Tab");
  await expect(page.locator("#targetHex")).toHaveValue("#248046");
  expect(
    await page
      .locator("#targetColour")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(36, 128, 70)");
  await page.locator("#pickerSave").click();
  await expect(page.locator("#pickerSave")).toBeDisabled();
  const square = pop.getByRole("slider", { name: "Saturation and brightness" });
  await square.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#targetHex")).not.toHaveValue("#248046");
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(page.locator("#targetColour")).toBeFocused();
  await expect(page.locator("#seeds .seed")).toHaveCount(1);
  await page.reload();
  await ready(page);
  await panel(page, "swatches");
  await expect(page.locator("#savedColours button")).toHaveCount(1);
  await page.locator("#savedColours button").click();
  await expect(page.locator("#targetHex")).toHaveValue("#248046");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("hexshift-colours")),
    ),
  ).toEqual({ v: 1, saved: ["#248046"], palettes: [] });
});
test("saved colours move by drag, keyboard and context menu, and remove persistently", async ({
  page,
}) => {
  await page.locator("#targetColour").click();
  for (const hex of ["#112233", "#445566", "#778899"]) {
    await colour(page, hex);
    await page.locator("#pickerSave").click();
  }
  const grid = page.locator("#colourPicker .saved-grid");
  await grid.locator("button").nth(0).dragTo(grid.locator("button").nth(2));
  await expect(grid.locator("button").nth(2)).toHaveAttribute(
    "aria-label",
    /#112233/,
  );
  await grid.locator("button").nth(2).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(grid.locator("button").nth(1)).toHaveAttribute(
    "aria-label",
    /#112233/,
  );
  await grid.locator("button").nth(1).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to start", exact: true })
    .click();
  await expect(grid.locator("button").nth(0)).toHaveAttribute(
    "aria-label",
    /#112233/,
  );
  await grid.locator("button").nth(0).press("Delete");
  await page.keyboard.press("Escape");
  await page.reload();
  await ready(page);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hexshift-colours")).saved,
    ),
  ).toEqual(["#445566", "#778899"]);
});
test("outline and background share saved colours and picker edits keep the existing undo behaviour", async ({
  page,
}) => {
  await panel(page, "outline");
  await page.locator("#outline").check();
  await page.locator("#outlineColour").click();
  await colour(page, "#123456");
  await page.locator("#pickerSave").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#outlineHex")).toHaveValue("#123456");
  await page.locator("#undo").click();
  await expect(page.locator("#outlineHex")).toHaveValue("#FFFFFF");
  await page.locator('#background input[value="custom"]').check();
  await page.locator("#backgroundColour").click();
  await page.locator("#colourPicker .saved-slot").first().click();
  await expect(page.locator(".canvas-space").first()).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#targetHex")).not.toHaveValue("#123456");
});
test("My palettes persist, .gpl imports can be kept, and .gpl exports retain colour labels", async ({
  page,
}) => {
  await panel(page, "swatches");
  await page.locator("#paletteInput").setInputFiles({
    name: "My colours.gpl",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "GIMP Palette\nName: Mine\n#\n18 52 86 Deep blue\n255 128 0 Orange\n",
    ),
  });
  await page.locator("#saveMyPalette").click();
  await page.locator("#paletteName").fill("My pair");
  await page.getByRole("button", { name: "Save palette", exact: true }).click();
  await expect(page.locator("#paletteSet option:checked")).toHaveText(
    "My pair",
  );
  await page.reload();
  await ready(page);
  await panel(page, "swatches");
  await page.locator("#paletteSet").selectOption({ label: "My pair" });
  await expect(page.locator("#presets button")).toHaveCount(2);
  const downloaded = page.waitForEvent("download");
  await page.locator("#savePalette").click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.gpl$/);
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(await file.path(), "utf8")).toContain("Deep blue");
  await page.locator("#removeMyPalette").click();
  await expect(
    page.locator('#paletteSet optgroup[label="My palettes"]'),
  ).toHaveCount(0);
});
test("a corrupt store is reported and ignored, and a full 48-colour store stays capped", async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem("hexshift-colours", "{broken"),
  );
  await page.reload();
  await ready(page);
  await expect(page.locator("#status")).toContainText(
    "could not be read and were ignored",
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "hexshift-colours",
      JSON.stringify({
        v: 1,
        saved: Array.from(
          { length: 48 },
          (_, i) => "#" + i.toString(16).padStart(6, "0"),
        ),
        palettes: [],
      }),
    ),
  );
  await page.reload();
  await ready(page);
  await page.locator("#targetColour").click();
  await expect(page.locator("#pickerSave")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Image", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Save colour to swatches", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText(
    "48 saved-colour slots are full",
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hexshift-colours")).saved.length,
    ),
  ).toBe(48);
});
test("the screen picker in the popover routes the Windows reply to outline, not target", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage(message) {
        if (message === "pick-colour")
          for (const fn of listeners)
            fn({ data: { type: "picked-colour", hex: "#AABBCC" } });
      },
      addEventListener(type, fn) {
        if (type === "message") listeners.push(fn);
      },
    };
  });
  await page.reload();
  await ready(page);
  await panel(page, "outline");
  await page.locator("#outlineColour").click();
  await page.locator("#pickerScreen").click();
  await expect(page.locator("#outlineHex")).toHaveValue("#AABBCC");
  await expect(page.locator("#pickerHex")).toHaveValue("#AABBCC");
  await expect(page.locator("#targetHex")).not.toHaveValue("#AABBCC");
});
test("picker and saved-colour actions pass axe in light and dark and fit on a phone", async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const modifier of ["day", "night"]) {
    await page.locator("#themeMenu summary").click();
    await page.locator(`#theme input[value="${modifier}"]`).check();
    await page.keyboard.press("Escape");
    await page.locator("#targetColour").click();
    await colour(page, "#5865F2");
    if (modifier === "day") await page.locator("#pickerSave").click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .locator("#colourPicker .saved-slot")
      .first()
      .click({ button: "right" });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#targetColour").click();
  const rect = await page.locator("#colourPicker").boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(360);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(800);
});
