import { expect, type Page, test } from "@playwright/test";

async function createText(page: Page, body: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first text", exact: true })
    .click();
  await page.getByLabel("Text title", { exact: true }).fill("Hover review");
  await page.getByLabel("Text body", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".inline-diagnostic").first()).toBeVisible();
}

async function pointAtMark(page: Page, text: string) {
  const mark = page
    .locator(".inline-diagnostic")
    .filter({ hasText: text })
    .first();
  const box = await mark.boundingBox();
  if (!box) throw new Error("Missing inline mark");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

test("hover explains each typo and its suggestion without focusing or modifying the text", async ({
  page,
}) => {
  const text = "This is teh adress.";
  await createText(page, text);
  const saved = await page.evaluate(() =>
    localStorage.getItem("quadruple-quotes.workspace.v1"),
  );
  const body = page.getByLabel("Text body", { exact: true });
  const tooltip = page.getByRole("tooltip");
  await pointAtMark(page, "teh");
  await expect(tooltip).toContainText("Possible typo: teh");
  await expect(tooltip).toContainText("Suggested: the");
  await expect(body).not.toBeFocused();
  const card = await tooltip.boundingBox();
  if (!card) throw new Error("Missing tooltip");
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.waitForTimeout(250);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await pointAtMark(page, "teh");
  await page.waitForTimeout(250);
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(5, 5);
  await pointAtMark(page, "adress");
  await expect(tooltip).toContainText("Possible typo: adress");
  await expect(tooltip).toContainText("Suggested: address");
  await expect(tooltip).not.toContainText("Possible typo: teh");
  await expect(body).toHaveValue(text);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("quadruple-quotes.workspace.v1"),
    ),
  ).toBe(saved);
  await page.mouse.move(5, 5);
  await expect(tooltip).toHaveCount(0);
});

test("the caret provides keyboard access and Esc dismisses without losing selection", async ({
  page,
}) => {
  await createText(page, "teh word.");
  const body = page.getByLabel("Text body", { exact: true });
  await body.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Possible typo: teh");
  const id = await tooltip.getAttribute("id");
  expect(await body.getAttribute("aria-describedby")).toContain(id);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(body).toBeFocused();
  expect(
    await body.evaluate((input: HTMLTextAreaElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([1, 1]);
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(tooltip).toContainText("Possible typo: teh");
  await body.fill("Correct text.");
  await expect(tooltip).toHaveCount(0);
});

test("composition and document changes immediately remove stale messages", async ({
  page,
}) => {
  await createText(page, "A teh typo.");
  await pointAtMark(page, "teh");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const body = page.getByLabel("Text body", { exact: true });
  await body.dispatchEvent("compositionstart", { bubbles: true });
  await expect(tooltip).toHaveCount(0);
  await body.dispatchEvent("compositionend", { bubbles: true });
  await expect(page.locator(".inline-diagnostic")).toHaveText("teh");
  await pointAtMark(page, "teh");
  await expect(tooltip).toBeVisible();
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await expect(tooltip).toHaveCount(0);
  await expect(body).toHaveValue("");
});

test("scrolling invalidates old hit boxes and the next hover follows the visible mark", async ({
  page,
}) => {
  await createText(page, `teh\n${"A plain line.\n".repeat(35)}adress`);
  await page
    .getByLabel("Text body", { exact: true })
    .evaluate((input: HTMLTextAreaElement) => {
      input.scrollTop = 0;
      input.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  await pointAtMark(page, "teh");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Possible typo: teh");
  await page
    .getByLabel("Text body", { exact: true })
    .evaluate((input: HTMLTextAreaElement) => {
      input.scrollTop = input.scrollHeight;
      input.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  await expect(tooltip).toHaveCount(0);
  await pointAtMark(page, "adress");
  await expect(tooltip).toContainText("Possible typo: adress");
  const box = await tooltip.boundingBox();
  if (!box) throw new Error("Missing tooltip");
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: ".tmp/hover-proofreading-desktop.png" });
});

test("overlapping diagnostics on a composed Japanese character show both messages", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "quadruple-quotes.proofreading-settings.v1",
      JSON.stringify({
        schemaVersion: 1,
        settings: { plugins: { "textlint-ja": true }, rules: {} },
      }),
    ),
  );
  await createText(page, "か\u3099\u200b");
  const first = page.locator(".inline-diagnostic").first();
  const box = await first.boundingBox();
  if (!box) throw new Error("Missing Japanese mark");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("tooltip")).toContainText(
    "Zero-width character may be hard to review",
  );
  await expect(page.getByRole("tooltip").locator("li")).toHaveCount(2);
});

test.describe("touch access", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("a tap shows a message inside the viewport and typing remains native", async ({
    page,
  }) => {
    await createText(page, "teh は英語の入力ミスです。");
    const body = page.getByLabel("Text body", { exact: true });
    await body.focus();
    // Focus changes the shared padding; measure after the browser lays it out.
    await page.waitForTimeout(50);
    const box = await page.locator(".inline-diagnostic").boundingBox();
    if (!box) throw new Error("Missing touch mark");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Possible typo: teh");
    const card = await tooltip.boundingBox();
    if (!card) throw new Error("Missing mobile tooltip");
    expect(card.x).toBeGreaterThanOrEqual(8);
    expect(card.x + card.width).toBeLessThanOrEqual(382);
    expect(card.y).toBeGreaterThanOrEqual(8);
    expect(card.y + card.height).toBeLessThanOrEqual(836);
    await page.screenshot({ path: ".tmp/hover-proofreading-mobile.png" });
    await page.keyboard.insertText("x");
    await expect(tooltip).toHaveCount(0);
    await expect(body).toBeFocused();
  });
});
