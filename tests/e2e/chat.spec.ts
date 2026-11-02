// Ask Clippy without the 1.6 GB model: the model manager runs the real range loader
// against a stubbed Hugging Face, the reply path runs a scripted engine.
import { expect, test } from "@playwright/test";
import { boot, drawRect, objectCount, openFromStart, openPaint, win } from "./helpers.ts";

test("without the model: an offer, a pausable download, and a bad range is refused", async ({ page }) => {
  // Each range arrives slowly, so Pause lands mid-download, and short, which the loader must refuse rather than cache.
  let rangeRequests = 0;
  const ranges: string[] = [];
  await page.route("https://huggingface.co/**", async (route) => {
    rangeRequests++;
    ranges.push(route.request().headers()["range"] ?? "");
    await new Promise<void>((r) => { setTimeout(r, 400); });
    await route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "access-control-allow-origin": "*" }, body: "junk" });
  });
  await boot(page);
  await openFromStart(page, "Ask Clippy…");
  const chat = win(page, "Ask Clippy…");
  await expect(chat).toContainText("Nothing you type ever leaves your computer");
  await chat.getByRole("button", { name: /Download 1573 MB/ }).click();
  await expect(chat.getByRole("progressbar", { name: "Model download" })).toBeVisible();
  await chat.getByRole("button", { name: "Pause" }).click();
  await expect(chat.getByRole("button", { name: /Download|Resume/ })).toBeVisible();
  await chat.getByRole("button", { name: /Download|Resume/ }).click();
  await expect(chat.getByRole("alert")).toContainText("part 1 of 25 came back as 4 bytes", { timeout: 15_000 });
  // The rejected range is not kept: Retry fetches it again instead of failing on a cached copy.
  const before = rangeRequests;
  await chat.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => rangeRequests).toBeGreaterThan(before);
  await expect(chat.getByRole("alert")).toContainText("part 1 of 25 came back as 4 bytes", { timeout: 15_000 });
  // Every request asked for exactly the first 64 MiB of the pinned file.
  expect(new Set(ranges)).toEqual(new Set(["bytes=0-67108863"]));
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

test("Look at my drawing sends the canvas as a picture; Diagram lands Mermaid as shapes after Apply", async ({ page }) => {
  await page.addInitScript(() => {
    const replies = [
      ["I see a box."],
      ["```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```"],
    ];
    const w = globalThis as unknown as { __p97EngineFactory: unknown; __sent: unknown[] };
    w.__sent = [];
    w.__p97EngineFactory = () => ({
      chat: async (messages: { role: string; content: unknown }[], onDelta: (t: string) => void, _s?: AbortSignal, options?: unknown) => {
        const last = messages[messages.length - 1]!;
        const content = Array.isArray(last.content)
          ? last.content.map((p: { type: string; data?: ArrayBuffer; text?: string }) =>
              p.type === "image" ? { type: "image", jpeg: new Uint8Array(p.data!)[0] === 0xff } : p)
          : last.content;
        w.__sent.push({ system: messages[0]!.content, content, options: options ?? null });
        await new Promise<void>((r) => { setTimeout(r, 50); });
        for (const piece of replies.shift() ?? []) onDelta(piece);
      },
    });
  });
  await boot(page);
  await openPaint(page);
  await drawRect(page); // something to look at
  await objectCount(page, 1);

  await openFromStart(page, "Ask Clippy…");
  const chat = win(page, "Ask Clippy…");
  const input = chat.getByLabel("Message to Clippy");
  await input.waitFor({ timeout: 15_000 });

  // 98.css draws the box on the label; the native input underneath is hidden.
  await chat.locator('label[for="chat-look"]').click();
  await expect(chat.getByLabel("Look at my drawing")).toBeChecked();
  await input.fill("what did I draw?");
  await page.keyboard.press("Enter");
  await expect(chat.locator(".chat-msg.assistant")).toContainText("I see a box.");
  const looked = await page.evaluate(() => (globalThis as unknown as { __sent: { content: unknown }[] }).__sent[0]!.content);
  expect(looked).toEqual([{ type: "image", jpeg: true }, { type: "text", text: "what did I draw?" }]);

  await input.fill("login flow");
  await chat.getByRole("button", { name: "Diagram" }).click();
  const ask = page.getByRole("dialog", { name: "Clippy drew a diagram" });
  await expect(ask).toBeVisible();
  const asked = await page.evaluate(() => (globalThis as unknown as { __sent: unknown[] }).__sent[1]);
  expect(asked).toEqual({ system: "Reply with one Mermaid diagram only.", content: "login flow", options: { temperature: 0, max_tokens: 1024 } });
  await objectCount(page, 1); // nothing is drawn before the user agrees
  await ask.getByRole("button", { name: "Apply" }).click();
  // Two labelled boxes and the arrow between them.
  await expect.poll(async () => Number((await page.locator(".paint .status-bar").innerText()).match(/(\d+) object/)?.[1] ?? 0), { timeout: 30_000 }).toBeGreaterThan(3);
});
