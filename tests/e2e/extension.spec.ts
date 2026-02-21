import { test, expect, chromium } from "@playwright/test";
import path from "path";

test.describe("Wakefit Showroom Associate", () => {
  test("extension mounts shadow host on product page", async () => {
    const pathToExtension = path.join(process.cwd(), "dist");

    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    const page = await context.newPage();
    await page.goto("https://www.wakefit.co/mattresses");
    await page.waitForTimeout(2000);

    const host = await page.$("#wakefit-associate-root");
    expect(host).not.toBeNull();

    await context.close();
  });
});
