import { test, expect } from "./test.mjs";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const settled = (page) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false");
const png = async (name, colour = "#E02020", width = 12, height = 8) => ({
  name,
  mimeType: "image/png",
  buffer: await sharp({
    create: { width, height, channels: 4, background: colour },
  })
    .png()
    .toBuffer(),
});
async function open(page, files) {
  await page.locator("#fileInput").setInputFiles(files);
  await expect(page.locator("#fileName")).toHaveText(files.at(-1).name);
  await settled(page);
}
async function openPanel(page, id) {
  const toggle = page.locator(`.panel[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
async function showRecipes(page) {
  const panel = page.locator("#recipePanel");
  if (!(await panel.evaluate((el) => el.open)))
    await panel.locator("summary").click();
}
async function menu(page, label) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "File", exact: true })
    .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
function spotOf(box, w, h, x, y) {
  return {
    x: box.x + ((x + 0.5) / w) * box.width,
    y: box.y + ((y + 0.5) / h) * box.height,
  };
}
async function ink(page) {
  return page.locator("#polygonAfter").evaluate((canvas) => {
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
    return n;
  });
}
async function recolour(page) {
  await page.locator("#palette button").first().click();
  await settled(page);
  await page.locator('#mode input[value="flat"]').check();
  await page.locator("#targetHex").fill("#1122FF");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await settled(page);
});

test("a polygon closes on the displayed point, and a draft is not history", async ({
  page,
}) => {
  const w = 80,
    h = 80;
  await open(page, [await png("square.png", "#FFFFFF", w, h)]);
  await page.locator("#actual").click();
  await expect(page.locator("#zoomReadout")).toHaveText("100%");
  await page.keyboard.press("p");
  await expect(page.locator("#status")).toContainText("does not choose");
  const box = await page.locator("#resultCanvas").boundingBox();
  const at = (x, y) => spotOf(box, w, h, x, y);
  const clickAt = async (x, y) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  await expect(page.locator("#undo")).toBeDisabled();
  await clickAt(20, 20);
  await clickAt(50, 20);
  await expect(page.locator("#status")).toContainText("Polygon point 2");
  await expect(page.locator("#undo")).toBeDisabled();
  const before = await ink(page);
  const away = at(50, 50);
  await page.mouse.move(away.x, away.y);
  expect(await ink(page)).toBeGreaterThan(before);
  await page.mouse.click(away.x, away.y);
  await expect(page.locator("#status")).toContainText("Polygon point 3");
  const first = at(20, 20);
  await page.mouse.click(first.x + 10, first.y);
  await expect(page.locator("#status")).toContainText("Polygon point 4");
  await expect(page.locator("#polygonNote")).toBeHidden();
  await page.mouse.move(first.x + 7, first.y);
  await expect(page.locator("#status")).toContainText("The first point closes");
  await page.mouse.click(first.x + 7, first.y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await expect(page.locator("#polygonNote")).toContainText(
    "does not choose that colour",
  );
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
  for (const view of ["result", "wipe", "side"]) {
    await page.locator(`#view input[value="${view}"]`).check();
    await expect(page.locator("#polygonAfter")).toBeVisible();
    expect(await ink(page)).toBeGreaterThan(0);
  }
  for (let i = 0; i < 4; i++) await page.locator("#zoomIn").click();
  await expect(page.locator("#zoomReadout")).toHaveText("244%");
  expect(await ink(page)).toBeGreaterThan(0);
  await page.locator("#undo").click();
  await expect(page.locator("#polygonNote")).toBeHidden();
  await page.locator("#redo").click();
  await expect(page.locator("#polygonNote")).toBeVisible();
  await page.locator("#actual").click();
  const again = await page.locator("#resultCanvas").boundingBox();
  const start = spotOf(again, w, h, 10, 10);
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#status")).toContainText("Polygon point 1");
  await page.keyboard.press("Escape");
  await expect(page.locator("#status")).toContainText("cancelled");
  await expect(page.locator("#polygonNote")).toBeVisible();
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
});

