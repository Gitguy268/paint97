import { expect, type Page } from "@playwright/test";

/** Console/CSP noise collector: a spec asserts `problems` is empty at the end. */
export function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    // frame-ancestors can only come from an HTTP header; browsers log that for the <meta> copy.
    if (m.type() === "error" && !/is ignored when delivered via a <meta> element/.test(t)) problems.push(t);
  });
  return problems;
}

export async function boot(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  await page.locator(".desktop").waitFor({ timeout: 30_000 });
}

/** Paint97's own modal (Excalidraw renders role=dialog popovers of its own). */
export const dialog = (page: Page) => page.locator(".window.dialog");
export const win = (page: Page, title: string | RegExp) => page.locator("section.win", { has: page.locator(".title-bar-text", { hasText: title }) });

export async function openFromStart(page: Page, name: string) {
  await page.locator(".start-btn").click();
  await page.getByRole("menuitem", { name }).click();
}

export async function openPaint(page: Page) {
  await page.locator('[data-app="paint"]').dblclick();
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
}

export const tool = (page: Page, name: string) => page.locator(".tool-strip").getByRole("button", { name, exact: true });

/** Drag out one rectangle on the canvas. */
export async function drawRect(page: Page, dx = 0) {
  const rect = tool(page, "Rectangle");
  // Excalidraw drops back to Select after each shape and while it is still mounting,
  // so pick the tool until it sticks, and wait for it to release afterwards.
  await expect(async () => { await rect.click(); await expect(rect).toHaveAttribute("aria-pressed", "true", { timeout: 400 }); }).toPass();
  const box = (await page.locator(".excali-host").boundingBox())!;
  // Start right of Excalidraw's shape-properties panel, which covers the canvas's left edge while a shape tool is active.
  await page.mouse.move(box.x + 320 + dx, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 460 + dx, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await expect(rect).toHaveAttribute("aria-pressed", "false");
}
export const objectCount = (page: Page, n: number) => expect(page.locator(".paint .status-bar")).toContainText(`${n} object(s)`);
/** Bring a window to the front the way a user would when it is buried: its taskbar button. */
export const raise = (page: Page, title: string | RegExp) => page.locator(".task-items").getByRole("button", { name: title }).click();
