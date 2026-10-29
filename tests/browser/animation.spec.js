import { expect, test } from "@playwright/test";

test("the animation prototype runs from one file and does not use the network", async ({ page }) => {
  const urls = [];
  page.on("request", (request) => urls.push(new URL(request.url()).pathname));
  await page.goto("/animation-prototype.html");
  await page.getByRole("button", { name: "Run the built-in sample" }).click();
  await expect(page.locator("#result")).toContainText("GIF 2 frames match. WebP 2 frames match. libwebp 1.1.0.", {
    timeout: 30000,
  });
  expect(urls).toEqual(["/animation-prototype.html"]);
  const aborted = await page.evaluate(async () => {
    const signal = AbortSignal.abort();
    try {
      await window.hexshiftAnimation.decodeAnimation(
        await window.hexshiftAnimation.encodeAnimation("gif", {
          width: 2,
          height: 2,
          frames: [
            { data: new Uint8ClampedArray(16).fill(255), durationMs: 10 },
            { data: new Uint8ClampedArray(16).fill(255), durationMs: 10 },
          ],
        }),
        { signal },
      );
      return "published";
    } catch (error) {
      return error.name;
    }
  });
  expect(aborted).toBe("AbortError");
});