test("closing just outside the image still finishes, and a late release does not", async ({
  page,
}) => {
  const w = 80,
    h = 80;
  await open(page, [await png("edge.png", "#FFFFFF", w, h)]);
  await page.locator('#view input[value="result"]').check();
  await page.locator("#actual").click();
  await expect(page.locator("#zoomReadout")).toHaveText("100%");
  await page.keyboard.press("p");
  // Pixel 4 sits inside the bitmap. Seven CSS pixels left of its centre is
  // outside the bitmap and still over the pane. A locator click on the canvas
  // is swallowed by the pane on Firefox.
  const placed = await page.evaluate(() => {
    const canvas = document.querySelector("#resultCanvas");
    const r = canvas.getBoundingClientRect();
    const spot = (x, y) => ({
      x: r.left + ((x + 0.5) / canvas.width) * r.width,
      y: r.top + ((y + 0.5) / canvas.height) * r.height,
    });
    const describe = (p) => {
      const hit = document.elementFromPoint(p.x, p.y);
      return {
        ...p,
        onCanvas: hit === canvas,
        inPane: !!(hit && hit.closest && hit.closest(".canvas-space")),
      };
    };
    const points = [
      [4, 40],
      [36, 40],
      [36, 12],
    ].map(([x, y]) => describe(spot(x, y)));
    const first = spot(4, 40);
    return { points, outside: describe({ x: first.x - 7, y: first.y }) };
  });
  for (const p of placed.points) expect(p.onCanvas).toBe(true);
  expect(placed.outside.inPane).toBe(true);
  expect(placed.outside.onCanvas).toBe(false);
  for (let i = 0; i < placed.points.length; i++) {
    await page.mouse.click(placed.points[i].x, placed.points[i].y);
    await expect(page.locator("#status")).toContainText(
      "Polygon point " + (i + 1),
    );
  }
  const box = await page.locator("#resultCanvas").boundingBox();
  const at = (x, y) => spotOf(box, w, h, x, y);
  await page.mouse.click(placed.outside.x, placed.outside.y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await page.locator("#undo").click();
  await page.keyboard.press("p");
  const a = at(30, 30);
  await page.mouse.click(a.x, a.y);
  const b = at(40, 30);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("#status")).toContainText("cancelled");
  await expect(page.locator("#status")).not.toContainText("Polygon point");
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.locator("#brushAdd").click();
  await expect(page.locator("#status")).not.toContainText("Polygon point 3");
  await page.keyboard.press("p");
  await page.mouse.click(at(30, 40).x, at(30, 40).y);
  await expect(page.locator("#status")).toContainText("Polygon point 1");
  await page.locator("#addRow").click();
  await page.mouse.click(at(32, 40).x, at(32, 40).y);
  await expect(page.locator("#status")).toContainText("Polygon point 1");
  await page.mouse.click(at(48, 40).x, at(48, 40).y);
  await expect(page.locator("#status")).toContainText("Polygon point 2");
  await page.locator("#colourMap .map-select").first().click();
  await page.keyboard.press("p");
  await page.mouse.click(at(34, 40).x, at(34, 40).y);
  await expect(page.locator("#status")).toContainText("Polygon point 1");
});

test("a zoomed close uses CSS pixels, including a finger", async ({ page }) => {
  const w = 80,
    h = 80;
  await open(page, [await png("zoom.png", "#FFFFFF", w, h)]);
  await page.locator("#actual").click();
  for (let i = 0; i < 4; i++) await page.locator("#zoomIn").click();
  await page.keyboard.press("p");
  const box = await page.locator("#resultCanvas").boundingBox();
  const at = (x, y) => spotOf(box, w, h, x, y);
  for (const [x, y] of [
    [20, 20],
    [24, 20],
    [24, 24],
  ]) {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  }
  const first = at(20, 20);
  await page.mouse.click(first.x + 10, first.y);
  await expect(page.locator("#status")).toContainText("Polygon point 4");
  await page.mouse.click(first.x + 7, first.y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await page.locator("#undo").click();
  const touch = async (x, y, type) => {
    await page.evaluate(
      ({ x, y, type }) => {
        document.querySelector("#resultCanvas").parentElement.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 7,
            pointerType: "touch",
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            isPrimary: true,
          }),
        );
      },
      { x, y, type },
    );
  };
  const tap = async (x, y) => {
    await touch(x, y, "pointerdown");
    await touch(x, y, "pointerup");
  };
  for (const [x, y] of [
    [20, 20],
    [24, 20],
    [24, 24],
  ]) {
    const p = at(x, y);
    await tap(p.x, p.y);
  }
  await tap(first.x + 14, first.y);
  await expect(page.locator("#status")).toContainText("Polygon point 4");
  await tap(first.x + 11, first.y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
});

