// The workspace: layouts and panels, the menu bar, the outline in the viewer, the
// update check shown in the page, and the things that must hold still while you drag.
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

// The app is idle: nothing is waiting on a result.
const settled = (page, timeout = 15000) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false", {
    timeout,
  });
async function ready(page) {
  await expect(page.locator("#palette button").first()).toBeVisible();
  await settled(page);
}
async function pick(page) {
  await page.locator("#palette button").first().click();
  await settled(page);
}
// Opens a panel that may start collapsed (Swatches and Outline do on short windows).
async function openPanel(page, id) {
  const toggle = page.locator(`.panel[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

// ---- Nothing moves while you drag ----

// Records the boxes of everything matching `selectors`, once per frame, until stopped.
async function watch(page, selectors) {
  await page.evaluate((list) => {
    window.__boxes = [];
    window.__watching = true;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join(",");
    };
    const frame = () => {
      window.__boxes.push(
        list
          .map(
            (s) =>
              s + "=" + [...document.querySelectorAll(s)].map(box).join(" "),
          )
          .join(" | "),
      );
      if (window.__watching) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, selectors);
}
const unwatch = (page) =>
  page.evaluate(() => {
    window.__watching = false;
    return window.__boxes;
  });
// Drags across a slider from one fraction of its width to another, in 30 moves, one
// frame apart (so every move gets its own frame to show its effect).
async function drag(page, selector, from, to) {
  const box = await page.locator(selector).boundingBox(),
    y = box.y + box.height / 2,
    nextFrame = () =>
      page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(
      box.x + box.width * (from + ((to - from) * i) / 30),
      y,
    );
    await nextFrame();
  }
  await page.mouse.up();
}
// Every kind of slider: the selection's, the Adjust panel's, and the outline's.
for (const [name, selector, from, to] of [
  ["selection", "#hueTol", 0.8, 0.1],
  ["shade range", "#shadeTol", 0.1, 0.9],
  ["hue", "#dh", 0.5, 0.05],
  ["lightness", "#dl", 0.5, 0.95],
  ["outline width", "#outlineWidth", 0.05, 0.95],
])
  test(`dragging the ${name} slider moves nothing`, async ({ page }) => {
    await pick(page);
    await openPanel(page, "outline");
    await page.locator("#outline").check();
    await settled(page);
    // Fit view, so the canvas size is the fit's answer to the stage.
    await page.locator("#fit").click();
    await watch(page, [
      ".topbar",
      "#viewport",
      "#resultCanvas",
      ".mapbar",
      ".statusbar",
      ".panel",
      ".slider",
      "#targetResult",
      "#coverage",
      "#editState",
    ]);
    await drag(page, selector, from, to);
    await settled(page);
    const boxes = await unwatch(page);
    expect(boxes.length).toBeGreaterThanOrEqual(30);
    // Every frame of the drag, and the ones either side, is the same layout. (If the
    // machine is slow and Cancel appears mid-drag, that is covered too: it has a
    // place of its own, so it moves nothing.)
    const first = boxes[0],
      moved = boxes.find((b) => b !== first);
    expect(moved, "a frame whose layout differs: " + moved).toBeUndefined();
  });

// ---- Layouts ----

// The panels that must be collapsed at least, for each size.
for (const [width, height, preset, collapsed] of [
  [1920, 1080, "side", []],
  [1600, 900, "side", []],
  [1366, 768, "side", ["swatches"]],
  [1280, 720, "side", ["swatches"]],
])
  test(`nothing scrolls at ${width} × ${height}, and the sliders are in view`, async ({
    browser,
    baseURL,
  }) => {
    const page = await browser.newPage({
      viewport: { width, height },
      baseURL,
    });
    await page.goto("/");
    await ready(page);
    await expect(page.locator("#main")).toHaveAttribute("data-preset", preset);
    const state = await page.evaluate(() => ({
      stacks: [...document.querySelectorAll(".stack")].map((s) => [
        s.scrollHeight,
        s.clientHeight,
      ]),
      bodies: [...document.querySelectorAll(".panel-body")].map((b) => [
        b.scrollHeight,
        b.clientHeight,
      ]),
      collapsed: [...document.querySelectorAll(".panel")]
        .filter((p) => p.dataset.collapsed === "true")
        .map((p) => p.dataset.panel),
      page: [document.documentElement.scrollWidth, innerWidth],
    }));
    for (const [scroll, client] of [...state.stacks, ...state.bodies])
      expect(scroll).toBeLessThanOrEqual(client + 1);
    expect(state.page[0]).toBeLessThanOrEqual(state.page[1]);
    // Panels that cannot all fit start collapsed, Swatches first, then Outline (a
    // click opens them). How many depends on the window's height, and a little on
    // the fonts, so this checks the order and a floor, not an exact set.
    expect(["", "swatches", "swatches,outline"]).toContain(
      state.collapsed.join(","),
    );
    expect(state.collapsed.length).toBeGreaterThanOrEqual(collapsed.length);
    // The sliders that sat below the fold are right there.
    for (const id of ["dh", "ds", "dl", "hueTol", "feather"])
      await expect(page.locator("#" + id)).toBeInViewport();
    await expect(page.locator("#export")).toBeInViewport();
    await page.close();
  });

test("columns resize with their handles and the arrow keys", async ({
  page,
}) => {
  const width = (selector) =>
    page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
  const right = await width('[data-region="right"]'),
    handle = await page.locator("#splitRight").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 97, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  expect(await width('[data-region="right"]')).toBeGreaterThan(right + 80);
  // Arrow keys: 16 px a press, 64 with Shift, never past the limits.
  const left = await width('[data-region="left"]');
  await page.locator("#splitLeft").focus();
  await page.keyboard.press("ArrowRight");
  expect(await width('[data-region="left"]')).toBe(left + 16);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await width('[data-region="left"]')).toBe(left - 48);
  for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowLeft");
  expect(await width('[data-region="left"]')).toBe(200);
  await expect(page.locator("#splitLeft")).toHaveAttribute(
    "aria-valuenow",
    "200",
  );
  // The canvas followed.
  const canvas = await page.locator("#viewport").boundingBox();
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(
    (await page.locator('[data-region="right"]').boundingBox()).x + 1,
  );
});

test("panels collapse by their headers, and the layout follows the window", async ({
  page,
}) => {
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "side");
  const exportToggle = page.locator("#exportTitle");
  await expect(exportToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#size")).toBeVisible();
  await exportToggle.click();
  await expect(exportToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#size")).toBeHidden();
  // The Reset original button stays in the header of a collapsed panel.
  await expect(page.locator("#reset")).toBeVisible();
  await exportToggle.click();
  await expect(page.locator("#size")).toBeVisible();

  // One right column in a mid-width landscape window: Selection joins it.
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "column");
  const column = (id) =>
    page.locator(`.panel[data-panel="${id}"]`).boundingBox();
  const [selection, colour, swatches, outline, exported] = await Promise.all(
    ["selection", "colour", "swatches", "outline", "export"].map(column),
  );
  expect(selection.x).toBe(colour.x);
  expect(selection.y).toBeLessThan(colour.y);
  expect(outline.y).toBeLessThan(exported.y);
  expect(swatches.y).toBeLessThan(outline.y);
  await expect(page.locator('[data-region="left"]')).toBeHidden();

  // Portrait: a dock under the canvas, three columns, the dock's handle shown.
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "dock");
  await expect(page.locator("#dockHandle")).toBeVisible();
  const dock = await page.locator("#dock").boundingBox(),
    view = await page.locator("#viewport").boundingBox();
  expect(view.y + view.height).toBeLessThanOrEqual(dock.y + 1);
  const [s, c, e] = await Promise.all(
    ["selection", "colour", "export"].map(column),
  );
  expect(s.x).toBeLessThan(c.x);
  expect(c.x).toBeLessThan(e.x);
  await expect(page.locator("#splitRight")).toBeHidden();
  // The dock's height follows its handle's arrow keys.
  const before = (await page.locator("#dock").boundingBox()).height;
  await page.locator("#dockHandle").focus();
  await page.keyboard.press("ArrowUp");
  expect((await page.locator("#dock").boundingBox()).height).toBe(before + 16);

  // A phone: one group of panels at a time from the tab bar; nothing collapses
  // there, even a panel that was collapsed in the other layouts.
  await exportToggle.click();
  await expect(page.locator("#exportBody")).toBeHidden();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "phone");
  await expect(page.locator(".dock-tabs")).toBeVisible();
  await expect(page.locator(".dock-tabs button")).toHaveText([
    "Selection",
    "Colour",
    "Swatches",
    "Export",
  ]);
  await expect(page.locator("#targetHex")).toBeVisible();
  await expect(page.locator("#dh")).toBeVisible(); // Colour tab: Colour and Adjust
  await expect(page.locator("#size")).toBeHidden();
  await page.locator('.dock-tabs [data-tab="export"]').click();
  await expect(page.locator("#size")).toBeVisible();
  await expect(page.locator("#outlineWidth")).toBeVisible(); // Export tab: Export and Outline
  await page.locator('.dock-tabs [data-tab="swatches"]').click();
  await expect(page.locator("#presets button").first()).toBeVisible();
  await expect(page.locator("#size")).toBeHidden();
  // Back at full size, the panels are where they were, and Export is still collapsed.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "side");
  await expect(page.locator("#size")).toBeHidden();
  await exportToggle.click();
  await expect(page.locator("#size")).toBeVisible();
});

async function openView(page) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "View", exact: true })
    .click();
}
async function chooseLayout(page, name) {
  await openView(page);
  await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

test("dragging a panel to another column shows where it will land", async ({
  page,
}) => {
  const grip = page.locator('[data-panel="selection"] .panel-grip'),
    from = await grip.boundingBox(),
    colour = await page.locator('[data-panel="colour"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(colour.x + 30, colour.y + 12, { steps: 12 });
  await expect(page.locator("#dropIndicator")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("#layoutLive")).toHaveText(
    "Selection moved to the right column.",
  );
  await expect(
    page.locator('[data-region="right"] [data-panel="selection"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-region="left"]')).toBeHidden();
});

test("keyboard moves persist across a reload and reset clears them", async ({
  page,
}) => {
  await page.locator('[data-panel="adjust"] .panel-menu').click();
  await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
  await expect(page.locator("#layoutLive")).toHaveText("Adjust moved up.");
  const adjust = await page.locator('[data-panel="adjust"]').boundingBox(),
    colour = await page.locator('[data-panel="colour"]').boundingBox();
  expect(adjust.y).toBeLessThan(colour.y);

  await page.locator('[data-panel="outline"] .panel-menu').click();
  await page
    .getByRole("menuitem", { name: "Move to left column", exact: true })
    .click();
  await expect(page.locator("#layoutLive")).toHaveText(
    "Outline moved to the left column.",
  );
  await page.reload();
  await ready(page);
  await expect(
    page.locator('[data-region="left"] [data-panel="outline"]'),
  ).toHaveCount(1);
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "custom");

  await openView(page);
  await page.getByRole("menuitem", { name: "Panels", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Swatches", exact: true })
    .click();
  await expect(page.locator("#layoutLive")).toHaveText("Swatches hidden.");
  await expect(page.locator('[data-panel="swatches"]')).toBeHidden();

  await openView(page);
  await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reset layout", exact: true }).click();
  await expect(page.locator("#layoutLive")).toHaveText("Layout reset.");
  await expect(
    page.locator('[data-region="left"] [data-panel="selection"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-region="left"] [data-panel="outline"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-panel="swatches"]')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("hexshift-layout")),
  ).toBeNull();
});

test("a locked layout ignores moves, and reset still clears it", async ({
  page,
}) => {
  await openView(page);
  await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Lock layout", exact: true })
    .click();
  await expect(page.locator("#layoutLive")).toHaveText("Layout locked.");
  await page.locator('[data-panel="outline"] .panel-menu').click();
  const move = page.getByRole("menuitem", {
    name: "Move to left column",
    exact: true,
  });
  await expect(move).toHaveAttribute("aria-disabled", "true");
  await move.click({ force: true });
  await expect(
    page.locator('[data-region="right"] [data-panel="outline"]'),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await openView(page);
  await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reset layout", exact: true }).click();
  await expect(page.locator("#layoutLive")).toHaveText("Layout reset.");
  await openView(page);
  await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Lock layout", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
});

test("an unreadable layout is ignored and left untouched", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("hexshift-layout", "{"));
  await page.reload();
  await ready(page);
  await expect(page.locator("#status")).toContainText(
    "Saved layout could not be read and was ignored.",
  );
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "side");
  expect(
    await page.evaluate(() => localStorage.getItem("hexshift-layout")),
  ).toBe("{");
});

test("phone tabs move from the keyboard and the order is kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "phone");
  await page.locator('.dock-tabs [data-tab="swatches"]').click();
  await page.locator('[data-panel="swatches"] .panel-menu').click();
  await page
    .getByRole("menuitem", { name: "Move tab later", exact: true })
    .click();
  await expect(page.locator("#layoutLive")).toHaveText(
    "Swatches tab moved later.",
  );
  await expect(page.locator(".dock-tabs button")).toHaveText([
    "Selection",
    "Colour",
    "Export",
    "Swatches",
  ]);
  await page.reload();
  await settled(page);
  await expect(page.locator(".dock-tabs button")).toHaveText([
    "Selection",
    "Colour",
    "Export",
    "Swatches",
  ]);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hexshift-layout")).mode,
    ),
  ).toBe("auto");
});

test("each layout fits without scrolling at the desktop sizes and on a phone", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fits = () =>
    page.evaluate(() => {
      const gone = (el) =>
        !!el.closest("[hidden]") || getComputedStyle(el).display === "none";
      const stacks = [...document.querySelectorAll(".stack")].filter(
        (el) => !gone(el),
      );
      const bodies = [...document.querySelectorAll(".panel-body")].filter(
        (el) => !gone(el),
      );
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        stacks.every((el) => el.scrollHeight <= el.clientHeight + 1) &&
        bodies.every((el) => el.scrollHeight <= el.clientHeight + 1)
      );
    });
  for (const [name, preset] of [
    ["Side columns", "side"],
    ["One right column", "column"],
    ["Bottom dock", "dock"],
  ])
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await chooseLayout(page, name);
      await expect(page.locator("#main")).toHaveAttribute(
        "data-preset",
        preset,
      );
      await expect
        .poll(fits, { message: `${name} at ${width}×${height}` })
        .toBe(true);
    }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#main")).toHaveAttribute("data-preset", "phone");
  await expect.poll(fits, { message: "phone at 360" }).toBe(true);
});

test("the tools sit on the canvas, with their keys, and a brush shows its size", async ({
  page,
}) => {
  const pressed = (id) =>
    expect(page.locator("#" + id)).toHaveAttribute("aria-pressed", "true");
  await pressed("replaceSample");
  await expect(page.locator("#brushSizeGroup")).toBeHidden();
  await page.keyboard.press("a");
  await pressed("addSample");
  await page.keyboard.press("b");
  await pressed("brushAdd");
  await expect(page.locator("#brushSizeGroup")).toBeVisible();
  await page.locator("#brushSize").fill("40");
  await expect(page.locator("#brushSizeValue")).toHaveText("40 px");
  await page.keyboard.press("e");
  await pressed("brushSubtract");
  await page.keyboard.press("h");
  await pressed("pan");
  await expect(page.locator("#brushSizeGroup")).toBeHidden();
  // Leaving pan goes back to picking, in the mode it was in (Add sample here).
  await page.keyboard.press("h");
  await pressed("addSample");
  await page.keyboard.press("i");
  await pressed("replaceSample");
  // Typing in a field never switches tools.
  await page.locator("#targetHex").focus();
  await page.keyboard.press("b");
  await pressed("replaceSample");
  await page.locator("#targetHex").blur();
  // One shortcut per action: 1 is 100%, F fits.
  await page.keyboard.press("1");
  await expect(page.locator("#zoomReadout")).toHaveText("100%");
  await page.keyboard.press("f");
  await expect(page.locator("#zoomReadout")).not.toHaveText("100%");
  // Ctrl+E exports and Ctrl+Z undoes.
  await pick(page);
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+e");
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#editState")).toHaveText("No pending edit");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await settled(page);
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  // Ctrl+Enter applies.
  await page.keyboard.press("ControlOrMeta+Enter");
  await settled(page);
  await expect(page.locator("#editState")).toHaveText("No pending edit");
});

// ---- The menu bar ----

const top = (page, name) =>
  page.getByRole("menuitem", { name, exact: true }).first();
const menu = (page, name) => page.getByRole("menu", { name, exact: true });
const item = (page, name) => page.getByRole("menuitem", { name });

test("the menu bar opens with the mouse, switches by hover and closes with Escape", async ({
  page,
}) => {
  await expect(page.getByRole("menubar")).toBeVisible();
  await expect(page.locator("#menubar .menu-top")).toHaveCount(5);
  await expect(page.locator("#menubar .menu-top")).toHaveText([
    "File",
    "Edit",
    "View",
    "Image",
    "Help",
  ]);
  await top(page, "File").click();
  await expect(menu(page, "File")).toBeVisible();
  await expect(top(page, "File")).toHaveAttribute("aria-expanded", "true");
  // Shortcuts sit at the right of their items.
  await expect(item(page, "Open…")).toContainText("Ctrl+O");
  await expect(item(page, "Export…")).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+E",
  );
  // Nothing about Windows in a browser.
  await expect(item(page, "Exit")).toHaveCount(0);
  // Once a menu is open, pointing at another switches to it.
  await top(page, "Edit").hover();
  await expect(menu(page, "Edit")).toBeVisible();
  await expect(menu(page, "File")).toHaveCount(0);
  await expect(top(page, "File")).toHaveAttribute("aria-expanded", "false");
  // Items that cannot be used are greyed but still there.
  await expect(item(page, "Undo")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "Apply, then build on it")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(item(page, "Reset original")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(menu(page, "Edit")).toHaveCount(0);
  await expect(top(page, "Edit")).toBeFocused();
  // Clicking elsewhere closes a menu too.
  await top(page, "View").click();
  await expect(menu(page, "View")).toBeVisible();
  // The View menu is tall enough to cover the left edge of the canvas, so the
  // click that means "elsewhere" sits further across the picture.
  await page.locator("#viewport").click({ position: { x: 320, y: 160 } });
  await expect(menu(page, "View")).toHaveCount(0);
});

test("the menu bar works from the keyboard: Alt, F10, letters, arrows and Enter", async ({
  page,
}) => {
  // Using the bar from the keyboard (which underlines its mnemonic letters) must not
  // change its layout: it stays one row in a bar of the same height.
  const bar = () =>
    page.evaluate(() => ({
      height: document.querySelector(".topbar").offsetHeight,
      rows: new Set(
        [...document.querySelectorAll("#menubar .menu-top")].map(
          (b) => b.offsetTop,
        ),
      ).size,
    }));
  const resting = await bar();
  expect(resting.rows).toBe(1);
  // Alt and a letter opens a menu with its first item focused.
  await page.keyboard.press("Alt+v");
  expect(await bar()).toEqual(resting);
  await expect(menu(page, "View")).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: "Result" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: "Side by side" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#viewport")).toHaveAttribute("data-view", "wipe");
  await expect(menu(page, "View")).toHaveCount(0);
  // The radio shows what is chosen.
  await page.keyboard.press("Alt+v");
  await expect(
    page.getByRole("menuitemradio", { name: "Wipe" }),
  ).toHaveAttribute("aria-checked", "true");
  // Left and right walk the bar; the menu follows.
  await page.keyboard.press("ArrowRight");
  await expect(menu(page, "Image")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(menu(page, "Help")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(menu(page, "File")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(menu(page, "Help")).toBeVisible();
  // Up from the first item wraps to the last.
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "About Hex Shift")).toBeFocused();
  // A letter jumps to the item that starts with it.
  await page.keyboard.press("r");
  await expect(item(page, "Release notes")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page, "Help")).toHaveCount(0);
  // F10 moves to the bar; Escape gives the focus back.
  await page.locator("#targetHex").focus();
  await page.keyboard.press("F10");
  await expect(top(page, "File")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page, "File")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#targetHex")).toBeFocused();
  // A menu's keys are its own: a letter inside one never switches tools.
  await page.keyboard.press("Alt+e");
  await page.keyboard.press("b");
  await page.keyboard.press("Escape");
  await expect(page.locator("#replaceSample")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("menu items run the same actions as the controls", async ({ page }) => {
  // Submenus: Show selection, Background, Theme.
  await top(page, "View").click();
  await item(page, "Show selection").hover();
  await expect(menu(page, "Show selection")).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Only" }).click();
  await expect(page.locator('#overlay input[value="only"]')).toBeChecked();
  await top(page, "View").click();
  await item(page, "Background").hover();
  await page.getByRole("menuitemradio", { name: "White" }).click();
  await expect(page.locator('#background input[value="white"]')).toBeChecked();
  await top(page, "View").click();
  await item(page, "Theme").hover();
  await page.getByRole("menuitemradio", { name: "Nord" }).click();
  await expect(page.locator('#uiTheme input[value="nord"]')).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /dark|light/,
  );
  // Compare with is for the two-up views only.
  await page.locator('#view input[value="result"]').check();
  await top(page, "View").click();
  await expect(item(page, "Compare with")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  // Edit > Undo follows the history; it is the Undo button.
  await pick(page);
  await top(page, "Edit").click();
  await expect(item(page, "Undo")).not.toHaveAttribute("aria-disabled", "true");
  await item(page, "Undo").click();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeEnabled();
  await top(page, "Edit").click();
  await item(page, "Redo").click();
  await settled(page);
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  // File > Export… saves, like the button.
  await top(page, "File").click();
  const download = page.waitForEvent("download");
  await item(page, "Export…").click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  // Image > Outline is the Outline panel's checkbox.
  await top(page, "Image").click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Outline" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemcheckbox", { name: "Outline" }).click();
  await expect(page.locator("#outline")).toBeChecked();
  await top(page, "Image").click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Outline" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  // Help > Shortcuts and F1 show the list; Escape puts it away.
  await top(page, "Help").click();
  await item(page, "Shortcuts").click();
  await expect(page.locator("#shortcuts")).toHaveJSProperty("open", true);
  await expect(page.locator(".keys")).toContainText("Ctrl Shift C");
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcuts")).toHaveJSProperty("open", false);
  await page.locator("#viewport").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("F1");
  await expect(page.locator("#shortcuts")).toHaveJSProperty("open", true);
});

test("Help shows the version, the licence notices and the release notes", async ({
  page,
}) => {
  await top(page, "Help").click();
  await item(page, "About Hex Shift").click();
  await expect(page.locator("#aboutDialog")).toBeVisible();
  await expect(page.locator("#aboutVersion")).toHaveText(
    /^Version \d+\.\d+\.\d+$/,
  );
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  await expect(page.locator("#aboutVersion")).toHaveText(
    "Version " + pkg.version,
  );
  await page.locator("#aboutDialog summary").click();
  await expect(page.locator("#aboutNotices")).toContainText("MIT");
  await page.keyboard.press("Escape");
  await expect(page.locator("#aboutDialog")).toBeHidden();
  await top(page, "Help").click();
  await item(page, "Release notes").click();
  await expect(page.locator("#notesDialog")).toBeVisible();
  await expect(page.locator("#notesBody p").first()).toBeVisible();
  await expect(page.locator("#notesBody strong").first()).toBeVisible();
  // The notes are text: nothing in them became markup.
  expect(await page.locator("#notesBody script, #notesBody img").count()).toBe(
    0,
  );
  await page.getByRole("button", { name: "Close" }).last().click();
  await expect(page.locator("#notesDialog")).toBeHidden();
});

test("on a phone the menu bar folds into one Menu button", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#menubar .menu-top").first()).toBeHidden();
  const fold = page.locator("#menubar .menu-fold");
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(
    page.getByRole("menu", { name: "Application menu" }),
  ).toBeVisible();
  for (const name of ["File", "Edit", "View", "Image", "Help"])
    await expect(item(page, name)).toBeVisible();
  await item(page, "File").click();
  await expect(menu(page, "File")).toBeVisible();
  await item(page, "Open…").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

// ---- The outline in the viewer ----

const layerGreens = (page) =>
  page.locator("#outlineCanvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] === 0 && d[i + 1] === 255 && d[i + 2] === 0 && d[i + 3] === 255)
        n++;
    return n;
  });

test("the outline is drawn behind the artwork, follows colour and undo, and matches the export", async ({
  page,
}) => {
  await pick(page);
  await openPanel(page, "outline");
  await expect(page.locator("#outlineCanvas")).toBeHidden();
  await page.locator("#outline").check();
  await page.locator("#outlineHex").fill("#00FF00");
  await page.locator("#outlineWidth").fill("10");
  await expect(page.locator("#outlineCanvas")).toBeVisible();
  await expect.poll(() => layerGreens(page)).toBeGreaterThan(200);
  // The layer sits behind the result canvas, and takes no clicks.
  expect(
    await page.evaluate(() => {
      const space = document.querySelector("#resultCanvas").parentElement,
        order = [...space.children].map((c) => c.id);
      return [
        order.indexOf("outlineCanvas") < order.indexOf("resultCanvas"),
        getComputedStyle(document.querySelector("#outlineCanvas"))
          .pointerEvents,
      ];
    }),
  ).toEqual([true, "none"]);
  // It is larger than the image only where the stroke grew past its edges, and
  // lined up with it: the layer's pixels beyond the artwork are the outline colour.
  const aligned = await page.evaluate(() => {
    const layer = document.querySelector("#outlineCanvas"),
      art = document.querySelector("#resultCanvas"),
      a = layer.getBoundingClientRect(),
      b = art.getBoundingClientRect();
    return [
      a.left <= b.left + 1,
      a.top <= b.top + 1,
      a.right >= b.right - 1,
      a.bottom >= b.bottom - 1,
    ];
  });
  expect(aligned).toEqual([true, true, true, true]);
  // Recolouring only recolours the stroke.
  await page.locator("#outlineHex").fill("#FF00FF");
  await expect.poll(() => layerGreens(page)).toBe(0);
  await expect(page.locator("#outlineWidthValue")).toHaveText("10%");
  // Undo takes the outline back out, one change at a time: width, colour, then on.
  await page.locator("#outlineWidth").fill("12");
  await page.locator("#undo").click();
  await expect(page.locator("#outlineWidth")).toHaveValue("10");
  for (let i = 0; i < 8 && (await page.locator("#outline").isChecked()); i++)
    await page.locator("#undo").click();
  await expect(page.locator("#outline")).not.toBeChecked();
  await expect(page.locator("#outlineCanvas")).toBeHidden();
  await page.locator("#redo").click();
  await expect(page.locator("#outline")).toBeChecked();
  await expect(page.locator("#outlineCanvas")).toBeVisible();
  // Redo puts it all back; exports carry the same outline the viewer shows.
  for (let i = 0; i < 8 && (await page.locator("#redo").isEnabled()); i++)
    await page.locator("#redo").click();
  await expect(page.locator("#outlineHex")).toHaveValue("#FF00FF");
  await expect(page.locator("#outlineWidth")).toHaveValue("12");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const { data } = await sharp(await readFile(await (await download).path()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let magenta = 0;
  for (let i = 0; i < data.length; i += 4)
    if (
      data[i] === 255 &&
      data[i + 1] === 0 &&
      data[i + 2] === 255 &&
      data[i + 3] === 255
    )
      magenta++;
  expect(magenta).toBeGreaterThan(200);
});

test("variant tiles show the outline, and changing it marks them out of date", async ({
  page,
}) => {
  const greens = () =>
    page
      .locator("#variants canvas")
      .first()
      .evaluate((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          if (
            d[i] === 0 &&
            d[i + 1] === 255 &&
            d[i + 2] === 0 &&
            d[i + 3] > 200
          )
            n++;
        return n;
      });
  await pick(page);
  await openPanel(page, "swatches");
  // Without an outline the tiles have none.
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variants .variant")).toHaveCount(4);
  await expect(page.locator("#exportVariants")).toBeVisible();
  expect(await greens()).toBe(0);
  // Turning one on marks them out of date, and making them again draws it.
  await openPanel(page, "outline");
  await page.locator("#outline").check();
  await page.locator("#outlineHex").fill("#00FF00");
  await page.locator("#outlineWidth").fill("10");
  await expect(page.locator("#variantsNote")).toBeVisible();
  await expect(page.locator("#variants")).toHaveClass(/stale/);
  await page.locator("#makeVariants").click();
  await expect(page.locator("#variantsNote")).toBeHidden();
  await expect.poll(greens).toBeGreaterThan(20);
  // A different width is a different tile again.
  await page.locator("#outlineWidth").fill("5");
  await expect(page.locator("#variants")).toHaveClass(/stale/);
});

test("the outline shows in the wipe view only on the result side, and not in the selection-only view", async ({
  page,
}) => {
  await pick(page);
  await openPanel(page, "outline");
  await page.locator("#outline").check();
  await expect(page.locator("#outlineCanvas")).toBeVisible();
  await expect(page.locator("#outlineCanvas")).toHaveCSS("clip-path", "none");
  await page.locator('#view input[value="wipe"]').check();
  await page.locator("#wipe").fill("30");
  const clip = await page
    .locator("#outlineCanvas")
    .evaluate((c) => c.style.clipPath);
  expect(clip).toMatch(/^inset\(0(px)? 0(px)? 0(px)? [\d.]+%\)$/);
  await page.locator('#overlay input[value="only"]').check();
  await expect(page.locator("#outlineCanvas")).toHaveCSS(
    "visibility",
    "hidden",
  );
});

test("recipes carry the outline, and ones without it still open", async ({
  page,
}) => {
  await pick(page);
  await page.locator("#targetHex").fill("#5865F2");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
  await page.locator("#recipePanel summary").click();
  const save = async () => {
    const download = page.waitForEvent("download");
    await page.locator("#saveRecipe").click();
    return JSON.parse(await readFile(await (await download).path(), "utf8"));
  };
  const plain = await save();
  expect(plain.version).toBe(1);
  expect("outline" in plain).toBe(false);
  await openPanel(page, "outline");
  await page.locator("#outline").check();
  await page.locator("#outlineHex").fill("#00FF00");
  await page.locator("#outlineWidth").fill("9");
  const withOutline = await save();
  expect(withOutline.version).toBe(2);
  expect(withOutline.outline).toEqual({ widthPct: 9, colour: "#00FF00" });
  // Applying it to a fresh image turns the outline on with those settings.
  await page.reload();
  await ready(page);
  await page.locator("#recipePanel summary").click();
  await openPanel(page, "outline");
  await expect(page.locator("#outline")).not.toBeChecked();
  await page.locator("#recipeInput").setInputFiles({
    name: "with-outline.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(withOutline)),
  });
  await settled(page);
  await expect(page.locator("#outline")).toBeChecked();
  await expect(page.locator("#outlineHex")).toHaveValue("#00FF00");
  await expect(page.locator("#outlineWidth")).toHaveValue("9");
  await expect(page.locator("#outlineCanvas")).toBeVisible();
  await page.locator("#undo").click();
  await expect(page.locator("#outline")).not.toBeChecked();
  // A recipe from before outlines applies colours and leaves the outline alone.
  await page.locator("#outline").check();
  await page.locator("#recipeInput").setInputFiles({
    name: "plain.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(plain)),
  });
  await settled(page);
  await expect(page.locator("#status")).toContainText("Applied plain.json");
  await expect(page.locator("#outline")).toBeChecked();
});

test("outline settings carry to the next image, and Reset original keeps them", async ({
  page,
}) => {
  await openPanel(page, "outline");
  await page.locator("#outline").check();
  await page.locator("#outlineWidth").fill("7");
  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#FF0000" },
  })
    .png()
    .toBuffer();
  await page.locator("#fileInput").setInputFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator("#fileDims")).toContainText("32 × 32");
  await settled(page);
  await expect(page.locator("#outline")).toBeChecked();
  await expect(page.locator("#outlineWidth")).toHaveValue("7");
  await pick(page);
  await page.locator("#reset").click();
  await settled(page);
  await expect(page.locator("#outline")).toBeChecked();
  await expect(page.locator("#outlineWidth")).toHaveValue("7");
});

// With the outline off, what comes out is what 3.1.1 produced. These are SHA-256
// hashes of the decoded pixels of the built-in heart's exports, taken from the
// shipped 3.1.1 page. (Pixels, not file bytes: a browser's own compressor decides
// the bytes. Chromium only: other engines may differ in the last digit of a maths
// function, which this project's other engine-sensitive checks also leave to one.)
test("exports with the outline off are what 3.1.1 produced", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Pinned pixel hashes come from Chromium.",
  );
  const exportPixels = async () => {
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const pixels = await sharp(await readFile(await (await download).path()))
      .ensureAlpha()
      .raw()
      .toBuffer();
    return createHash("sha256").update(pixels).digest("hex");
  };
  await pick(page);
  await page.locator("#targetHex").fill("#5865F2");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
  expect(await exportPixels()).toBe(
    "a3b7e94b50519e9f1b279985ff3b3242b0693e0222dde1dba8443141f8f0cb1c",
  );
  await page.locator('#mode input[value="flat"]').check();
  await page.locator("#targetHex").fill("#12AB34");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
  expect(await exportPixels()).toBe(
    "7849eceeab093dacadc81eb0ccaecfd091f515c527eb7b78c04225a53b6a25c4",
  );
  await page.locator('#mode input[value="transparent"]').check();
  await settled(page);
  expect(await exportPixels()).toBe(
    "e0e4a73c275b5615f552eb78a108d6ab67f9ec874cfb5516b66deb8a56781bdd",
  );
});

// ---- Text that runs wide ----

// Linux's fonts are wider than Segoe UI, and a person may choose a bigger font or a
// zoom. Looser letters stand in for any of them, whatever fonts this machine has:
// nothing may spill sideways, at any window size or at 200 percent. (The page's
// policy only allows its own stylesheet, so this rewrites the page in a context that
// bypasses it.)
test("nothing spills sideways when the text runs wide, at any window size or at 200 percent", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    bypassCSP: true,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "</head>",
          "<style>*{letter-spacing:0.08em !important}</style></head>",
        ),
      });
    },
  );
  await page.goto(baseURL + "/");
  await ready(page);
  await pick(page);
  const overflow = () =>
    page.evaluate(() => ({
      page: document.documentElement.scrollWidth - innerWidth,
      // A column with a sideways scroll bar would also lose height to it.
      columns: [...document.querySelectorAll(".stack")].filter(
        (s) => s.scrollWidth > s.clientWidth + 1,
      ).length,
    }));
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [1100, 700],
    [900, 700],
    [800, 1000],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    // Resizing re-places the panels, so wait for the layout to settle: the page
    // and the columns must both come right, together.
    await expect
      .poll(
        async () => {
          const now = await overflow();
          return now.page <= 0 && now.columns === 0;
        },
        { message: `at ${width} × ${height}` },
      )
      .toBe(true);
  }
  // 200 percent, as the accessibility test asks for it.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => (document.body.style.zoom = "2"));
  await expect
    .poll(async () => (await overflow()).page, { message: "at 200 percent" })
    .toBeLessThanOrEqual(0);
  await context.close();
});

// ---- Cancel only shows when the wait is long ----

test("Cancel appears only after a long wait, in its own place", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  // Holds every edit back for a second, so the wait is long on purpose.
  await context.addInitScript(() => {
    const Real = window.Worker;
    window.Worker = class extends Real {
      postMessage(message, transfer) {
        if (message?.type === "edit")
          setTimeout(() => super.postMessage(message, transfer), 1000);
        else super.postMessage(message, transfer);
      }
    };
  });
  const page = await context.newPage();
  await page.goto(baseURL);
  await ready(page);
  const place = () => page.locator("#cancel").boundingBox();
  const resting = await place();
  await page.locator("#palette button").first().click();
  await expect(page.locator(".app")).toHaveAttribute("data-busy", "true");
  await page.waitForTimeout(150);
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#cancel")).toBeVisible({ timeout: 800 });
  // It appeared where it always is: nothing around it moved.
  expect(await place()).toEqual(resting);
  await settled(page);
  await expect(page.locator("#cancel")).toBeHidden();
  await context.close();
});

// ---- The Windows app's update check, shown in the page ----

const mockHost = () => {
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
  window.close = () => {
    window.__closed = true;
  };
};
const state = (extra) => ({
  type: "update-state",
  phase: "idle",
  version: null,
  checkedAt: null,
  auto: true,
  enabled: true,
  manual: false,
  ...extra,
});

test("the update check shows in the status bar and the Help menu", async ({
  page,
}) => {
  await page.addInitScript(mockHost);
  await page.reload();
  await ready(page);
  const sent = () => page.evaluate(() => window.chrome.webview.sent);
  const reply = (data) =>
    page.evaluate((d) => window.chrome.webview.reply(d), data);
  expect(await sent()).toEqual(["update-state"]);

  await reply(state({ phase: "checking" }));
  await expect(page.locator("#status")).toHaveText("Checking for updates…");
  await reply(state({ phase: "current", version: "3.2.0" }));
  await expect(page.locator("#status")).toHaveText(
    "Hex Shift 3.2.0 is up to date",
  );
  // It fades away on its own.
  await expect(page.locator("#status")).toHaveText("", { timeout: 9000 });
  await reply(state({ phase: "failed" }));
  await expect(page.locator("#status")).toHaveText(
    "Couldn't check for updates",
  );
  await reply(
    state({ phase: "failed", manual: true, detail: "No connection." }),
  );
  await expect(page.locator("#status")).toHaveText(
    "Couldn't check for updates: No connection.",
  );
  await reply(state({ phase: "available", version: "3.2.1" }));
  await expect(page.locator("#status")).toContainText(
    "Hex Shift 3.2.1 is available",
  );
  // A failed download is the app's own bar's business; the page says nothing.
  await page.evaluate(
    () => (document.querySelector("#status").textContent = "kept"),
  );
  await reply(state({ phase: "failed", version: "3.2.1", detail: "x" }));
  await reply(state({ phase: "downloading", version: "3.2.1" }));
  await expect(page.locator("#status")).toHaveText("kept");
  // Messages that are not well formed are ignored.
  await reply(state({ phase: "explode" }));
  await reply({ type: "other", phase: "current" });
  await reply("update-state");
  await reply(null);
  await reply(state({ phase: "current", version: "<img src=x onerror=1>" }));
  await expect(page.locator("#status")).toHaveText("Hex Shift is up to date");
  expect(await page.locator("#status img").count()).toBe(0);

  // Help: check now, and the automatic checks' switch.
  await top(page, "Help").click();
  await item(page, "Check for updates…").click();
  expect((await sent()).at(-1)).toBe("check-updates");
  await top(page, "Help").click();
  const auto = page.getByRole("menuitemcheckbox", {
    name: "Check for updates automatically",
  });
  await expect(auto).toHaveAttribute("aria-checked", "true");
  await auto.click();
  expect((await sent()).at(-1)).toBe("auto-updates-off");
  await reply(state({ phase: "current", version: "3.2.0", auto: false }));
  await top(page, "Help").click();
  await expect(auto).toHaveAttribute("aria-checked", "false");
  await auto.click();
  expect((await sent()).at(-1)).toBe("auto-updates-on");
});

test("in the Windows app File > Exit asks before leaving unsaved work", async ({
  page,
}) => {
  await page.addInitScript(mockHost);
  await page.reload();
  await ready(page);
  const closed = () => page.evaluate(() => !!window.__closed);
  // Nothing to lose: it closes.
  await top(page, "File").click();
  await item(page, "Exit").click();
  await expect.poll(closed).toBe(true);
  await page.evaluate(() => (window.__closed = false));
  // With an edit: it asks first, and Keep editing stays.
  await pick(page);
  await top(page, "File").click();
  await item(page, "Exit").click();
  await expect(page.locator("#replaceDialog")).toBeVisible();
  await expect(page.locator("#replaceTitle")).toHaveText("Quit Hex Shift?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await closed()).toBe(false);
  await top(page, "File").click();
  await item(page, "Exit").click();
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await expect.poll(closed).toBe(true);
});
