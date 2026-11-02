import { expect, test } from "@playwright/test";
import { boot, watch, win } from "./helpers.ts";

test("classic assets load, Start keeps keyboard focus, and BrowserFS migrates then saves on close", async ({ page }) => {
  const problems = watch(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("paint97.retro-test-seeded")) {
      localStorage.setItem("paint97.retro-test-seeded", "1");
      localStorage.setItem("paint97.notepad.v1", "legacy note");
      localStorage.setItem("paint97.notepad.name.v1", "legacy.txt");
    }
  });
  await boot(page);
  await expect(page.locator('[data-app="notepad"] img')).toHaveAttribute("src", /icons\/win98\/notepad/);
  await expect(page.locator(".start-btn img")).toHaveAttribute("src", /icons\/retrobar\/start9x.png/);
  await expect.poll(() => page.locator(".desktop-icons img").evaluateAll((images) => images.every((im) => (im as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator(".start-btn").click();
  await expect(page.locator('.start-menu [tabindex="0"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator('[data-app="notepad"]').dblclick();
  const text = page.getByLabel("Notepad text");
  await expect(text).toBeEnabled();
  await expect(text).toHaveValue("legacy note");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("paint97.notepad.v1"))).toBeNull();
  await text.fill("BrowserFS survives close and reload 🐈");
  await win(page, /Notepad/).getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('[data-app="notepad"]').dblclick();
  await expect(text).toBeEnabled();
  await expect(text).toHaveValue("BrowserFS survives close and reload 🐈");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("paint97.notepad.v1"))).toBeNull();
  await page.reload();
  await expect(page.getByLabel("Notepad text")).toHaveValue("BrowserFS survives close and reload 🐈");
  expect(problems).toEqual([]);
});

test("Notepad keeps a durable legacy fallback when IndexedDB is unavailable", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true }); });
  await boot(page);
  await page.locator('[data-app="notepad"]').dblclick();
  await expect(page.getByLabel("Notepad text")).toBeEnabled();
  await page.getByLabel("Notepad text").fill("fallback note");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("paint97.notepad.v1"))).toBe("fallback note");
  await page.reload();
  await expect(page.getByLabel("Notepad text")).toHaveValue("fallback note");
});

test("first Notepad open works offline with precached BrowserFS and classic icons", async ({ page, context }) => {
  const problems = watch(page);
  await boot(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.locator(".desktop").waitFor();
  await expect.poll(() => page.locator(".desktop-icons img").evaluateAll((images) => images.every((im) => (im as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('[data-app="notepad"]').dblclick();
  await expect(page.getByLabel("Notepad text")).toBeEnabled();
  await page.getByLabel("Notepad text").fill("saved offline");
  await win(page, /Notepad/).getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('[data-app="notepad"]').dblclick();
  await expect(page.getByLabel("Notepad text")).toHaveValue("saved offline");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("paint97.notepad.v1"))).toBeNull();
  await page.reload();
  await expect(page.getByLabel("Notepad text")).toHaveValue("saved offline");
  expect(problems).toEqual([]);
});