test("a polygon point can be dragged, and that drag is one undo", async ({
  page,
}) => {
  const w = 80,
    h = 80;
  await open(page, [await png("move.png", "#FFFFFF", w, h)]);
  await page.locator("#actual").click();
  await expect(page.locator("#zoomReadout")).toHaveText("100%");
  await page.keyboard.press("p");
  const box = await page.locator("#resultCanvas").boundingBox();
  const at = (x, y) => spotOf(box, w, h, x, y);
  for (const [x, y] of [
    [20, 20],
    [50, 20],
    [50, 50],
  ]) {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.mouse.click(at(20, 20).x, at(20, 20).y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  const rested = await ink(page);
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
  const from = at(50, 20);
  const to = at(50, 40);
  await page.mouse.move(from.x, from.y);
  await expect
    .poll(() =>
      page
        .locator("#resultCanvas")
        .evaluate((el) => getComputedStyle(el.parentElement).cursor),
    )
    .toBe("grab");
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  expect(await ink(page)).not.toBe(rested);
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
  await page.mouse.up();
  await expect(page.locator("#status")).toContainText("Moved a polygon point");
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Move polygon point",
  );
  const moved = await ink(page);
  expect(moved).not.toBe(rested);
  await page.locator("#undo").click();
  expect(await ink(page)).toBe(rested);
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
  await page.locator("#redo").click();
  expect(await ink(page)).toBe(moved);
  await page.mouse.click(to.x, to.y);
  await expect(page.locator("#status")).not.toContainText("Polygon point 1");
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Move polygon point",
  );
  await page.mouse.move(to.x, to.y);
  await page.mouse.down();
  await page.mouse.move(at(50, 55).x, at(50, 55).y, { steps: 4 });
  expect(await ink(page)).not.toBe(moved);
  await page.keyboard.press("Escape");
  await expect(page.locator("#status")).toContainText(
    "Left the polygon point",
  );
  await page.mouse.up();
  expect(await ink(page)).toBe(moved);
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Move polygon point",
  );
});

