// The product's spine: boot → draw → save → recycle → restore, share links, offline, and the security posture.
import { expect, test } from "@playwright/test";
import { boot, dialog, drawRect, objectCount, openPaint, raise, watch, win } from "./helpers.ts";

test("boot → draw → save → recycle → undo → restore → reopen", async ({ page }) => {
  const problems = watch(page);
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await objectCount(page, 1);

  await page.keyboard.press("Control+s");
  await page.getByLabel("Name").fill("My cat");
  await page.keyboard.press("Enter");
  await expect(page.locator(".paint .status-bar")).toContainText("Saved “My cat”");
  await expect(win(page, "My cat - Paint97")).toBeVisible();

  await page.locator('[data-app="drawings"]').dblclick();
  const folder = win(page, "My Drawings");
  const row = folder.getByRole("option", { name: /My cat/ });
  await row.click();
  await page.keyboard.press("Delete");
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Control+z"); // undo the recycle
  await expect(row).toHaveCount(1);
  await row.click();
  await page.keyboard.press("Delete");

  await page.locator('[data-app="bin"]').dblclick();
  const bin = win(page, "Recycle Bin");
  await bin.getByRole("option", { name: /My cat/ }).click();
  await bin.getByRole("button", { name: "Restore" }).click();
  await expect(bin.getByRole("option", { name: /My cat/ })).toHaveCount(0);
  await expect(row).toHaveCount(1);

  // Clear the canvas, then reopen the restored file from the folder.
  await raise(page, /Paint97/);
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New" }).click();
  await dialog(page).getByRole("button", { name: "OK" }).click();
  await objectCount(page, 0);
  await raise(page, "My Drawings");
  await row.dblclick();
  await objectCount(page, 1);

  // The drawing and the window layout both survive a reload.
  await page.reload();
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  await objectCount(page, 1);
  await expect(win(page, "My Drawings")).toBeVisible();
  expect(problems).toEqual([]);
});

test("folders, F2 rename, properties and previous versions", async ({ page }) => {
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await page.keyboard.press("Control+s");
  await page.getByLabel("Name").fill("plan");
  await page.keyboard.press("Enter");
  await expect(page.locator(".paint .status-bar")).toContainText("Saved");
  await drawRect(page, 180);
  await objectCount(page, 2);
  await page.keyboard.press("Control+s"); // second save = second version
  await expect(page.locator(".paint .status-bar")).toContainText("Saved");

  await page.locator('[data-app="drawings"]').dblclick();
  const folder = win(page, "My Drawings");
  await folder.getByRole("button", { name: "New folder" }).click();
  await dialog(page).getByLabel("Name").fill("Work");
  await page.keyboard.press("Enter");
  await folder.getByRole("option", { name: /plan/ }).click();
  await page.keyboard.press("F2");
  await dialog(page).getByLabel("Name").fill("roadmap");
  await page.keyboard.press("Enter");
  const file = folder.getByRole("option", { name: /roadmap/ });
  await expect(file).toBeVisible();

  // Keyboard move: cut, enter the folder, paste.
  await file.click();
  await page.keyboard.press("Control+x");
  await folder.getByRole("option", { name: /Work/ }).dblclick();
  await expect(folder.locator(".exp-address")).toContainText("My Drawings \\ Work");
  await folder.getByRole("listbox").focus();
  await page.keyboard.press("Control+v");
  await expect(file).toBeVisible();

  await file.click();
  await folder.getByRole("button", { name: "Properties" }).click();
  const props = dialog(page);
  await expect(props).toContainText("My Drawings \\ Work");
  await expect(props.getByRole("button", { name: "Restore" })).toHaveCount(2);
  await props.getByRole("button", { name: "Restore" }).last().click(); // oldest version: one rectangle
  await objectCount(page, 1);
});

test("share link round-trips a drawing into a fresh profile", async ({ page, browser }) => {
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await drawRect(page, 200);
  await objectCount(page, 2);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Copy share link" }).click();
  await expect(page.locator(".paint .status-bar")).toContainText("Share link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#scene=");

  const other = await (await browser.newContext()).newPage();
  const problems = watch(other);
  await other.goto(url);
  await other.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  await objectCount(other, 2);
  expect(other.url()).not.toContain("#scene=");
  expect(problems).toEqual([]);
  await other.context().close();
});

