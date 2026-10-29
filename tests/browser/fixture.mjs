// The review image. The app itself opens blank; tests that need a picture open this.
import sample from "../../src/sample.js";

export const heartFile = {
  name: "red_heart.png",
  mimeType: "image/png",
  buffer: Buffer.from(sample.split(",")[1], "base64"),
};

export async function ensureHeart(page) {
  if ((await page.locator("#palette button").count()) > 0) return;
  await page.locator("#fileInput").setInputFiles(heartFile);
}

// Keeps a custom browser context on the full editor. Does not overwrite a
// choice the test already stored, and does not run for a new-profile test.
export async function rememberAdvanced(context) {
  await context.addInitScript(() => {
    if (localStorage.getItem("hexshift-mode") == null)
      localStorage.setItem("hexshift-mode", "advanced");
  });
}
