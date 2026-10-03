import { expect, type Page, test } from "@playwright/test";

async function createText(page: Page, body: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first text", exact: true })
    .click();
  await page.getByLabel("Text title", { exact: true }).fill("Tracking review");
  await page.getByLabel("Text body", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks: 2 issues");
}

async function pauseChecks(page: Page) {
  const time = new Date("2026-10-04T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

for (const width of [1280, 390]) {
  test(`unaffected marks and messages follow keyboard edits before reanalysis at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const original = "teh and adress.";
    await createText(page, original);
    const snapshot = await page.evaluate(() =>
      localStorage.getItem("quadruple-quotes.workspace.v1"),
    );
    await pauseChecks(page);
    const body = page.getByLabel("Text body", { exact: true });
    const marks = page.locator(".inline-diagnostic");
    await body.focus();
    await page.keyboard.press("Home");
    await page.keyboard.insertText("📝 日本語\n\n");
    await expect(body).toHaveValue(`📝 日本語\n\n${original}`);
    await expect(marks).toHaveText(["teh", "adress"]);
    const prefixed = await body.inputValue();
    await expect(marks.first()).toHaveAttribute(
      "data-start",
      String(prefixed.indexOf("teh")),
    );
    const box = await marks.last().boundingBox();
    if (!box) throw new Error("Missing tracked mark");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Possible typo: adress");
    await expect(tooltip).toContainText("Rechecking…");
    await page.screenshot({ path: `.tmp/diagnostic-tracking-${width}.png` });
    await body.evaluate((input: HTMLTextAreaElement) => {
      input.setSelectionRange(
        input.value.indexOf("teh"),
        input.value.indexOf("teh") + 3,
      );
    });
    await page.keyboard.insertText("the");
    await expect(marks).toHaveText("adress");
    await expect(tooltip).toHaveCount(0);
    await body.evaluate((input: HTMLTextAreaElement) =>
      input.setSelectionRange(input.value.length, input.value.length),
    );
    await page.keyboard.insertText(" teh");
    // The new typo is only underlined once its current revision is checked.
    await expect(marks).toHaveText("adress");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("quadruple-quotes.workspace.v1"),
      ),
    ).toBe(snapshot);
    await page.clock.runFor(400);
    await expect(
      page.getByRole("button", { name: "Open proofreading issues" }),
    ).toHaveText("Checks: 2 issues");
    await expect(marks).toHaveText(["adress", "teh"]);
  });
}

test("IME preserves distant marks, suppresses tooltips, and resumes with current ranges", async ({
  page,
}) => {
  await createText(page, "teh\n\nadress");
  await pauseChecks(page);
  const body = page.getByLabel("Text body", { exact: true });
  const marks = page.locator(".inline-diagnostic");
  await body.dispatchEvent("compositionstart", { bubbles: true });
  await expect(marks).toHaveText(["teh", "adress"]);
  await body.fill("the\n\n日本語 adress");
  await expect(marks).toHaveText("adress");
  const box = await marks.boundingBox();
  if (!box) throw new Error("Missing composition mark");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks paused while typing");
  await body.dispatchEvent("compositionend", { bubbles: true });
  await expect(marks).toHaveText("adress");
  await page.clock.runFor(400);
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks: 1 issue");
  await expect(marks).toHaveAttribute(
    "data-start",
    String("the\n\n日本語 ".length),
  );
});

test("rule and format changes invalidate provisional marks immediately", async ({
  page,
}) => {
  await createText(page, "teh and adress.");
  // Load the catalog before pausing timers.
  await page.getByRole("button", { name: "Proofreading", exact: true }).click();
  await page.getByText("Rules and plugins", { exact: true }).click();
  const typos = page.locator(".analysis-plugin").filter({ hasText: "Typos" });
  await typos.locator("summary").click();
  await expect(
    typos.getByRole("checkbox", { name: "Spelling", exact: true }),
  ).toBeVisible();
  await pauseChecks(page);
  await typos
    .getByRole("checkbox", { name: "Spelling", exact: true })
    .uncheck();
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
  await typos.getByRole("checkbox", { name: "Spelling", exact: true }).check();
  await page.clock.runFor(400);
  await expect(page.locator(".inline-diagnostic")).toHaveText([
    "teh",
    "adress",
  ]);
  await page.getByRole("button", { name: "Close proofreading" }).click();
  await page.locator("#text-format").selectOption("markdown");
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
});

test("a delayed older worker result cannot restore stale marks after a newer result", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const controls = { hold: false, release: null as (() => void) | null };
    Object.assign(window, { analysisTestControls: controls });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (event) => {
          if (!controls.hold || !event.data.result) return;
          event.stopImmediatePropagation();
          controls.release = () =>
            this.dispatchEvent(
              new MessageEvent("message", { data: event.data }),
            );
        });
      }
    };
  });
  await createText(page, "teh and adress.");
  await page.evaluate(() => {
    (
      window as unknown as { analysisTestControls: { hold: boolean } }
    ).analysisTestControls.hold = true;
  });
  const body = page.getByLabel("Text body", { exact: true });
  await body.fill("teh and adress. Again.");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { analysisTestControls: { release: unknown } })
            .analysisTestControls.release,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as unknown as { analysisTestControls: { hold: boolean } }
    ).analysisTestControls.hold = false;
  });
  await body.fill("Correct text.");
  const summary = page.getByRole("button", {
    name: "Open proofreading issues",
  });
  await expect(summary).toHaveText("Checks: 0 issues");
  await page.evaluate(() => {
    (
      window as unknown as { analysisTestControls: { release(): void } }
    ).analysisTestControls.release();
  });
  await expect(summary).toHaveText("Checks: 0 issues");
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
  await expect(body).toHaveValue("Correct text.");
});
