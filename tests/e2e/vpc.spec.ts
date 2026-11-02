// PC Emulator: v86 boots the bundled FreeDOS floppy under the production CSP, boots a picked image,
// takes keys only while its screen has focus (Ctrl+Alt releases them), and pauses when another window is active.
import { expect, test } from "@playwright/test";
import { boot, openFromStart, watch, win } from "./helpers.ts";

test("boots FreeDOS, types into it, and hands the keyboard back to other apps", async ({ page }) => {
  const problems = watch(page);
  await boot(page);
  await openFromStart(page, "PC Emulator");
  const pc = win(page, "PC Emulator");
  const screen = pc.getByRole("application");
  await expect(screen).toContainText("A:\\>", { timeout: 60_000 });
  await expect(screen).toBeFocused();

  // The guest takes Tab; Ctrl+Alt is the way out, after which keys act on the page again.
  await page.keyboard.press("Tab");
  await expect(screen).toBeFocused();
  await page.keyboard.press("Control+Alt");
  await expect(pc.getByRole("button", { name: "Open disk image…" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pc.getByRole("button", { name: "Restart" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(screen).toBeFocused();

  // Typed after the chord: a Ctrl or Alt left held down in the guest would garble this.
  await page.keyboard.type("ver");
  await page.keyboard.press("Enter");
  await expect(screen).toContainText("FreeCom version");

  // Open disk image…: the machine is rebuilt around the picked file.
  await pc.locator('input[type="file"]').setInputFiles("public/v86/freedos.img");
  await expect(pc.getByRole("status")).toHaveText("Running freedos.img. Ctrl+Alt releases the keyboard.", { timeout: 60_000 });
  await expect(screen).toContainText("A:\\>");

  await page.locator('[data-app="notepad"]').dblclick();
  const note = page.getByLabel("Notepad text");
  await note.click();
  await page.keyboard.type("dir");
  await expect(note).toHaveValue(/dir$/); // after Notepad's welcome text
  await expect(pc.getByRole("status")).toHaveText("Paused while another window is active");
  expect(problems).toEqual([]);
});
