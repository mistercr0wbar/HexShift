import { test, expect } from "./test.mjs";
import { heartFile } from "./fixture.mjs";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";

const settled = (page, timeout = 15000) =>
  expect(page.locator(".app")).toHaveAttribute("data-busy", "false", {
    timeout,
  });

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([u32(data.length), body, crc]);
}
function pngHeader(width, height, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extra,
  ]);
}
function file(name, buffer, mime = "image/png") {
  return { name, mimeType: mime, buffer };
}
function gifHeader(width, height) {
  const bytes = Buffer.alloc(13);
  bytes.write("GIF89a", 0, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
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
function apng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  const frame = (sequence, rgba) => {
    const fcTL = Buffer.alloc(26);
    fcTL.writeUInt32BE(sequence, 0);
    fcTL.writeUInt32BE(1, 4);
    fcTL.writeUInt32BE(1, 8);
    fcTL.writeUInt16BE(1, 20);
    fcTL.writeUInt16BE(10, 22);
    const raw = Buffer.concat([Buffer.from([0]), rgba]);
    return [chunk("fcTL", fcTL), deflateSync(raw)];
  };
  const red = frame(0, Buffer.from([255, 0, 0, 255]));
  const blueFc = Buffer.alloc(26);
  blueFc.writeUInt32BE(1, 0);
  blueFc.writeUInt32BE(1, 4);
  blueFc.writeUInt32BE(1, 8);
  blueFc.writeUInt16BE(1, 20);
  blueFc.writeUInt16BE(10, 22);
  const blueData = Buffer.concat([
    u32(2),
    deflateSync(Buffer.concat([Buffer.from([0]), Buffer.from([0, 0, 255, 255])])),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("acTL", actl),
    red[0],
    chunk("IDAT", red[1]),
    chunk("fcTL", blueFc),
    chunk("fdAT", blueData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let side, pixelArt, slim, turned, tiny, moving;
test.beforeAll(async () => {
  test.setTimeout(180000);
  const sideRaw = Buffer.alloc(8193 * 100 * 4);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 8193; x++) {
      const i = (y * 8193 + x) * 4;
      sideRaw[i] = 255;
      sideRaw[i + 3] = x < 400 ? 0 : 255;
    }
  side = file(
    "side.png",
    await sharp(sideRaw, { raw: { width: 8193, height: 100, channels: 4 } })
      .png()
      .toBuffer(),
  );
  const artW = 3000,
    artH = 2000,
    art = Buffer.alloc(artW * artH * 4);
  for (let y = 0; y < artH; y++)
    for (let x = 0; x < artW; x++) {
      const i = (y * artW + x) * 4,
        on = (x ^ y) & 1;
      art[i] = art[i + 1] = art[i + 2] = on ? 0 : 255;
      art[i + 3] = 255;
    }
  pixelArt = file(
    "pixels.png",
    await sharp(art, { raw: { width: artW, height: artH, channels: 4 } })
      .png()
      .toBuffer(),
  );
  slim = file(
    "line.png",
    await sharp({
      create: { width: 16384, height: 1, channels: 4, background: "#112233" },
    })
      .png()
      .toBuffer(),
  );
  const tw = 100,
    th = 9000,
    turnedRaw = Buffer.alloc(tw * th * 3);
  for (let y = 0; y < th; y++) {
    const color = y < th / 2 ? [0, 0, 220] : [0, 220, 0];
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 3;
      turnedRaw[i] = color[0];
      turnedRaw[i + 1] = color[1];
      turnedRaw[i + 2] = color[2];
    }
  }
  turned = file(
    "turned.jpg",
    await sharp(turnedRaw, { raw: { width: tw, height: th, channels: 3 } })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer(),
    "image/jpeg",
  );
  tiny = file(
    "tiny.png",
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#00aa00" },
    })
      .png()
      .toBuffer(),
  );
  moving = file("movie.apng", apng());
});

async function openPanel(page, id) {
  const toggle = page.locator(`.panel[data-panel="${id}"] .panel-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
async function waitOffer(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById("status").textContent || "";
    return (
      document.getElementById("downscaleDialog").open ||
      status.includes("cannot downscale") ||
      status.includes("Could not open") ||
      status.includes("not downscaled") ||
      status.includes("too large")
    );
  });
  return page.locator("#downscaleDialog").evaluate((el) => el.open);
}
async function confirm(page, quality) {
  if (quality)
    await page.locator("#downscaleQuality").selectOption(quality);
  await page
    .locator("#downscaleDialog")
    .getByRole("button", { name: "Downscale" })
    .click();
  await expect(page.locator("#status")).toHaveText(/Opened |Could not open|Left /, {
    timeout: 60000,
  });
  await settled(page, 60000);
}
function pixel(page, x, y) {
  return page.locator("#resultCanvas").evaluate(
    (canvas, point) => {
      const data = canvas
        .getContext("2d")
        .getImageData(point.x, point.y, 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    },
    { x, y },
  );
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/");
  await settled(page);
});

test("an oversized static image offers Smooth, and cancelling lists nothing", async ({
  page,
}) => {
  await openPanel(page, "export");
  await page.locator("#frameScale").selectOption("nearest");
  await page.locator("#fileInput").setInputFiles(side);
  expect(await waitOffer(page)).toBe(true);
  const dialog = page.locator("#downscaleDialog");
  await expect(dialog).toContainText("8193 × 100");
  await expect(dialog).toContainText("8192 × 99");
  await expect(page.locator("#downscaleQuality")).toHaveValue("smooth");
  await expect(page.locator("#frameScale")).toHaveValue("nearest");
  await expect(dialog).toHaveAttribute("aria-labelledby", "downscaleTitle");
  await expect(page.locator("#downscaleDialog button[value=cancel]")).toBeFocused();
  const results = await new AxeBuilder({ page })
    .include("#downscaleDialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.setViewportSize({ width: 360, height: 700 });
  const narrow = await dialog.boundingBox();
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const zoomed = await dialog.boundingBox();
  const view = await page.locator("#viewport").boundingBox();
  expect(zoomed.x).toBeGreaterThanOrEqual(view.x - 1);
  expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(view.x + view.width + 1);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#status")).toContainText("Left side.png unopened");
  await expect(page.locator("#importNotice")).toBeHidden();
  await expect(page.locator("#fileName")).toHaveText("No images open");
  await expect(page.locator("#frameScale")).toHaveValue("nearest");
  await expect(page.locator("#emptyEditor")).toBeVisible();
});

test("confirming opens the proposed size and keeps transparency and export scaling", async ({
  page,
}) => {
  await openPanel(page, "export");
  await page.locator("#frameScale").selectOption("smooth");
  await page.locator("#fileInput").setInputFiles(side);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#status")).toContainText("did not open it at full size");
    await expect(page.locator("#fileDims")).not.toContainText("8193");
    return;
  }
  await expect(page.locator("#downscaleDialog button[value=cancel]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#downscaleDialog button[value=continue]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#status")).toHaveText(/Opened |Could not open/, {
    timeout: 60000,
  });
  await settled(page, 60000);
  if ((await page.locator("#status").textContent()).includes("did not open it at full size")) {
    await expect(page.locator("#fileDims")).not.toContainText("8193");
    return;
  }
  await expect(page.locator("#fileDims")).toHaveText("8192 × 99");
  await expect(page.locator("#status")).toContainText("down from 8193 × 100");
  await expect(page.locator("#importNotice")).toBeHidden();
  await expect(page.locator("#frameScale")).toHaveValue("smooth");
  const clear = await pixel(page, 20, 40);
  const solid = await pixel(page, 4000, 40);
  expect(clear[3]).toBe(0);
  expect(solid[0]).toBeGreaterThan(200);
  expect(solid[3]).toBe(255);
});

test("nearest keeps hard pixel edges and smooth does not", async ({ page }) => {
  await page.locator("#fileInput").setInputFiles(pixelArt);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#status")).toContainText("did not open it at full size");
    return;
  }
  await expect(page.locator("#downscaleDialog")).toContainText("3000 × 2000");
  await expect(page.locator("#downscaleDialog")).toContainText("2508 × 1672");
  await confirm(page, "nearest");
  if ((await page.locator("#status").textContent()).includes("did not open it at full size")) {
    await expect(page.locator("#fileDims")).not.toContainText("3000");
    return;
  }
  await expect(page.locator("#fileDims")).toHaveText("2508 × 1672");
  const hard = await page.locator("#resultCanvas").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let extreme = 0,
      mid = 0;
    for (let y = 0; y < canvas.height; y += 40)
      for (let x = 0; x < canvas.width; x += 40) {
        const r = data[(y * canvas.width + x) * 4];
        if (r < 20 || r > 235) extreme++;
        else if (r > 70 && r < 185) mid++;
      }
    return { extreme, mid };
  });
  expect(hard.extreme).toBeGreaterThan(hard.mid);
  await page.locator("#fileInput").setInputFiles(pixelArt);
  expect(await waitOffer(page)).toBe(true);
  await confirm(page, "smooth");
  const soft = await page.locator("#resultCanvas").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let extreme = 0,
      mid = 0;
    for (let y = 0; y < canvas.height; y += 40)
      for (let x = 0; x < canvas.width; x += 40) {
        const r = data[(y * canvas.width + x) * 4];
        if (r < 20 || r > 235) extreme++;
        else if (r > 70 && r < 185) mid++;
      }
    return { extreme, mid, width: canvas.width };
  });
  expect(soft.width).toBe(2508);
  expect(soft.mid).toBeGreaterThan(soft.extreme);
});

test("a one-pixel side is clamped, and EXIF orientation uses the displayed size", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles(slim);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#status")).toContainText("did not open it at full size");
    return;
  }
  await expect(page.locator("#downscaleDialog")).toContainText("16384 × 1");
  await expect(page.locator("#downscaleDialog")).toContainText("8192 × 1");
  await confirm(page);
  if ((await page.locator("#status").textContent()).includes("did not open it at full size")) {
    await expect(page.locator("#fileDims")).not.toContainText("16384");
    return;
  }
  await expect(page.locator("#fileDims")).toHaveText("8192 × 1");

  await page.locator("#fileInput").setInputFiles(turned);
  expect(await waitOffer(page)).toBe(true);
  await expect(page.locator("#downscaleDialog")).toContainText("9000 × 100");
  await expect(page.locator("#downscaleDialog")).toContainText("8192 × 91");
  await confirm(page, "nearest");
  await expect(page.locator("#fileDims")).toHaveText("8192 × 91");
  await expect(page.locator("#status")).toContainText("down from 9000 × 100");
  // Orientation 6 rotates the stored image 90° clockwise: the stored top
  // (blue) becomes the visual right side, and the stored bottom (green)
  // becomes the visual left side.
  const left = await pixel(page, 200, 45);
  const right = await pixel(page, 7900, 45);
  expect(left[1]).toBeGreaterThan(150);
  expect(left[2]).toBeLessThan(80);
  expect(right[2]).toBeGreaterThan(150);
  expect(right[1]).toBeLessThan(80);
});

test("animated, oversized, and broken files are refused with no downscale offer", async ({
  page,
}) => {
  const cases = [
    [file("anim.gif", gifHeader(9000, 100)), "not downscaled"],
    [file("anim.png", pngHeader(9000, 100, [chunk("acTL", Buffer.alloc(8))])), "not downscaled"],
    [file("too-wide.png", pngHeader(16385, 10)), "too large to downscale"],
    [file("too-many.png", pngHeader(5000, 4000)), "too large to downscale"],
    [file("cut.png", pngHeader(32, 32).subarray(0, 20)), "Truncated"],
    [file("notes.png", Buffer.from("<html>not an image</html>")), "Could not open"],
  ];
  for (const [input, reason] of cases) {
    await page.locator("#fileInput").setInputFiles(input);
    await expect(page.locator("#downscaleDialog")).toBeHidden();
    await expect(page.locator("#status")).toContainText(reason);
    await expect(page.locator("#importNotice")).toContainText(input.name);
    await expect(page.locator("#fileName")).toHaveText("No images open");
  }
  await page.locator("#fileInput").setInputFiles(moving);
  await expect(page.locator("#downscaleDialog")).toBeHidden();
  await expect(page.locator("#fileDims")).toHaveText("1 × 1 · first frame");
  await expect(page.locator("#importNotice")).toBeHidden();
  await page.locator("#fileInput").setInputFiles(tiny);
  await expect(page.locator("#downscaleDialog")).toBeHidden();
  await expect(page.locator("#fileDims")).toHaveText("8 × 8");
});

test("a mixed open keeps successes, skips a cancelled image, and a later open wins", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles([
    tiny,
    side,
    file("broken.png", Buffer.from("<html>nope</html>")),
  ]);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#importNotice")).toContainText("side.png");
    await expect(page.locator("#importNotice")).toContainText("broken.png");
    await expect(page.locator("#fileName")).toHaveText("tiny.png");
    return;
  }
  await expect(page.locator("#fileName")).toHaveText("tiny.png");
  await page.locator("#downscaleDialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#importNotice")).toContainText("broken.png");
  await expect(page.locator("#importNotice")).not.toContainText("side.png");
  await expect(page.locator("#importNotice")).not.toContainText("tiny.png");
  await expect(page.locator("#fileName")).toHaveText("tiny.png");

  await page.locator("#fileInput").setInputFiles(side);
  expect(await waitOffer(page)).toBe(true);
  const queued = page.locator("#fileInput").setInputFiles(heartFile);
  await page.locator("#downscaleDialog").getByRole("button", { name: "Cancel" }).click();
  await queued;
  await expect(page.locator("#fileName")).toHaveText("red_heart.png");
  await expect(page.locator("#importNotice")).toBeHidden();
  await expect(page.locator("#downscaleDialog")).toBeHidden();
});

test("a redraw started while the offer is open is not replaced by that image", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles(
    file(
      "asset.svg",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5" fill="#f00"/></svg>',
      ),
      "image/svg+xml",
    ),
  );
  await expect(page.locator("#fileDims")).toHaveText("512 × 256");
  await settled(page);
  await page.locator("#fileInput").setInputFiles(side);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#fileName")).toHaveText("asset.svg");
    await expect(page.locator("#importNotice")).toContainText("side.png");
    return;
  }
  await page.evaluate(() => {
    const size = document.getElementById("svgSize");
    size.value = "256";
    size.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settled(page);
  await expect(page.locator("#downscaleDialog")).toBeHidden();
  await expect(page.locator("#fileName")).toHaveText("asset.svg");
  await expect(page.locator("#fileDims")).toHaveText("256 × 128");
  await expect(page.locator("#importNotice")).not.toContainText("side.png");
  await expect(page.locator("#status")).not.toContainText("down from");
});

test("Files to ZIP reports each oversized file and does not ask", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles(tiny);
  await settled(page);
  await openPanel(page, "outline");
  await page.locator("#outline").check();
  await settled(page);
  const downloading = page.waitForEvent("download");
  await page.locator("#batchInput").setInputFiles([
    tiny,
    file("wide.png", pngHeader(9000, 100)),
    file("huge.png", pngHeader(5000, 4000)),
  ]);
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("hexshift-batch.zip");
  await expect(page.locator("#downscaleDialog")).toBeHidden();
  const files = unzip(await readFile(await download.path()));
  const errors = files["errors.txt"].toString();
  expect(errors).toContain("wide.png");
  expect(errors).toContain("huge.png");
  expect(errors).toContain("4,194,304");
  expect(errors).toContain("too large to downscale");
  expect(Object.keys(files).some((name) => name.startsWith("tiny-") && name.endsWith(".png"))).toBe(
    true,
  );
  await expect(page.locator("#batchNote")).toContainText("Done: 1 of 3");
});

test("Escape during the offer does not clear a selection", async ({ page }) => {
  await page.locator("#fileInput").setInputFiles(heartFile);
  await settled(page);
  await page.locator("#palette button").first().click();
  await settled(page);
  const coverage = await page.locator("#coverage").textContent();
  expect(coverage).toContain("selected");
  await page.locator("#fileInput").setInputFiles(side);
  if (!(await waitOffer(page))) {
    await expect(page.locator("#fileName")).toHaveText("red_heart.png");
    await expect(page.locator("#coverage")).toHaveText(coverage);
    await expect(page.locator("#importNotice")).toContainText("side.png");
    return;
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#downscaleDialog")).toBeHidden();
  await expect(page.locator("#fileName")).toHaveText("red_heart.png");
  await expect(page.locator("#coverage")).toHaveText(coverage);
  await expect(page.locator("#importNotice")).toBeHidden();
});

test.describe("resized decoding that does not keep the requested size", () => {
  test("a failed probe explains the limit and does not decode the source", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const orig = window.createImageBitmap.bind(window);
      window.createImageBitmap = (source, options) => {
        if (options && Object.prototype.hasOwnProperty.call(options, "resizeWidth"))
          return Promise.reject(new Error("unsupported"));
        return orig(source);
      };
    });
    await page.goto("/");
    await settled(page);
    await page.locator("#fileInput").setInputFiles(side);
    await expect(page.locator("#downscaleDialog")).toBeHidden();
    await expect(page.locator("#status")).toContainText("did not open it at full size");
    await expect(page.locator("#importNotice")).toContainText("side.png");
    await expect(page.locator("#fileName")).toHaveText("No images open");
    await expect(page.locator("#fileDims")).toHaveText("");
  });

  test("a bitmap that is not the proposed size is refused", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.createImageBitmap.bind(window);
      window.createImageBitmap = (source, options) => {
        if (options && Object.prototype.hasOwnProperty.call(options, "resizeWidth")) {
          const canvas = document.createElement("canvas");
          canvas.width = source instanceof HTMLCanvasElement && source.width === 2 ? 1 : 2;
          canvas.height = canvas.width;
          return orig(canvas);
        }
        return orig(source);
      };
    });
    await page.goto("/");
    await settled(page);
    await page.locator("#fileInput").setInputFiles(side);
    expect(await waitOffer(page)).toBe(true);
    await confirm(page);
    await expect(page.locator("#status")).toContainText("did not open it at full size");
    await expect(page.locator("#fileName")).toHaveText("No images open");
    await expect(page.locator("#fileDims")).not.toContainText("8193");
    await expect(page.locator("#importNotice")).toContainText("side.png");
  });
});
