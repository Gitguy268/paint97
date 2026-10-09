// Ask Clippy with a scripted engine and a seeded model cache: no 253 MB download, no inference.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { boot, objectCount, openFromStart, openPaint, win } from "./helpers.ts";

type Manifest = { sha256: string; repo: string; ref: string; parts: { file: string; bytes: number }[] };
const manifest = JSON.parse(fs.readFileSync("models/manifest.json", "utf8")) as Manifest;

async function seedModel(page: Page) {
  await page.evaluate(async (m) => {
    const cache = await caches.open(`paint97-model-${m.sha256.slice(0, 8)}`);
    for (const p of m.parts) await cache.put(`https://raw.githubusercontent.com/${m.repo}/${m.ref}/models/${p.file}`, new Response(new Uint8Array(0), { headers: { "content-length": String(p.bytes) } }));
  }, manifest);
}

test("without the model: an offer, a pausable download, and nothing sent anywhere", async ({ page }) => {
  // Serve one slow part so Pause lands mid-download; the bytes are junk, which the hash check must reject on resume.
  await page.route("**/models/*.part", async (route) => { await new Promise<void>((r) => { setTimeout(r, 400); }); await route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.alloc(1024) }); });
  await boot(page);
  await openFromStart(page, "Ask Clippy…");
  const chat = win(page, "Ask Clippy…");
  await expect(chat).toContainText("Nothing you type ever leaves your computer");
  await chat.getByRole("button", { name: /Download 253 MB/ }).click();
  await expect(chat.getByRole("progressbar", { name: "Model download" })).toBeVisible();
  await chat.getByRole("button", { name: "Pause" }).click();
  await expect(chat.getByRole("button", { name: /Download|Resume/ })).toBeVisible();
  await chat.getByRole("button", { name: /Download|Resume/ }).click();
  // A part with the wrong bytes is never accepted.
  await expect(chat.getByRole("alert")).toContainText(/bytes|hash|SHA/i, { timeout: 15_000 });
  await expect(chat.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("streaming reply with Stop, then a canvas command behind Apply/Cancel", async ({ page }) => {
  await page.addInitScript(() => {
    const replies = [
      ["This ", "is ", "a ", "long ", "answer ", "that ", "keeps ", "going ", "and ", "going."],
      ["Sure! ", 'Here it is. <canvas>{"tool":"rectangle","x":40,"y":40,"w":120,"h":80,"stroke":"#1e1e1e","fill":"#a5d8ff"}</canvas>'],
      ["Again. ", '<canvas>{"tool":"ellipse","x":300,"y":40,"w":90,"h":90,"stroke":"#e03131","fill":"transparent"}</canvas>'],
    ];
    (globalThis as unknown as { __p97EngineFactory: unknown }).__p97EngineFactory = () => ({
      chat: async (_m: unknown, onDelta: (t: string) => void, signal?: AbortSignal) => {
        for (const piece of replies.shift() ?? []) {
          await new Promise<void>((r) => { setTimeout(r, 150); });
          if (signal?.aborted) throw new DOMException("stopped", "AbortError");
          onDelta(piece);
        }
      },
    });
  });
  await boot(page);
  await seedModel(page);
  await openPaint(page);
  await openFromStart(page, "Ask Clippy…");
  const chat = win(page, "Ask Clippy…");
  const input = chat.getByLabel("Message to Clippy");
  await input.waitFor({ timeout: 15_000 });

  await input.fill("talk a lot");
  await page.keyboard.press("Enter");
  await expect(chat.locator(".chat-msg.assistant")).toContainText("This is");
  await chat.getByRole("button", { name: "Stop" }).click();
  await expect(chat.getByRole("button", { name: "Send" })).toBeVisible();
  const partial = await chat.locator(".chat-msg.assistant").innerText();
  expect(partial).toContain("This is");
  expect(partial).not.toContain("going."); // Stop keeps what arrived, nothing more

  await input.fill("draw a box");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "Clippy wants to draw" });
  await expect(ask).toContainText(/rectangle/i);
  await expect(chat.locator(".chat-log")).not.toContainText("<canvas>"); // raw JSON never reaches the transcript
  await objectCount(page, 0); // nothing is drawn before the user agrees
  await ask.getByRole("button", { name: "Cancel" }).click();
  await objectCount(page, 0);

  await input.fill("draw a circle");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Clippy wants to draw" }).getByRole("button", { name: "Apply" }).click();
  await objectCount(page, 1);
});
