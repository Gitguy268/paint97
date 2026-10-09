// The choppy rules, measured in a real browser (the unit tests prove them on a fake clock).
import { expect, test } from "@playwright/test";
import { boot, openPaint, tool } from "./helpers.ts";

test("Clippy steps frames at 8-12 fps, never tweens, and stays pixelated", async ({ page }) => {
  await boot(page);
  const clippy = page.locator(".clippy");
  await clippy.waitFor();
  await page.locator(".clippy-balloon.show").waitFor(); // first visit: greeting + tip of the day
  await expect(page.locator(".clippy-balloon")).toContainText("Tip of the day", { timeout: 20_000 });

  // Sample every sprite-cell change during a click animation.
  const stamps = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const sprite = document.querySelector<HTMLElement>(".clippy-sprite")!;
    const times: number[] = [];
    let last = sprite.style.backgroundPosition;
    const mo = new MutationObserver(() => { if (sprite.style.backgroundPosition !== last) { last = sprite.style.backgroundPosition; times.push(performance.now()); } });
    mo.observe(sprite, { attributes: true, attributeFilter: ["style"] });
    document.querySelector<HTMLElement>(".clippy")!.click();
    setTimeout(() => { mo.disconnect(); resolve(times); }, 3000);
  }));
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!);
  expect(gaps.length).toBeGreaterThan(5);
  // 12 fps = 83 ms per frame is the fastest the engine may ever step (small tolerance for timer jitter).
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(75);

  const css = await page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const sprite = cs(".clippy-sprite");
    return { rootT: cs(".clippy").transitionDuration, spriteT: sprite.transitionDuration, balloonT: cs(".clippy-balloon").transitionDuration, anim: sprite.animationName, rendering: sprite.imageRendering, width: parseFloat(sprite.width), left: document.querySelector<HTMLElement>(".clippy")!.style.left };
  });
  expect([css.rootT, css.spriteT, css.balloonT]).toEqual(["0s", "0s", "0s"]);
  expect(css.anim).toBe("none");
  expect(css.rendering).toBe("pixelated");
  expect([124, 248, 372, 496]).toContain(css.width); // 124 px frame × integer scale 1-4
  expect(css.left).toMatch(/^\d+px$/); // whole pixels only
});

test("Clippy reacts to context, is keyboard-operable, and announces through a live region", async ({ page }) => {
  await boot(page);
  await page.locator(".clippy").waitFor();
  await openPaint(page);
  await tool(page, "Arrow").click(); // first use of a tool
  const live = page.locator('body > [role="status"][aria-live="polite"]');
  await expect(live).toContainText(/arrow/i, { timeout: 20_000 });

  const clippy = page.getByRole("button", { name: /Clippy/ });
  await clippy.focus();
  const before = await clippy.boundingBox();
  await page.keyboard.press("ArrowLeft");
  expect((await clippy.boundingBox())!.x).toBe(before!.x - 16);
  await page.keyboard.press("Enter"); // keyboard activation = a tip, same as a click
  await expect(live).not.toContainText("Arrows snap onto shapes", { timeout: 20_000 });

  // Dragging far past the corner clamps to the viewport edge.
  const b = (await clippy.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 3 });
  await page.mouse.up();
  expect(await clippy.boundingBox()).toMatchObject({ x: 5, y: 5 });
});

test("reduced motion: Clippy holds still", async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await boot(page);
  await page.locator(".clippy").waitFor();
  await page.waitForTimeout(500);
  const changes = await page.evaluate(() => new Promise<number>((resolve) => {
    let n = 0;
    const mo = new MutationObserver(() => { n++; });
    mo.observe(document.querySelector(".clippy-sprite")!, { attributes: true, attributeFilter: ["style"] });
    setTimeout(() => { mo.disconnect(); resolve(n); }, 7000); // longer than the 3-6 s blink window
  }));
  expect(changes).toBe(0);
  await page.context().close();
});
