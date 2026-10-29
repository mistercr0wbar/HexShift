import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";

const settled = (page) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false");
const ready = async (page) => {
  await settled(page);
};
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const png = async (name = "red.png", colour = "#E02020") => ({
  name,
  mimeType: "image/png",
  buffer: await sharp({
    create: { width: 12, height: 8, channels: 4, background: colour },
  })
    .png()
    .toBuffer(),
});
const open = async (page, files) => {
  await page.locator("#fileInput").setInputFiles(files);
  await expect(page.locator("#fileName")).toHaveText(files.at(-1).name);
  await ready(page);
};
async function paint(page, colour) {
  await page.locator("#palette button").first().click();
  await page.locator('#mode input[value="flat"]').check();
  await page.locator("#targetHex").fill(colour);
  await page.locator("#targetHex").press("Tab");
  await settled(page);
}
async function menu(page, label) {
  await page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "File", exact: true })
    .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function exported(page) {
  const next = page.waitForEvent("download");
  await page.locator("#export").click();
  const downloaded = await next;
  return readFile(await downloaded.path());
}
function unzip(buffer) {
  const v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    files = {};
  let at = v.getUint32(buffer.length - 6, true);
  for (let i = v.getUint16(buffer.length - 12, true); i > 0; i--) {
    const length = v.getUint16(at + 28, true),
      offset = v.getUint32(at + 42, true),
      size = v.getUint32(at + 20, true);
    const name = buffer.subarray(at + 46, at + 46 + length).toString("utf8"),
      start = offset + 30 + v.getUint16(offset + 26, true);
    files[name] = buffer.subarray(start, start + size);
    at += 46 + length;
  }
  return files;
}
const pixel = async (bytes) => [
  ...(await sharp(bytes).ensureAlpha().raw().toBuffer()).subarray(0, 4),
];
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

test("three tabs keep their maps, undo, outline and independent zoom/pan", async ({
  page,
}) => {
  await open(page, [
    await png("one.png"),
    await png("two.png"),
    await png("three.png"),
  ]);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await paint(page, "#12AB34");
  await page.locator('#overlay input[value="only"]').check();
  await page.locator("#actual").click();
  await page.locator("#zoomIn").click();
  const zoom = await page.locator("#zoomReadout").textContent();
  await page.locator("#pan").click();
  const canvasSpace = await page.locator(".after .canvas-space").boundingBox();
  await page.mouse.move(
    canvasSpace.x + canvasSpace.width / 2,
    canvasSpace.y + canvasSpace.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasSpace.x + canvasSpace.width / 2 + 24,
    canvasSpace.y + canvasSpace.height / 2 + 12,
  );
  await page.mouse.up();
  const transform = await page
    .locator("#resultCanvas")
    .evaluate((c) => c.style.transform);
  const outline = page.locator('[data-panel="outline"] .panel-toggle');
  if ((await outline.getAttribute("aria-expanded")) === "false")
    await outline.click();
  await page.locator("#outline").check();
  await tab(page, "one.png").click();
  await ready(page);
  await expect(page.locator("#outline")).not.toBeChecked();
  await expect(page.locator("#undo")).toBeDisabled();
  await paint(page, "#2233EE");
  await page.locator('#view input[value="result"]').check();
  await page.locator('#overlay input[value="normal"]').check();
  await page.locator("#apply").click();
  await ready(page);
  await page.locator("#targetHex").focus();
  await page.keyboard.press("Control+3");
  await ready(page);
  await expect(page.locator("#targetHex")).toHaveValue("#12AB34");
  await expect(page.locator('#view input[value="side"]')).toBeChecked();
  await expect(page.locator('#overlay input[value="only"]')).toBeChecked();
  await expect(page.locator("#zoomReadout")).toHaveText(zoom);
  expect(
    await page.locator("#resultCanvas").evaluate((c) => c.style.transform),
  ).toBe(transform);
  await expect(page.locator("#outline")).toBeChecked();
  await page.locator("#undo").click();
  await expect(page.locator("#outline")).not.toBeChecked();
  expect(await pixel(await exported(page))).toEqual([18, 171, 52, 255]);
  await page.locator("#targetHex").focus();
  await page.keyboard.press("Control+1");
  await ready(page);
  await expect(page.locator("#targetHex")).toHaveValue("#2233EE");
  await expect(page.locator('#view input[value="result"]')).toBeChecked();
  await expect(page.locator('#overlay input[value="normal"]')).toBeChecked();
  await page.locator("#undo").click();
  await ready(page);
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  expect(await pixel(await exported(page))).toEqual([34, 51, 238, 255]);
});

