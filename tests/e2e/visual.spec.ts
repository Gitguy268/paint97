// Visual regression: five stable states of a fresh profile. Baselines are per platform
// (font rasterisation differs): CI owns the Linux set, local runs write their own.
// Anything driven by a clock is masked; reduced motion keeps Clippy and the boot screen still.
import { expect, test, type Page } from "@playwright/test";
import { boot, drawRect, openFromStart, openPaint, tool, win } from "./helpers.ts";

test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
const shot = async (page: Page, name: string) => {
  await page.locator(".clippy").waitFor();
  await expect(page).toHaveScreenshot(name, { mask: [page.locator(".tray time"), page.locator(".clippy-balloon"), page.locator(".exp-row span:nth-child(3)")] });
};

test("desktop", async ({ page }) => { await boot(page); await shot(page, "desktop.png"); });

test("paint with a drawing", async ({ page }) => {
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await tool(page, "Select").click();
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);
  await shot(page, "paint.png");
});

test("my drawings folder", async ({ page }) => {
  await boot(page);
  await page.locator('[data-app="drawings"]').dblclick();
  await win(page, "My Drawings").getByRole("button", { name: "New folder" }).click();
  await page.keyboard.press("Enter");
  await win(page, "My Drawings").getByRole("option", { name: /New Folder/ }).click();
  await shot(page, "folder.png");
});

test("calculator", async ({ page }) => {
  await boot(page);
  await openFromStart(page, "Calculator");
  await page.keyboard.type("12*3");
  await shot(page, "calculator.png");
});

test("control panel", async ({ page }) => {
  await boot(page);
  await openFromStart(page, "Control Panel");
  await win(page, "Control Panel").waitFor();
  await shot(page, "settings.png");
});
