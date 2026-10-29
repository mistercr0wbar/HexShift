import { test, expect } from "./test.mjs";
import { heartFile } from "./fixture.mjs";
import sharp from "sharp";

const settled = (page) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false");

async function openPanel(page, id) {
  const toggle = page.locator(`.panel[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}

async function simple(page) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "View", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: "Simple", exact: true }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-experience", "simple");
}

async function splitImage() {
  const width = 80,
    height = 20,
    raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = x < width / 2 ? 255 : 0;
      raw[i + 2] = x < width / 2 ? 0 : 255;
      raw[i + 3] = 255;
    }
  return {
    width,
    height,
    file: {
      name: "split.png",
      mimeType: "image/png",
      buffer: await sharp(raw, {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer(),
    },
  };
}

async function openSplit(page) {
  const image = await splitImage();
  await page.locator("#fileInput").setInputFiles(image.file);
  await expect(page.locator("#fileDims")).toHaveText(
    image.width + " × " + image.height,
  );
  await settled(page);
  for (let i = 0; i < 12; i++) {
    const scale = await page.locator("#resultCanvas").evaluate((canvas) => {
      const box = canvas.getBoundingClientRect();
      return box.width / canvas.width;
    });
    if (scale < 2) break;
    await page.locator("#zoomOut").click();
  }
  return image;
}

function canvasPoint(page, x, y) {
  return page.locator("#resultCanvas").evaluate(
    (canvas, point) => {
      const box = canvas.getBoundingClientRect();
      return {
        x: box.left + ((point.x + 0.5) / canvas.width) * box.width,
        y: box.top + ((point.y + 0.5) / canvas.height) * box.height,
        scale: box.width / canvas.width,
      };
    },
    { x, y },
  );
}

async function pointer(page, { x, y, dx = 0, dy = 0, pointerType = "mouse", end = "pointerup" }) {
  await page.evaluate(
    ({ x, y, dx, dy, pointerType, end }) => {
      const space = document.querySelector("#resultCanvas").parentElement;
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType,
        button: 0,
        buttons: 1,
        isPrimary: true,
      };
      space.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y }),
      );
      if (dx || dy)
        space.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            clientX: x + dx,
            clientY: y + dy,
          }),
        );
      space.dispatchEvent(
        new PointerEvent(end, {
          ...base,
          clientX: x + dx,
          clientY: y + dy,
          buttons: 0,
        }),
      );
    },
    { x, y, dx, dy, pointerType, end },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(heartFile);
  await expect(page.locator("#palette button").first()).toBeVisible();
  await settled(page);
});

test("Simple stays Simple after a pick, and a slider echo is not an edit", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await expect(page.locator(".app")).toHaveAttribute("data-experience", "simple");
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.locator("#fileInput").setInputFiles(heartFile);
  await expect(page.locator("#palette button").first()).toBeVisible();
  await settled(page);
  await page.locator("#palette button").first().click();
  await settled(page);
  await page.locator("#targetHex").fill("#112233");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.evaluate(() => {
    for (const id of ["dh", "ds", "dl", "dhNumber", "dsNumber", "dlNumber"]) {
      const input = document.getElementById(id);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Target colour",
  );
  await context.close();
});

test("each advanced reason names its colour and opens that control", async ({
  page,
}) => {
  await page.locator("#palette button").first().click();
  await settled(page);
  await page.locator("#addRow").click();
  await settled(page);
  await openPanel(page, "adjust");
  await page.locator("#dhNumber").fill("12");
  await page.locator("#dhNumber").press("Tab");
  await expect(page.locator("#undo")).toHaveAttribute("aria-label", "Undo Hue");
  await page.locator("#colourMap .map-select").first().click();
  await simple(page);
  await expect(page.locator("#advancedHeld")).toContainText(
    "Manual adjustments on colour 2.",
  );
  await expect(page.locator("#advancedHeld")).not.toContainText("colour 1 and");
  await page.locator("#undo").click();
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.locator("#redo").click();
  await expect(page.locator("#advancedHeld")).toContainText(
    "Manual adjustments on colour 2.",
  );
  await page.getByRole("button", { name: "Show the fine sliders" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-experience",
    "advanced",
  );
  await expect(page.locator("#dh")).toBeFocused();
  await expect(page.locator("#colourMap .map-row").nth(1)).toHaveClass(/active/);

  await page.locator("#connected").check();
  await simple(page);
  await expect(page.locator("#advancedHeld")).toContainText(
    "A connected selection on colour 2.",
  );
  await page.getByRole("button", { name: "Show connected regions" }).click();
  await expect(page.locator("#connected")).toBeFocused();

  const box = await page.locator("#resultCanvas").boundingBox();
  await page.locator("#brushAdd").click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settled(page);
  await page.locator("#polygon").click();
  await page.mouse.click(box.x + 20, box.y + 20);
  await page.mouse.click(box.x + 60, box.y + 20);
  await page.mouse.click(box.x + 40, box.y + 50);
  await page.keyboard.press("Enter");
  await expect(page.locator("#polygonNote")).toBeVisible();
  await openPanel(page, "swatches");
  await page.locator("#paletteSet").selectOption("skin-fluent");
  await page.locator("#presets button").first().click();
  await settled(page);
  await openPanel(page, "selection");
  await page.locator("#refinement summary").click();
  await page.locator("#soft").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#model input[value='hsl']").check();
  await settled(page);
  await page.locator("#colourMap .map-select").first().click();
  await page.locator("#dhNumber").fill("8");
  await page.locator("#dhNumber").press("Tab");
  await simple(page);
  const held = page.locator("#advancedHeld");
  await expect(held).toContainText("Brush strokes or exclusions on colour 2.");
  await expect(held).toContainText("A polygon on colour 2.");
  await expect(held).toContainText("A connected selection on colour 2.");
  await expect(held).toContainText("Manual adjustments on colour 1.");
  await expect(held).toContainText("A skin-tone ramp on colour 2.");
  await expect(held).toContainText(
    "Changed refinement or colour-model settings on colour 2.",
  );
  await page.getByRole("button", { name: "Show the brush" }).click();
  await expect(page.locator("#brushAdd")).toBeFocused();
  await simple(page);
  await page.getByRole("button", { name: "Show the polygon tool" }).click();
  await expect(page.locator("#polygon")).toBeFocused();
  await simple(page);
  await page.getByRole("button", { name: "Show skin-tone swatches" }).click();
  await expect(page.locator("#presets button").first()).toBeFocused();
  await simple(page);
  await page.getByRole("button", { name: "Show refinement" }).click();
  await expect(page.locator("#soft")).toBeFocused();
  await expect(page.locator("#refinement")).toHaveJSProperty("open", true);
});

test("advanced reasons follow the active tab and stay quiet on a plain one", async ({
  page,
}) => {
  await openPanel(page, "adjust");
  await page.locator("#dhNumber").fill("12");
  await page.locator("#dhNumber").press("Tab");
  await expect(page.locator("#undo")).toHaveAttribute("aria-label", "Undo Hue");
  await simple(page);
  await expect(page.locator("#advancedHeld")).toContainText(
    "Manual adjustments on colour 1.",
  );
  const image = await splitImage();
  await page.locator("#fileInput").setInputFiles(image.file);
  await expect(page.locator("#fileDims")).toHaveText(
    image.width + " × " + image.height,
  );
  await settled(page);
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.getByRole("tab", { name: "red_heart.png ●", exact: true }).click();
  await expect(page.locator("#fileName")).toHaveText("red_heart.png");
  await expect(page.locator("#advancedHeld")).toContainText(
    "Manual adjustments on colour 1.",
  );
  await page.getByRole("tab", { name: "split.png", exact: true }).click();
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.getByRole("tab", { name: "red_heart.png ●", exact: true }).click();
  await page.locator("#undo").click();
  await expect(page.locator("#advancedHeld")).toBeHidden();
  await page.getByRole("tab", { name: "split.png", exact: true }).click();
  await expect(page.locator("#advancedHeld")).toBeHidden();
});

test("picking uses the pointer-down pixel inside the threshold and pans past it", async ({
  page,
}) => {
  const image = await openSplit(page);
  const down = await canvasPoint(page, image.width / 2 - 1, 4);
  expect(down.scale * 2).toBeLessThan(6);
  await page.mouse.move(down.x, down.y);
  await page.mouse.down();
  await page.mouse.move(down.x + down.scale * 2, down.y);
  await page.mouse.up();
  await settled(page);
  await expect(page.locator("#status")).toContainText("Picked #FF0000");
  await expect(page.locator("#seeds .seed")).toHaveCount(1);

  await page.locator("#clear").click();
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  const again = await canvasPoint(page, 4, 4);
  const panBefore = await page
    .locator("#resultCanvas")
    .evaluate((canvas) => canvas.style.transform);
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x + 4, again.y);
  await page.mouse.up();
  await settled(page);
  await expect(page.locator("#seeds .seed")).toHaveCount(1);
  await expect(page.locator("#resultCanvas")).toHaveAttribute(
    "style",
    new RegExp(panBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );

  await page.locator("#clear").click();
  const far = await canvasPoint(page, 8, 4);
  await page.mouse.move(far.x, far.y);
  await page.mouse.down();
  await page.mouse.move(far.x + 8, far.y);
  await page.mouse.up();
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  const panned = await page.locator("#resultCanvas").evaluate((canvas) => canvas.style.transform);
  expect(panned).not.toBe(panBefore);

  const touch = await canvasPoint(page, 12, 4);
  await pointer(page, { ...touch, dx: 9, pointerType: "touch" });
  await settled(page);
  await expect(page.locator("#status")).toContainText("Picked");
  await page.locator("#clear").click();
  await pointer(page, { ...touch, dx: 12, pointerType: "touch" });
  await expect(page.locator("#seeds .seed")).toHaveCount(0);

  const pen = await canvasPoint(page, 16, 4);
  await pointer(page, { ...pen, dx: 5, pointerType: "pen" });
  await settled(page);
  await expect(page.locator("#seeds .seed")).toHaveCount(1);
  await page.locator("#clear").click();
  await pointer(page, { ...pen, dx: 8, pointerType: "pen" });
  await expect(page.locator("#seeds .seed")).toHaveCount(0);

  const cancelAt = await canvasPoint(page, 20, 4);
  const beforeCancel = await page.locator("#status").textContent();
  await pointer(page, { ...cancelAt, end: "pointercancel" });
  await expect(page.locator("#status")).toHaveText(beforeCancel);
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  await page.evaluate(
    ({ x, y }) => {
      const space = document.querySelector("#resultCanvas").parentElement;
      const base = {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        isPrimary: true,
      };
      space.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, pointerId: 3, clientX: x, clientY: y }),
      );
      space.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          ...base,
          pointerId: 3,
          clientX: x,
          clientY: y,
        }),
      );
    },
    cancelAt,
  );
  await expect(page.locator("#seeds .seed")).toHaveCount(0);

  const pinch = await canvasPoint(page, 24, 4);
  await page.evaluate(
    ({ x, y }) => {
      const space = document.querySelector("#resultCanvas").parentElement;
      const down = (id, clientX) =>
        space.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: "touch",
            button: 0,
            buttons: 1,
            isPrimary: id === 1,
            clientX,
            clientY: y,
          }),
        );
      down(1, x);
      down(2, x + 30);
      for (const id of [2, 1])
        space.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: id,
            pointerType: "touch",
            button: 0,
            buttons: 0,
            clientX: x,
            clientY: y,
          }),
        );
    },
    pinch,
  );
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  await expect(page.locator("#undo")).not.toHaveAttribute(
    "aria-label",
    "Undo Pick colour",
  );
});

test("a transparent pixel is explained, and Pan, Space and brush keep their gestures", async ({
  page,
}) => {
  const raw = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    raw[i * 4] = 255;
    raw[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  await page.locator("#fileInput").setInputFiles({
    name: "hole.png",
    mimeType: "image/png",
    buffer: await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } })
      .png()
      .toBuffer(),
  });
  await settled(page);
  const hole = await canvasPoint(page, 0, 0);
  await page.mouse.click(hole.x, hole.y);
  await expect(page.locator("#status")).toContainText(
    "That pixel is transparent. Pick an opaque part of the asset.",
  );
  await expect(page.locator("#seeds .seed")).toHaveCount(0);

  const solid = await canvasPoint(page, 3, 3);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down("Space");
  await page.mouse.move(solid.x, solid.y);
  await page.mouse.down();
  await page.mouse.move(solid.x + 30, solid.y);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(page.locator("#seeds .seed")).toHaveCount(0);

  await page.locator("#pan").click();
  await page.mouse.move(solid.x, solid.y);
  await page.mouse.down();
  await page.mouse.move(solid.x + 24, solid.y + 8);
  await page.mouse.up();
  await expect(page.locator("#seeds .seed")).toHaveCount(0);
  await expect(page.locator("#undo")).not.toHaveAttribute(
    "aria-label",
    "Undo Pick colour",
  );

  await page.locator("#brushAdd").click();
  await page.mouse.move(solid.x, solid.y);
  await page.mouse.down();
  await page.mouse.move(solid.x + 20, solid.y, { steps: 4 });
  await page.mouse.up();
  await settled(page);
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Brush selection",
  );
});

test("import failures stay listed until success or dismissal", async ({
  page,
}) => {
  const bad = {
    name: "broken-sample.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html>not an image</html>"),
  };
  const other = {
    name: "also-broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html>still not</html>"),
  };
  const bar = () =>
    page.locator(".statusbar").evaluate((el) => getComputedStyle(el).height);
  const slider = () =>
    page.locator("#hueTol").evaluate((el) => el.getBoundingClientRect().height);
  const beforeBar = await bar();
  const beforeSlider = await slider();
  await page.locator("#fileInput").setInputFiles(bad);
  const notice = page.locator("#importNotice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("broken-sample.png");
  await expect(notice).toContainText("Invalid SVG document.");
  await expect(page.locator("#status")).toContainText("Could not open");
  await expect(page.locator("#fileDims")).toHaveText("128 × 128");
  await expect(page.locator("#emptyEditor")).toBeHidden();
  expect(await bar()).toBe(beforeBar);
  expect(await slider()).toBe(beforeSlider);
  const whiteSpace = await notice
    .locator(".import-reason")
    .evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(whiteSpace).not.toBe("nowrap");

  await page.setViewportSize({ width: 360, height: 700 });
  const box = await notice.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(361);
  // 640 CSS pixels is a 1280-wide window at 200% zoom. The notice stays
  // inside the viewport, the reason wraps, and the status line stays one line.
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const zoomed = await notice.boundingBox();
  const view = await page.locator("#viewport").boundingBox();
  expect(zoomed.x).toBeGreaterThanOrEqual(view.x - 1);
  expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(view.x + view.width + 1);
  const wraps = await notice.locator(".import-reason").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.whiteSpace !== "nowrap" && el.scrollWidth <= el.clientWidth + 1;
  });
  expect(wraps).toBe(true);
  const statusLine = await page.locator("#status").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.whiteSpace === "nowrap" && el.clientHeight < 40;
  });
  expect(statusLine).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page.locator("#dismissImport").focus();
  await expect(page.locator("#dismissImport")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(notice).toBeHidden();
  await expect(page.locator("#fileName")).toHaveText("red_heart.png");

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#fileInput").setInputFiles([heartFile, bad]);
  await expect(page.locator("#fileName")).toHaveText("red_heart.png");
  await expect(notice).toContainText("broken-sample.png");
  await expect(notice).not.toContainText("red_heart.png");
  await page.locator("#fileInput").setInputFiles(heartFile);
  await expect(notice).toBeHidden();

  const first = page.locator("#fileInput").setInputFiles(bad);
  const second = page.locator("#fileInput").setInputFiles(other);
  await first;
  await second;
  await expect(notice).toContainText("also-broken.png");
  await expect(notice).not.toContainText("broken-sample.png");
});

test("a failed open on a blank editor is the empty-editor notice", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await expect(page.locator("#emptyEditor")).toBeVisible();
  await page.locator("#fileInput").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html>not an image</html>"),
  });
  const notice = page.locator("#importNotice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("notes.png");
  await expect(notice).toContainText("Invalid SVG document.");
  await expect(page.locator("#fileName")).toHaveText("No images open");
  await expect(page.locator("#emptyEditor")).toHaveClass(/quiet/);
  await page.locator("#dismissImport").click();
  await expect(notice).toBeHidden();
  await expect(page.locator("#emptyEditor")).toBeVisible();
  await expect(page.locator("#emptyEditor")).not.toHaveClass(/quiet/);
  await context.close();
});
