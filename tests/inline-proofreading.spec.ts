import { expect, type Page, test } from "@playwright/test";

async function createText(page: Page, body: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first text", exact: true })
    .click();
  await page.getByLabel("Text title", { exact: true }).fill("Inline review");
  await page.getByLabel("Text body", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("closed-panel checks preserve Unicode, keyboard editing, selections, IME, and explicit saves", async ({
  page,
}) => {
  const original = "  日本語 📝\nA sentence with teh typo.\n";
  await createText(page, original);
  const body = page.getByLabel("Text body", { exact: true });
  const marks = page.locator(".inline-diagnostic");
  await expect(marks).toHaveText("teh");
  const snapshot = await page.evaluate(() =>
    localStorage.getItem("quadruple-quotes.workspace.v1"),
  );
  await body.focus();
  await body.evaluate((input: HTMLTextAreaElement) =>
    input.setSelectionRange(
      input.value.indexOf("teh"),
      input.value.indexOf("teh") + 3,
    ),
  );
  await page.keyboard.insertText("the");
  await expect(marks).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks: 0 issues");
  const caret = original.indexOf("teh") + 3;
  expect(
    await body.evaluate((input: HTMLTextAreaElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([caret, caret]);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("quadruple-quotes.workspace.v1"),
    ),
  ).toBe(snapshot);
  await body.evaluate((input) =>
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await body.fill("日本語と teh を変換中");
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks paused while typing");
  await expect(marks).toHaveCount(0);
  await body.fill(original);
  await body.evaluate((input) =>
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    ),
  );
  await expect(marks).toHaveText("teh");
  await page.keyboard.press("ControlOrMeta+s");
  await page.reload();
  await expect(body).toHaveValue(original);
  await expect(marks).toHaveText("teh");
  // Decorative content never becomes an additional editable or accessible copy.
  await expect(page.locator(".body-mirror")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: "Text body", exact: true }),
  ).toHaveCount(1);
});

test("disabling a rule clears its inline marks even after closing and reloading", async ({
  page,
}) => {
  await createText(page, "This has teh typo.");
  await expect(page.locator(".inline-diagnostic")).toHaveText("teh");
  await page.getByRole("button", { name: "Open proofreading issues" }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Rules and plugins", { exact: true }).click();
  const typos = page.locator(".analysis-plugin").filter({ hasText: "Typos" });
  await typos.locator("summary").click();
  await typos
    .getByRole("checkbox", { name: "Spelling", exact: true })
    .uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks: 0 issues");
  await expect(page.locator(".inline-diagnostic")).toHaveCount(0);
});

test("closing the panel stops manual dependency runs while local checks continue", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/dependencies", async (route) => {
    requests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, dependencies: [] }),
    });
  });
  await createText(page, "文章です。");
  await page.getByRole("button", { name: "Proofreading", exact: true }).click();
  await page.getByText("Rules and plugins", { exact: true }).click();
  await page
    .locator(".analysis-plugin")
    .filter({ hasText: "Japanese dependencies" })
    .locator("summary")
    .click();
  await page
    .getByRole("checkbox", { name: "Japanese dependencies", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Run dependency analysis", exact: true })
    .click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByText("0 issues", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close proofreading" }).click();
  await page.getByLabel("Text body", { exact: true }).fill("文章に teh typo.");
  await expect(page.locator(".inline-diagnostic")).toHaveText("teh");
  await page.getByRole("button", { name: "Proofreading", exact: true }).click();
  await expect(page.getByText("1 issue", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

for (const width of [390, 768, 1280]) {
  test(`inline marks align with wrapped Japanese text, tabs, and scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const paragraph = `${"日本語 📝\tA sentence that wraps across the editor. ".repeat(7)}\n`;
    const text = `${paragraph.repeat(12)}teh\n`;
    await createText(page, text);
    const body = page.getByLabel("Text body", { exact: true });
    await expect(page.locator(".inline-diagnostic")).toHaveText("teh");
    await body.focus();
    await body.evaluate((input: HTMLTextAreaElement) => {
      input.scrollTop = input.scrollHeight;
      input.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const geometry = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>("#text-body");
      const mirror = document.querySelector<HTMLElement>(
        ".body-mirror-content",
      );
      const mark = document.querySelector<HTMLElement>(".inline-diagnostic");
      if (!input || !mirror || !mark) throw new Error("Missing editor layers");
      const inputBox = input.getBoundingClientRect();
      const markBox = mark.getBoundingClientRect();
      const inputStyle = getComputedStyle(input);
      const mirrorStyle = getComputedStyle(mirror);
      return {
        top: markBox.top,
        bottom: markBox.bottom,
        left: markBox.left,
        right: markBox.right,
        inputTop: inputBox.top,
        inputBottom: inputBox.bottom,
        inputLeft: inputBox.left,
        inputRight: inputBox.right,
        heightDifference: Math.abs(input.scrollHeight - mirror.scrollHeight),
        lineHeight: Number.parseFloat(inputStyle.lineHeight),
        inputFont: inputStyle.font,
        mirrorFont: mirrorStyle.font,
        inputPadding: inputStyle.padding,
        mirrorPadding: mirrorStyle.padding,
        decoration: getComputedStyle(mark).textDecorationStyle,
        color: getComputedStyle(mark).textDecorationColor,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.inputTop - 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.inputBottom + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.inputLeft);
    expect(geometry.right).toBeLessThanOrEqual(geometry.inputRight);
    expect(geometry.heightDifference).toBeLessThanOrEqual(
      geometry.lineHeight + 1,
    );
    expect(geometry.inputFont).toBe(geometry.mirrorFont);
    expect(geometry.inputPadding).toBe(geometry.mirrorPadding);
    expect(geometry.decoration).toBe("wavy");
    expect(geometry.color).toBe("rgb(193, 53, 53)");
    expect(geometry.pageFits).toBe(true);
    await expect(body).toHaveValue(text);
    await page.screenshot({ path: `.tmp/inline-proofreading-${width}.png` });
  });
}
