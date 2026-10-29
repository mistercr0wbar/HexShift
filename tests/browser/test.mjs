// Existing editor tests start in Advanced. A brand-new profile opens in Simple,
// and that question would hide the tools those tests click. A context that
// builds its own page does not get this; call rememberAdvanced for those.
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("hexshift-mode") == null)
        localStorage.setItem("hexshift-mode", "advanced");
    });
    await use(page);
  },
});

export { expect };
