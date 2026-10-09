// WCAG 2.1 A/AA: axe over every state of Paint97's own chrome, plus the keyboard and
// focus behaviour axe cannot see. Excalidraw's own DOM (.excali-host) is upstream and excluded.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { boot, dialog, openFromStart, openPaint, win } from "./helpers.ts";

const AXE = fs.readFileSync("node_modules/axe-core/axe.min.js", "utf8");
async function axe(page: Page, label: string) {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run(ctx: object, opts: object): Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run({ exclude: [[".excali-host"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`);
  });
  expect(violations, label).toEqual([]);
}

test("axe: desktop, Start menu, every app window and dialogs", async ({ page }) => {
  test.slow();
  await boot(page);
  await page.locator(".clippy").waitFor();
  await axe(page, "desktop + Clippy");

  await page.locator(".start-btn").click();
  await axe(page, "Start menu");
  await page.keyboard.press("Escape");

  await openPaint(page);
  await axe(page, "Paint97");
  await page.getByRole("menuitem", { name: "File" }).click();
  await axe(page, "Paint97 File menu");
  await page.getByRole("menuitem", { name: "Save to My Drawings as…" }).click();
  await axe(page, "Save dialog");
  await page.getByLabel("Name").fill("axe");
  await page.keyboard.press("Enter");

  await page.locator('[data-app="drawings"]').dblclick();
  await win(page, "My Drawings").getByRole("option", { name: /axe/ }).click();
  await axe(page, "My Drawings");
  await win(page, "My Drawings").getByRole("button", { name: "Properties" }).click();
  await axe(page, "Properties dialog");
  await page.keyboard.press("Escape");
  await page.locator('[data-app="bin"]').dblclick();
  await axe(page, "Recycle Bin (empty)");

  await page.locator('[data-app="notepad"]').dblclick();
  await page.getByLabel("Notepad text").press("Control+h");
  await axe(page, "Notepad + replace bar");

  for (const [name, label] of [["Calculator", "Calculator"], ["Minesweeper", "Minesweeper"], ["Clock", "Clock"], ["Control Panel", "Control Panel"], ["Help", "Help"], ["Ask Clippy…", "Ask Clippy"]] as const) {
    await openFromStart(page, name);
    await win(page, name).waitFor();
    await axe(page, label);
  }
});

test("keyboard: desktop icons, Start menu roving, menu bar, Alt+` switcher", async ({ page }) => {
  await boot(page);
  await page.locator('[data-app="paint"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-app="notepad"]')).toBeFocused();
  await page.keyboard.press("Enter");
  const notepad = win(page, /Notepad/);
  await expect(notepad).toBeVisible();

  // Menu bar: one tab stop, arrows rove, Escape returns focus to the bar.
  await notepad.getByRole("menuitem", { name: "File" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(notepad.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(notepad.getByRole("menuitem", { name: "Find…" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(notepad.getByRole("menuitem", { name: "Replace…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(notepad.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await expect(notepad.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("aria-expanded", "false");

  // Start menu: opens focused, arrows move, Escape closes.
  await page.locator(".start-btn").click();
  const first = page.locator(".start-menu").getByRole("menuitem").first();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".start-menu").getByRole("menuitem").nth(1)).toBeFocused();
  await expect(page.locator(".start-btn")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".start-menu")).toHaveCount(0);

  // Window switcher (Alt+` because browsers and OSes swallow Alt+Tab).
  await openFromStart(page, "Calculator");
  await expect(win(page, "Calculator")).not.toHaveClass(/inactive/);
  await page.keyboard.down("Alt");
  await page.keyboard.press("`");
  await expect(page.getByRole("listbox", { name: "Switch window" })).toBeVisible();
  await page.keyboard.up("Alt");
  await expect(notepad).not.toHaveClass(/inactive/);
  await expect(win(page, "Calculator")).toHaveClass(/inactive/);
});

test("dialogs trap Tab, close on Escape and return focus to their opener", async ({ page }) => {
  await boot(page);
  await page.locator('[data-app="drawings"]').dblclick();
  const opener = win(page, "My Drawings").getByRole("button", { name: "New folder" });
  await opener.click();
  const modal = dialog(page);
  await expect(modal.getByLabel("Name")).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await modal.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
});