test("close asks only for edited tabs, cancel retains them, last close leaves an empty editor", async ({
  page,
}) => {
  await open(page, [await png("one.png"), await png("two.png")]);
  await paint(page, "#12AB34");
  await tab(page, "two.png ●").locator(".document-close").click();
  await expect(page.locator("#replaceTitle")).toHaveText("Close this tab?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Control+w");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await ready(page);
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("#export")).toBeDisabled();
  await open(page, [await png("new.png")]);
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("keyboard switching, strip arrows, middle close and drag order", async ({
  page,
}) => {
  await open(page, [
    await png("one.png"),
    await png("two.png"),
    await png("three.png"),
  ]);
  await page.keyboard.press("Control+1");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("one.png");
  await page.locator("#targetHex").focus();
  await page.keyboard.press("Control+Tab");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("two.png");
  await page.keyboard.press("Control+Shift+Tab");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("one.png");
  await tab(page, "one.png").focus();
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("two.png");
  await expect(tab(page, "two.png")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("three.png");
  await expect(tab(page, "three.png")).toBeFocused();
  await tab(page, "three.png").dragTo(tab(page, "one.png"));
  await expect(page.locator("[role=tab] .document-name")).toHaveText([
    "three.png",
    "one.png",
    "two.png",
  ]);
  await tab(page, "one.png").click({ button: "middle" });
  await expect(page.locator("[role=tab] .document-name")).toHaveText([
    "three.png",
    "two.png",
  ]);
});

test("apply to all tabs is one undo per tab, and export ZIP deduplicates names", async ({
  page,
}) => {
  await open(page, [
    await png("red.png"),
    await png("red.png"),
    await png("last.png"),
  ]);
  await paint(page, "#12AB34");
  await menu(page, "Apply to all tabs");
  await expect(page.locator("#status")).toContainText(
    "Applied recipe to 3 tabs",
  );
  await ready(page);
  await expect(page.locator("#editState")).toHaveText("No pending edit");
  const next = page.waitForEvent("download");
  await menu(page, "Export all tabs…");
  const download = await next,
    files = unzip(await readFile(await download.path()));
  expect(download.suggestedFilename()).toBe("hexshift-tabs.zip");
  expect(Object.keys(files)).toEqual([
    "red-shifted.png",
    "red-shifted (2).png",
    "last-shifted.png",
  ]);
  for (const bytes of Object.values(files))
    expect(await pixel(bytes)).toEqual([18, 171, 52, 255]);
  await page.keyboard.press("Control+1");
  await ready(page);
  await page.locator("#undo").click();
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([224, 32, 32, 255]);
  await page.keyboard.press("Control+2");
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([18, 171, 52, 255]);
  await page.locator("#undo").click();
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([224, 32, 32, 255]);
});

test("Ctrl and Shift selection apply only to the selected range", async ({
  page,
}) => {
  await open(page, [
    await png("one.png"),
    await png("two.png"),
    await png("three.png"),
    await png("source.png"),
  ]);
  await paint(page, "#12AB34");
  await tab(page, "source.png ●").click({ modifiers: ["Control"] });
  await tab(page, "one.png").click({ modifiers: ["Control"] });
  await tab(page, "two.png").click({ modifiers: ["Control"] });
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(2);
  await menu(page, "Apply to selected tabs");
  await expect(page.locator("#status")).toContainText(
    "Applied recipe to 2 tabs",
  );
  await tab(page, "three.png").click();
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([224, 32, 32, 255]);
  await tab(page, "one.png ●").click();
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([18, 171, 52, 255]);
  await tab(page, "three.png").click({ modifiers: ["Shift"] });
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(3);
});

test("rapid switches and worker fallback keep pixels in their own tabs", async ({
  page,
}) => {
  await open(page, [await png("red.png"), await png("blue.png", "#2020E0")]);
  for (let i = 0; i < 8; i++)
    await page.keyboard.press(i % 2 ? "Control+2" : "Control+1");
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([32, 32, 224, 255]);
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw Error("blocked");
      }
    };
  });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await ready(page);
  await open(page, [await png("red.png"), await png("blue.png", "#2020E0")]);
  await paint(page, "#12AB34");
  await page.keyboard.press("Control+1");
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([224, 32, 32, 255]);
  await page.keyboard.press("Control+2");
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([18, 171, 52, 255]);
});

test("twenty-tab limit preserves existing tabs and batch from files stays available", async ({
  page,
}) => {
  const files = await Promise.all(
    Array.from({ length: 21 }, (_, i) => png(`image-${i}.png`)),
  );
  await page.locator("#fileInput").setInputFiles(files);
  await expect(page.getByRole("tab")).toHaveCount(20);
  await expect(page.locator("#status")).toContainText("Up to 20 image tabs");
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("image-19.png");
  await expect(page.locator("#fileInput")).toHaveAttribute("multiple", "");
  await menu(page, "Batch from files…");
  await expect(page.getByRole("tab")).toHaveCount(20);
});

