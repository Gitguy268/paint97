// Send to a device: two tabs paired through the dialog, the drawing sent over WebRTC.
import { expect, test, type Page } from "@playwright/test";
import { boot, dialog, drawRect, objectCount, openPaint, watch } from "./helpers.ts";

/** Copy buttons land in window.__copied, which every engine can read back. */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { (window as { __copied?: string }).__copied = text; return Promise.resolve(); } },
    });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as { __copied?: string }).__copied ?? "");

async function fileMenu(page: Page, item: string) {
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

// On a Mac with the application firewall on, the peer-to-peer UDP of
// Playwright's unsigned Chromium between two tabs is dropped (checks go out,
// none arrive). Elsewhere it runs; it has not yet been run in CI.
test("Send to a device carries a drawing to another tab, after it accepts", async ({ page, context }) => {
  test.skip(process.platform === "darwin", "macOS's firewall drops Playwright Chromium's peer traffic");
  await stubClipboard(page);
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await drawRect(page, 200);
  await objectCount(page, 2);

  await fileMenu(page, "Send to a device…");
  const send = dialog(page);
  await send.getByRole("img", { name: "Pairing code" }).waitFor();
  await send.getByRole("button", { name: "Copy link" }).click();
  // Made on localhost, so the symbol holds the bare code for the in-app scanner.
  const link = await copied(page);
  expect(link).toMatch(/^rtc=1o[A-Za-z0-9_-]+$/);

  const other = await context.newPage();
  const problems = watch(other);
  await stubClipboard(other);
  await boot(other);
  await openPaint(other);
  await fileMenu(other, "Receive from a device…");
  const receive = dialog(other);
  await receive.getByLabel("Or paste the code").fill(link);
  await receive.getByRole("button", { name: "Connect" }).click();
  await receive.getByRole("button", { name: "Copy code" }).click();
  const answer = await copied(other);
  expect(answer).toMatch(/^1a[A-Za-z0-9_-]+$/);

  await send.getByLabel("Or paste the code").fill(answer);
  await send.getByRole("button", { name: "Connect" }).click();
  await expect(receive.getByRole("status")).toContainText("Accept “untitled”", { timeout: 20_000 });
  await receive.getByRole("button", { name: "Accept" }).click();

  await objectCount(other, 2);
  await expect(other.locator(".paint .status-bar")).toContainText("Received “untitled”");
  await expect(page.locator(".paint .status-bar")).toContainText("Sent to the other device");
  expect(problems).toEqual([]);
});

test("a #rtc= link opens Receive, and a code that is not one is turned away", async ({ page }) => {
  const problems = watch(page);
  await boot(page, "#rtc=1o<img src=x onerror=window.__xss=1>");
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  expect(page.url()).not.toContain("#rtc=");
  const receive = dialog(page);
  await receive.getByRole("button", { name: "Connect" }).click();
  await expect(receive.getByRole("alert")).toContainText("damaged");
  await receive.locator(".dialog-buttons").getByRole("button", { name: "Close" }).click();
  await expect(receive).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  expect(problems).toEqual([]);
});