test("hostile input: bad share links and scene files are refused without executing anything", async ({ page }) => {
  const problems = watch(page);
  await boot(page, "#scene=AAAA<img src=x onerror=window.__xss=1>");
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  await expect(page.locator(".paint .status-bar")).toContainText("invalid or too large");
  await page.locator('.paint input[type="file"]').setInputFiles({ name: "evil.excalidraw", mimeType: "application/json", buffer: Buffer.from('{"elements":"<script>window.__xss=1</script>"}') });
  await expect(page.locator(".paint .status-bar")).toContainText("Could not open");
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  expect(problems).toEqual([]);
});

test("security headers: strict CSP, no inline or third-party script", async ({ page }) => {
  const res = await page.goto("/");
  const h = res!.headers();
  const csp = h["content-security-policy"]!;
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' https:\/\/cdn\.jsdelivr\.net\/npm\/clippyjs@\d+\.\d+\.\d+\/;/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'|script-src[^;]*'unsafe-eval'/);
  expect(csp).toContain("font-src 'self' data:;");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");

  // Everything the app loads on a full tour stays on this origin.
  const external: string[] = [];
  page.on("request", (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await boot(page);
  await openPaint(page);
  await page.locator(".clippy").waitFor();
  await drawRect(page);
  expect(external).toEqual([]);
});

test("offline: the shell, Paint and the saved drawing survive a reload with no network", async ({ page, context }) => {
  await boot(page);
  await openPaint(page);
  await drawRect(page);
  await objectCount(page, 1);
  await page.waitForTimeout(900); // autosave debounce
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // second load is served through the worker, filling its cache with what Paint uses
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.locator(".desktop").waitFor();
  await page.locator(".excalidraw canvas.interactive").waitFor({ timeout: 30_000 });
  await objectCount(page, 1);
  await page.locator(".clippy").waitFor(); // vendored assets come from the worker cache, no CDN needed

  // Shell only: the worker never holds the model.
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).filter((k) => k.startsWith("paint97-shell-")).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat());
  expect(cached.some((u) => u.includes("/models/"))).toBe(false);
  await context.setOffline(false);
});

test("settings: language, wallpaper and a full backup → reset → restore cycle", async ({ page }) => {
  await boot(page);
  await page.locator(".start-btn").click();
  await page.getByRole("menuitem", { name: "Notepad" }).click();
  await page.getByLabel("Notepad text").fill("remember the milk");
  await page.waitForTimeout(700);
  await page.locator(".start-btn").click();
  await page.getByRole("menuitem", { name: "Control Panel" }).click();
  await page.getByLabel("Language").selectOption("nl");
  await expect(page.locator(".start-btn")).toHaveText("Start");
  await expect(win(page, "Configuratiescherm")).toBeVisible();
  await page.getByLabel("Taal").selectOption("en");
  await page.getByLabel("Wallpaper").selectOption("midnight");

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup…" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^paint97-backup-\d{4}-\d\d-\d\d\.json$/);
  const file = await dl.path();

  await page.getByRole("button", { name: "Reset all data…" }).click();
  await Promise.all([page.waitForEvent("load"), dialog(page).getByRole("button", { name: "OK" }).click()]);
  await page.locator(".desktop").waitFor();
  expect(await page.evaluate(() => localStorage.getItem("paint97.notepad.v1"))).toBeNull();

  await page.locator(".start-btn").click();
  await page.getByRole("menuitem", { name: "Control Panel" }).click();
  await page.getByLabel("Import backup…", { exact: true }).last().setInputFiles(file);
  await dialog(page).getByRole("button", { name: "OK" }).click();
  await page.waitForFunction(() => localStorage.getItem("paint97.notepad.v1") === "remember the milk");
  await page.locator(".desktop").waitFor();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("paint97.settings.v1")!).wallpaper)).toBe("midnight");
});
