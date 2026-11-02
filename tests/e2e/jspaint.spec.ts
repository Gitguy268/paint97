// JS Paint: the self-hosted copy runs framed under the production CSP without leaving the origin,
// keeps its picture when its window is closed, and behaves like any other window: a click inside
// the frame activates it and closes the Start menu, the shell's shortcuts work from inside it, Tab gets
// back out, drags survive crossing the frame, File > Exit closes it, and it works offline.
import { expect, test, type Page } from "@playwright/test";
import { boot, openFromStart, watch, win } from "./helpers.ts";

const frame = (page: Page) => page.frameLocator("iframe.jspaint");
const canvas = (page: Page) => frame(page).locator(".main-canvas");
const open = async (page: Page) => {
  await openFromStart(page, "JS Paint");
  await canvas(page).waitFor({ timeout: 30_000 });
};
/** True once any pixel of JS Paint's canvas is not white. */
const inked = (page: Page) => canvas(page).evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.some((v) => v !== 255));
const box = async (target: ReturnType<Page["locator"]>) => (await target.boundingBox())!;
/** What JS Paint has autosaved: one data URL per picture, under a key of its own. */
const autosaved = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("image#")).map((k) => localStorage.getItem(k)).join());

test("draws under the production CSP, keeps the picture across a close, and File > Exit closes the window", async ({ page }) => {
  const problems = watch(page);
  const external: string[] = [];
  page.on("request", (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await boot(page);
  await open(page);

  await expect.poll(() => autosaved(page)).not.toBe(""); // the empty canvas, saved as the session starts
  const blank = await autosaved(page);
  const c = await box(canvas(page));
  await page.mouse.move(c.x + 20, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBe(true);
  await expect.poll(() => autosaved(page)).not.toBe(blank); // JS Paint saves a moment after each stroke

  await win(page, "JS Paint").getByRole("button", { name: "Close" }).click();
  await expect(win(page, "JS Paint")).toHaveCount(0);
  await open(page);
  await expect.poll(() => inked(page)).toBe(true);

  await frame(page).locator(".menu-button", { hasText: "File" }).click();
  // Greyed out by the build: it would send the picture to another site.
  await expect(frame(page).locator(".menu-item", { hasText: "Upload To Imgur" })).toHaveAttribute("aria-disabled", "true");
  await frame(page).locator(".menu-item", { hasText: "Exit" }).click();
  await expect(win(page, "JS Paint")).toHaveCount(0);
  expect(external).toEqual([]);
  expect(problems).toEqual([]);
});

test("drags keep going across the frame, and clicks and shell shortcuts inside it reach the desktop", async ({ page }) => {
  await boot(page);
  await open(page);
  await page.locator('[data-app="notepad"]').dblclick();
  const paint = win(page, "JS Paint");
  const notepad = win(page, /Notepad/);
  await expect(paint).toHaveClass(/inactive/);
  await canvas(page).evaluate((c) => { c.dataset.kept = ""; });

  // Notepad's title bar to the far corner of the frame in one jump, so the pointer is over the
  // frame, with nothing of the host page under it, before Notepad has moved there.
  const f = await box(page.locator("iframe.jspaint"));
  const corner = { x: f.x + f.width - 30, y: f.y + f.height - 30 };
  const n = await box(notepad);
  expect(corner.x > n.x + n.width || corner.y > n.y + n.height).toBe(true);
  const title = await box(notepad.locator(".title-bar-text"));
  const from = { x: title.x + 10, y: title.y + title.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.up();
  const moved = await box(notepad);
  expect(Math.round(moved.x - n.x)).toBe(Math.round(corner.x - from.x));
  expect(Math.round(moved.y - n.y)).toBe(Math.round(corner.y - from.y));

  // Notepad has left the frame's near corner uncovered.
  await expect(paint).toHaveClass(/inactive/);
  await page.locator(".start-btn").click();
  await expect(page.getByRole("menuitem", { name: "Notepad" })).toBeVisible();
  await page.mouse.click(f.x + 40, f.y + f.height - 12);
  await expect(paint).not.toHaveClass(/inactive/);
  await expect(page.getByRole("menuitem", { name: "Notepad" })).toHaveCount(0);

  // The click also put the keyboard inside the frame, where the shell's own key listeners hear nothing.
  const inFrame = () => page.evaluate(() => document.activeElement?.matches("iframe.jspaint") ?? false);
  await expect.poll(inFrame).toBe(true);
  // Coming to the front must not reload the frame: that would drop JS Paint's undo history and open dialogs.
  expect(await canvas(page).evaluate((c) => "kept" in c.dataset)).toBe(true);
  await page.keyboard.down("Alt");
  await page.keyboard.press("`");
  await expect(page.locator(".switcher")).toBeVisible();
  await page.keyboard.up("Alt");
  await expect(notepad).not.toHaveClass(/inactive/);

  // Not a keyboard trap: Tab walks into the frame, and on through it back to the desktop.
  await paint.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Tab");
  expect(await inFrame()).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(paint.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Tab");
  let presses = 0;
  while (await inFrame() && presses++ < 200) await page.keyboard.press("Tab");
  expect(await inFrame()).toBe(false);

  // Shrinking JS Paint from its right edge drags the pointer over its own frame.
  const before = await box(paint);
  const edge = await box(paint.locator(".rz-e"));
  await page.mouse.move(edge.x + edge.width / 2, before.y + 300);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 200, before.y + 300);
  await page.mouse.up();
  expect(Math.round((await box(paint)).width)).toBe(Math.round(before.width - 200));
});

test("offline: the frame does not replace the cached shell, and JS Paint still opens", async ({ page, context }) => {
  await boot(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.locator(".desktop").waitFor();
  // Only now does the frame's page load go through the worker; opened earlier, this test would prove nothing.
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await open(page);
  const cached = (url: string) => page.evaluate(async (u) => {
    for (const key of await caches.keys()) {
      const hit = await (await caches.open(key)).match(u);
      if (hit) return hit.text();
    }
    return "";
  }, url);
  await expect.poll(() => cached("/jspaint/index.html")).toContain("JS Paint");
  expect(await cached("/index.html")).toContain('<div id="root"');
  // Opened in a tab of its own it is a top-level page, and still not the shell.
  await page.goto("/jspaint/index.html");
  await page.locator(".main-canvas").waitFor();
  expect(await cached("/index.html")).toContain('<div id="root"');
  await boot(page);

  await context.setOffline(true);
  await page.reload();
  await page.locator(".desktop").waitFor();
  await canvas(page).waitFor({ timeout: 30_000 }); // the window layout is restored, and its files come from the worker's cache
  await context.setOffline(false);
});