test("dragging a draft point is not history, and a click still closes", async ({
  page,
}) => {
  const w = 80,
    h = 80;
  await open(page, [await png("draft.png", "#FFFFFF", w, h)]);
  await page.locator("#actual").click();
  await page.keyboard.press("p");
  const box = await page.locator("#resultCanvas").boundingBox();
  const at = (x, y) => spotOf(box, w, h, x, y);
  for (const [x, y] of [
    [20, 30],
    [46, 30],
    [46, 52],
  ]) {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.locator("#undo")).toBeDisabled();
  const from = at(46, 30);
  const to = at(60, 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#status")).toContainText("Moved polygon point 2");
  await expect(page.locator("#undo")).toBeDisabled();
  await page.mouse.click(at(20, 30).x, at(20, 30).y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await expect(page.locator("#undo")).toHaveAttribute(
    "aria-label",
    "Undo Polygon selection",
  );
});

test("recipe warnings name only the spatial edits that would be repeated", async ({
  page,
}) => {
  await open(page, [await png("red.png")]);
  await recolour(page);
  await showRecipes(page);
  const plainDownload = page.waitForEvent("download");
  await page.locator("#saveRecipe").click();
  const plain = JSON.parse(
    await readFile(await (await plainDownload).path(), "utf8"),
  );
  expect(plain.steps[0].omissions).toEqual([]);
  await expect(page.locator("#recipeDialog")).toBeHidden();

  await page.locator("#connected").check();
  await page.locator("#saveRecipe").click();
  await expect(page.locator("#recipeDialogText")).toHaveText(
    "Connected regions are left out.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#recipeDialog")).toBeHidden();
  await expect(page.locator("#status")).not.toContainText(
    "Connected regions are left out.",
  );
  await expect(page.locator("#editState")).toHaveText("Pending edit");

  await menu(page, "Save recipe…");
  await expect(page.locator("#recipeDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#recipeDialog")).toBeHidden();
  await expect(page.locator("#status")).not.toContainText(
    "Connected regions are left out.",
  );

  await page.locator("#connected").uncheck();
  const box = await page.locator("#resultCanvas").boundingBox();
  await page.locator("#brushAdd").click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settled(page);
  await page.locator("#saveRecipe").click();
  await expect(page.locator("#recipeDialogText")).toHaveText(
    "Brush strokes are left out.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.locator("#undo").click();
  await settled(page);
  await page.keyboard.press("p");
  const corner = await page.locator("#resultCanvas").boundingBox();
  const click = async (px, py) => {
    const b = corner;
    await page.mouse.click(
      b.x + ((px + 0.5) / 12) * b.width,
      b.y + ((py + 0.5) / 8) * b.height,
    );
  };
  for (const [x, y] of [
    [1, 1],
    [4, 1],
    [4, 4],
    [1, 1],
  ])
    await click(x, y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await page.locator("#saveRecipe").click();
  await expect(page.locator("#recipeDialogText")).toHaveText(
    "Polygons are left out.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.locator("#connected").check();
  await page.locator("#brushAdd").click();
  await page.mouse.click(box.x + 8, box.y + 8);
  await settled(page);
  await page.locator("#saveRecipe").click();
  const combined = page.locator("#recipeDialogText");
  await expect(combined).toContainText("Brush strokes are left out.");
  await expect(combined).toContainText("Connected regions are left out.");
  await expect(combined).toContainText("Polygons are left out.");
  await page.evaluate(() => {
    const input = document.getElementById("targetHex");
    input.value = "#00FF00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#status")).toContainText(
    "The image changed. Nothing was saved.",
  );

  delete plain.steps[0].omissions;
  await page.locator("#recipeInput").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(plain)),
  });
  await expect(page.locator("#recipeDialogTitle")).toHaveText(
    "This recipe does not promise a lossless replay",
  );
  await expect(page.locator("#recipeDialogText")).toContainText(
    "does not say whether",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#status")).not.toContainText("Applied");
  plain.steps[0].approximate = true;
  await page.locator("#recipeInput").setInputFiles({
    name: "generic.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(plain)),
  });
  await expect(page.locator("#recipeDialogText")).toContainText(
    "marked as an approximation",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("tab and file repeats ask only when another image would be replayed", async ({
  page,
}) => {
  const fresh = async () => {
    await page.goto("/");
    await settled(page);
  };
  await open(page, [await png("only.png")]);
  await recolour(page);
  await page.locator("#connected").check();
  await showRecipes(page);
  await page.locator("#repeatSelected").click();
  await expect(page.locator("#recipeDialog")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "Applied recipe to 1 tabs",
  );
  await settled(page);

  await fresh();
  await open(page, [await png("one.png"), await png("two.png", "#2020E0")]);
  await recolour(page);
  await page.locator("#connected").check();
  await showRecipes(page);
  await page.locator("#repeatSelected").click();
  await expect(page.locator("#recipeDialog")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "Applied recipe to 1 tabs",
  );

  await fresh();
  await open(page, [await png("left.png"), await png("right.png")]);
  await recolour(page);
  await page.locator("#connected").check();
  const right = page.getByRole("tab", { name: /right\.png/ });
  const left = page.getByRole("tab", { name: /^left\.png$/ });
  await right.click({ modifiers: ["Control"] });
  await left.click({ modifiers: ["Control"] });
  await showRecipes(page);
  await page.locator("#repeatSelected").click();
  await expect(page.locator("#recipeDialogText")).toHaveText(
    "Connected regions are left out.",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#status")).not.toContainText("Applied recipe");
  await left.click();
  await settled(page);
  const pixel = () =>
    page.locator("#resultCanvas").evaluate((canvas) => {
      const d = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    });
  expect(await pixel()).toEqual([224, 32, 32, 255]);
  await right.click();
  await settled(page);
  await page.locator("#repeatAll").click();
  await expect(page.locator("#recipeDialog")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#status")).toContainText(
    "Applied recipe to 2 tabs",
  );
  await settled(page);
  await expect(page.locator("#editState")).toHaveText("No pending edit");

  await fresh();
  await open(page, [await png("batch.png")]);
  await recolour(page);
  await page.locator("#connected").check();
  await showRecipes(page);
  await page.locator("#batchInput").setInputFiles([await png("extra.png")]);
  await expect(page.locator("#recipeDialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#batchNote")).not.toContainText("Done:");
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "Batch from files…");
  await (await chooser).setFiles([await png("extra.png")]);
  await expect(page.locator("#recipeDialog")).toBeVisible();
  const batching = page.waitForEvent("download");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const batch = await batching;
  expect(batch.suggestedFilename()).toBe("hexshift-batch.zip");
  await expect(page.locator("#batchNote")).toContainText(
    "Connected regions are left out.",
  );
  await expect(page.locator("#batchNote")).toContainText("Done: 1 of 1 image");

  const exporting = page.waitForEvent("download");
  await menu(page, "Export all tabs…");
  expect((await exporting).suggestedFilename()).toBe("hexshift-tabs.zip");
  await expect(page.locator("#recipeDialog")).toBeHidden();

  await openPanel(page, "outline");
  await page.locator("#reset").click();
  await settled(page);
  await page.locator("#outline").check();
  await showRecipes(page);
  const outlineDownload = page.waitForEvent("download");
  await page.locator("#saveRecipe").click();
  const outline = JSON.parse(
    await readFile(await (await outlineDownload).path(), "utf8"),
  );
  expect(outline.version).toBe(3);
  expect(outline.steps).toEqual([]);
  await expect(page.locator("#recipeDialog")).toBeHidden();
});

test("an imported recipe keeps rendered spatial edits and warns about itself", async ({
  page,
}) => {
  const w = 8,
    h = 6,
    raw = Buffer.alloc(w * h * 4, 255);
  const put = (x, y) => {
    const o = (y * w + x) * 4;
    raw[o] = 220;
    raw[o + 1] = 30;
    raw[o + 2] = 30;
  };
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [5, 1],
    [6, 1],
    [5, 2],
    [6, 2],
  ])
    put(x, y);
  await page.locator("#fileInput").setInputFiles({
    name: "blocks.png",
    mimeType: "image/png",
    buffer: await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer(),
  });
  await settled(page);
  const box = await page.locator("#resultCanvas").boundingBox();
  const clickAt = async (x, y) => {
    await page.mouse.click(
      box.x + ((x + 0.5) / w) * box.width,
      box.y + ((y + 0.5) / h) * box.height,
    );
  };
  await clickAt(1, 1);
  await settled(page);
  await page.locator('#mode input[value="flat"]').check();
  await page.locator("#targetHex").fill("#1122FF");
  await page.locator("#targetHex").press("Tab");
  await settled(page);
  await page.keyboard.press("p");
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
    [1, 1],
  ])
    await clickAt(x, y);
  await expect(page.locator("#status")).toContainText("Polygon closed");
  await settled(page);
  const pixel = (x, y) =>
    page.locator("#resultCanvas").evaluate(
      (canvas, p) => [...canvas.getContext("2d").getImageData(p.x, p.y, 1, 1).data],
      { x, y },
    );
  expect(await pixel(1, 1)).toEqual([17, 34, 255, 255]);
  expect(await pixel(5, 1)).toEqual([220, 30, 30, 255]);
  const recipe = {
    format: "hexshift-recipe",
    version: 1,
    steps: [
      {
        omissions: [],
        rows: [
          {
            params: {
              hueTol: 40,
              shadeTol: 60,
              soft: 20,
              feather: 0,
              dh: 0,
              ds: 0,
              dl: 0,
              protect: true,
              model: "oklch",
              cleanEdges: true,
              mode: "flat",
              target: "#00AA00",
            },
            seeds: [{ hex: "#DC1E1E" }],
          },
        ],
      },
    ],
  };
  await page.locator("#recipeInput").setInputFiles({
    name: "green.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator("#recipeDialog")).toBeHidden();
  await expect(page.locator("#status")).toContainText("Applied green.json");
  await settled(page);
  expect(await pixel(1, 1)).toEqual([17, 34, 255, 255]);
  expect(await pixel(5, 1)).toEqual([0, 170, 0, 255]);
});
