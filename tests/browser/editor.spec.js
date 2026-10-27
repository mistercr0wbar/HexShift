import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sample from "../../src/sample.js";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
const svg = (body, attrs = "") => ({
  name: "asset.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" ${attrs}>${body}</svg>`,
  ),
});
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
  await page.locator("#mode").selectOption("flat");
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
  await page.locator("#overlay").selectOption("normal");
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
    await page.locator("#model").selectOption(model);
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
  const { data, info } = await sharp(await readFile(await (await download).path()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBeGreaterThanOrEqual(128);
  let green = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 0 && data[i + 3] === 255)
      green++;
  expect(green).toBeGreaterThan(200);
  await page.locator("#previewGround").selectOption({ label: "Primary button" });
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
test("brush overrides, history and preview background do not alter export alpha", async ({
  page,
}) => {
  await page.locator("#brushPanel").locator("summary").click();
  await page.locator("#brushAdd").click();
  const box = await page.locator("#resultCanvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#coverage")).toContainText("pixels selected");
  await page.locator("#mode").selectOption("transparent");
  await expect(page.locator("#cancel")).toBeHidden();
  await expect(page.locator("#editState")).toHaveText("Pending edit");
  await page.locator("#undo").click();
  await expect(page.locator("#mode")).toHaveValue("shift");
  await page.locator("#redo").click();
  await expect(page.locator("#mode")).toHaveValue("transparent");
  await page.locator("#background").selectOption("white");
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
  await page.locator("#theme").selectOption("dark");
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
  await page.locator("#mode").selectOption("flat");
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
  await page.locator("#mode").selectOption("flat");
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
  const bad = [
    svg("<g>".repeat(65) + "<rect/>" + "</g>".repeat(65)),
    svg("<rect/>".repeat(5001)),
    {
      name: "entity.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<!DOCTYPE svg [<!ENTITY x "test">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">&x;</svg>',
      ),
    },
    svg(
      '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
    ),
  ];
  for (const input of bad) {
    await page.locator("#fileInput").setInputFiles(input);
    await expect(page.locator("#status")).toContainText("Could not open");
    await expect(page.locator("#fileDims")).toContainText("512 × 256");
  }
});
test("Fluent Color SVG filters, mask types and blend modes", async ({
  page,
}) => {
  await page
    .locator("#fileInput")
    .setInputFiles(resolve("tests/fixtures/1st_place_medal_color.svg"));
  await expect(page.locator("#fileDims")).toContainText("32 × 32");
  await ready(page);
  const shadow = svg(
    '<defs><filter id="s" x="0" y="0" width="10" height="5" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"/><feBlend mode="normal" in="SourceGraphic" in2="bg" result="shape"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hard"/><feOffset dx="-0.2" dy="0.2"/><feGaussianBlur stdDeviation="0.2"/><feComposite in2="hard" operator="arithmetic" k2="-1" k3="1"/><feBlend mode="normal" in2="shape"/></filter><mask id="m" mask-type="alpha"><rect width="10" height="5" fill="#000"/></mask></defs><g filter="url(#s)" mask="url(#m)"><rect width="10" height="5" fill="#f00"/><rect width="10" height="5" fill="#00f" style="mix-blend-mode:multiply"/></g>',
  );
  await page.locator("#fileInput").setInputFiles(shadow);
  await expect(page.locator("#fileDims")).toContainText("512 × 256");
  await ready(page);
  await expect(page.locator("#status")).not.toContainText("Could not open");
});
test("touch-sized tools, wipe comparison, keyboard text shortcuts and zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#view").selectOption("wipe");
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
test("accessibility in light/dark themes and at 200 percent zoom", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await page.locator("#theme").selectOption(theme);
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
    await page
      .locator("#fileInput")
      .setInputFiles({
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
  await page
    .locator("#fileInput")
    .setInputFiles({
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
    await page
      .locator("#fileInput")
      .setInputFiles({
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