test("phone picker switches and closes tabs; desktop strip has no accessibility violations", async ({
  page,
}) => {
  await open(page, [
    await png("one.png"),
    await png("two.png"),
    await png("three.png"),
  ]);
  for (const theme of ["night", "day"]) {
    await page.locator("#themeMenu summary").click();
    await page.locator(`#theme input[value="${theme}"]`).check();
    await page.keyboard.press("Escape");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#documentPicker")).toBeVisible();
  await expect(page.locator("#tabList")).toBeHidden();
  const options = await page
    .locator("#documentPicker option")
    .evaluateAll((els) => els.map((o) => o.value));
  await page.locator("#documentPicker").selectOption(options[0]);
  await ready(page);
  await expect(page.locator("#fileName")).toHaveText("one.png");
  await page.locator("#closeDocument").click();
  await expect(page.locator("#documentPicker option")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("multi-file drop and image paste add tabs without a replacement prompt", async ({
  page,
}) => {
  await open(page, [await png("base.png")]);
  await paint(page, "#12AB34");
  const files = [await png("drop-one.png"), await png("drop-two.png")];
  await page.evaluate(
    (inputs) => {
      const dt = new DataTransfer();
      for (const input of inputs)
        dt.items.add(
          new File([new Uint8Array(input.bytes)], input.name, {
            type: "image/png",
          }),
        );
      document.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
      );
    },
    files.map((f) => ({ name: f.name, bytes: [...f.buffer] })),
  );
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.locator("#fileName")).toHaveText("drop-two.png");
  await ready(page);
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], "paste.png", {
          type: "image/png",
        }),
        event = new Event("paste", { bubbles: true, cancelable: true });
      // Firefox empties synthetic ClipboardEvent data. Supply a real paste's
      // event surface while retaining the full image decode and import path.
      Object.defineProperty(event, "clipboardData", {
        value: {
          items: [{ type: "image/png", getAsFile: () => file }],
          getData: () => "",
        },
      });
      document.dispatchEvent(event);
    },
    [...files[0].buffer],
  );
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.locator("#replaceDialog")).not.toBeVisible();
  await expect(page.locator("#fileName")).toHaveText("pasted.png");
});

test("status-bar Cancel interrupts a tab batch and retains completed undo", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.MessageChannel;
    window.MessageChannel = class extends Original {
      constructor() {
        super();
        const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = (...args) => {
          if (window.__slowBatch)
            (window.__batchYields ||= []).push(() => post(...args));
          else post(...args);
        };
      }
    };
  });
  await page.reload();
  await ready(page);
  await open(page, [
    await png("one.png"),
    await png("two.png"),
    await png("source.png"),
  ]);
  await paint(page, "#12AB34");
  await page.evaluate(async () => {
    window.__slowBatch = true;
    // Cross the processor's 12 ms yield budget, then hold its next yield until
    // Cancel is pressed. A fast machine cannot finish before the pointer click.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await menu(page, "Apply to all tabs");
  await expect(page.locator("#status")).toContainText("Applying recipe");
  await expect
    .poll(() => page.evaluate(() => window.__batchYields?.length || 0))
    .toBeGreaterThan(0);
  await page.locator("#cancel").click();
  await expect(page.locator("#status")).toContainText("Batch cancelled");
  await expect(page.locator("#main")).not.toHaveAttribute("inert", "");
  await page.evaluate(() => {
    window.__slowBatch = false;
    for (const resume of window.__batchYields || []) resume();
    window.__batchYields = [];
  });
  await page.keyboard.press("Control+2");
  await ready(page);
  expect(await pixel(await exported(page))).toEqual([224, 32, 32, 255]);
});

test("quitting checks edits in background tabs through both native-close and File Exit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.chrome ||= {};
    window.chrome.webview = { postMessage() {}, addEventListener() {} };
    window.close = () => {
      window.__closed = true;
    };
  });
  await page.reload();
  await ready(page);
  await open(page, [await png("edited.png")]);
  await paint(page, "#12AB34");
  await open(page, [await png("clean.png")]);
  await expect(page.locator("#undo")).toBeDisabled();
  await page.evaluate(() => {
    window.hexShiftRequestClose();
  });
  await expect(page.locator("#replaceTitle")).toHaveText("Quit Hex Shift?");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await page.evaluate(() => !!window.__closed)).toBe(false);
  await menu(page, "Exit");
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__closed)).toBe(true);
});
