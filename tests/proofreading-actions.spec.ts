import { expect, type Page, test } from "@playwright/test";

const bodyInput = (page: Page) => page.getByLabel("Text body", { exact: true });
const details = (page: Page) =>
  page.getByRole("dialog", { name: "Proofreading details" });
const snapshot = (page: Page) =>
  page.evaluate(() => localStorage.getItem("quadruple-quotes.workspace.v1"));

async function createText(page: Page, text: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first text", exact: true })
    .click();
  await page.getByLabel("Text title", { exact: true }).fill("Fix review");
  await bodyInput(page).fill(text);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".inline-diagnostic").first()).toBeVisible();
}

async function hover(page: Page, text: string) {
  const box = await page
    .locator(".inline-diagnostic")
    .filter({ hasText: text })
    .first()
    .boundingBox();
  if (!box) throw new Error("Missing diagnostic mark");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(details(page)).toBeVisible();
}

for (const width of [1280, 390]) {
  test(`inline and list fixes only change the draft, with undo and explicit save at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const original = "📝 teh and adress.";
    await createText(page, original);
    const saved = await snapshot(page);
    await hover(page, "teh");
    await page.screenshot({
      path: `.tmp/proofreading-actions/card-${width}.png`,
    });
    await details(page)
      .getByRole("button", { name: "Replace with the", exact: true })
      .click();
    await expect(bodyInput(page)).toHaveValue("📝 the and adress.");
    await expect(bodyInput(page)).toBeFocused();
    expect(await snapshot(page)).toBe(saved);
    await expect(
      page.getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo body edit" }).click();
    await expect(bodyInput(page)).toHaveValue(original);
    expect(await snapshot(page)).toBe(saved);
    await page.keyboard.press("Control+Shift+z");
    await expect(bodyInput(page)).toHaveValue("📝 the and adress.");
    await expect(
      page.getByRole("button", { name: "Open proofreading issues" }),
    ).toHaveText("Checks: 1 issue");
    await page
      .getByRole("button", { name: "Proofreading", exact: true })
      .click();
    await expect(
      page
        .locator(".analysis-issues")
        .getByRole("button", { name: "Replace with address", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.tmp/proofreading-actions/panel-${width}.png`,
    });
    await page
      .locator(".analysis-issues")
      .getByRole("button", { name: "Replace with address", exact: true })
      .click();
    await expect(bodyInput(page)).toHaveValue("📝 the and address.");
    expect(await snapshot(page)).toBe(saved);
    await page.getByRole("button", { name: "Close proofreading" }).click();
    await expect(
      page.getByRole("button", { name: "Open proofreading issues" }),
    ).toHaveText("Checks: 0 issues");
    await page.screenshot({
      path: `.tmp/proofreading-actions/fixes-${width}.png`,
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(JSON.parse((await snapshot(page)) ?? "{}").documents[0].body).toBe(
      "📝 the and address.",
    );
  });
}

test("keyboard fix focus, typing, undo, redo, and title history stay independent", async ({
  page,
}) => {
  await createText(page, "teh");
  const body = bodyInput(page);
  await body.focus();
  await body.press("Home");
  await expect(details(page)).toBeVisible();
  await body.press("Control+.");
  const fix = details(page).getByRole("button", {
    name: "Replace with the",
    exact: true,
  });
  await expect(fix).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details(page)).not.toBeVisible();
  await expect(body).toBeFocused();
  await body.press("F8");
  await expect(details(page)).toBeVisible();
  await body.press("Control+.");
  await expect(fix).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(body).toHaveValue("the");
  await body.press("End");
  await page.keyboard.insertText("!!");
  await body.press("Control+z");
  await expect(body).toHaveValue("the");
  await body.press("Control+z");
  await expect(body).toHaveValue("teh");
  await body.press("Control+Shift+z");
  await expect(body).toHaveValue("the");
  const title = page.getByLabel("Text title", { exact: true });
  await title.focus();
  await title.press("End");
  await page.keyboard.insertText("!");
  await title.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(title).toHaveValue("Fix review");
  await expect(body).toHaveValue("the");
});

test("pending diagnostics never offer an applicable stale fix, then refresh their ranges", async ({
  page,
}) => {
  await createText(page, "teh and adress.");
  const time = new Date("2026-10-12T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  const body = bodyInput(page);
  await body.focus();
  await body.press("Home");
  await page.keyboard.insertText("📝 日本語 ");
  await hover(page, "teh");
  const fix = details(page).getByRole("button", {
    name: "Replace with the",
    exact: true,
  });
  await expect(fix).toBeDisabled();
  await expect(details(page)).toContainText("Rechecking…");
  await fix.evaluate((button: HTMLButtonElement) => button.click());
  await expect(body).toHaveValue("📝 日本語 teh and adress.");
  await page.clock.runFor(400);
  await expect(
    page.getByRole("button", { name: "Open proofreading issues" }),
  ).toHaveText("Checks: 2 issues");
  await hover(page, "teh");
  await expect(fix).toBeEnabled();
  await fix.click();
  await expect(body).toHaveValue("📝 日本語 the and adress.");
});

test("IME commits as one undo step and blocks fixes, history, and navigation until it finishes", async ({
  page,
}) => {
  await createText(page, "teh and adress.");
  const original = await snapshot(page);
  const body = bodyInput(page);
  await body.focus();
  await body.press("Home");
  await body.dispatchEvent("compositionstart", { bubbles: true });
  await expect(
    page.getByRole("button", { name: "Undo body edit" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Next issue →" }),
  ).toBeDisabled();
  await body.fill("日teh and adress.");
  await body.fill("日本語 teh and adress.");
  await body.dispatchEvent("compositionend", { bubbles: true });
  await page.getByRole("button", { name: "Undo body edit" }).click();
  await expect(body).toHaveValue("teh and adress.");
  await page.getByRole("button", { name: "Redo body edit" }).click();
  await expect(body).toHaveValue("日本語 teh and adress.");
  expect(await snapshot(page)).toBe(original);
});

test("F8 and Shift+F8 navigate in source order, wrap, and reveal distant diagnostics", async ({
  page,
}) => {
  await createText(page, `teh\n${"Plain line.\n".repeat(70)}adress`);
  const body = bodyInput(page);
  await body.focus();
  await body.press("Control+Home");
  await page.keyboard.press("F8");
  const selection = () =>
    body.evaluate((input: HTMLTextAreaElement) =>
      input.value.slice(input.selectionStart, input.selectionEnd),
    );
  await expect.poll(selection).toBe("teh");
  await page.keyboard.press("F8");
  await expect.poll(selection).toBe("adress");
  const mark = await page.locator(".inline-diagnostic").last().boundingBox();
  const viewport = await body.boundingBox();
  if (!mark || !viewport) throw new Error("Missing editor geometry");
  expect(mark.y).toBeGreaterThanOrEqual(viewport.y);
  expect(mark.y + mark.height).toBeLessThanOrEqual(
    viewport.y + viewport.height,
  );
  await page.keyboard.press("F8");
  await expect.poll(selection).toBe("teh");
  await page.keyboard.press("Shift+F8");
  await expect.poll(selection).toBe("adress");
});

test("switching documents clears body history without persisting a discarded fix", async ({
  page,
}) => {
  await createText(page, "teh");
  const saved = await snapshot(page);
  await hover(page, "teh");
  await details(page)
    .getByRole("button", { name: "Replace with the", exact: true })
    .click();
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(bodyInput(page)).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Undo body edit" }),
  ).toBeDisabled();
  expect(await snapshot(page)).toBe(saved);
});
