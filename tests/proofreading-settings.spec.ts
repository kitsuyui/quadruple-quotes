import { expect, type Page, test } from "@playwright/test";

const settingsKey = "quadruple-quotes.proofreading-settings.v1";
const workspaceKey = "quadruple-quotes.workspace.v1";
const body = (page: Page) => page.getByLabel("Text body", { exact: true });
const checks = (page: Page) =>
  page.getByRole("button", { name: "Open proofreading issues" });
const card = (page: Page) =>
  page.getByRole("dialog", { name: "Proofreading details" });
const workspace = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), workspaceKey);
const preferences = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    settingsKey,
  );

async function create(page: Page, text: string, title = "Settings review") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create your first text", exact: true })
    .click();
  await page.getByLabel("Text title", { exact: true }).fill(title);
  await body(page).fill(text);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(checks(page)).toHaveText(/Checks: \d/);
}
async function open(page: Page) {
  await page.getByRole("button", { name: "Proofreading", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Proofreading" }),
  ).toBeVisible();
}
async function hover(page: Page, text: string) {
  const box = await page
    .locator(".inline-diagnostic")
    .filter({ hasText: text })
    .first()
    .boundingBox();
  if (!box) throw new Error("Missing diagnostic");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card(page)).toBeVisible();
}
async function plugin(page: Page, name: string) {
  await page
    .locator(".analysis-plugin")
    .filter({ hasText: name })
    .locator("summary")
    .click();
}

for (const width of [1280, 390]) {
  test(`presets and saved profiles preserve drafts and exceptions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const original = "📝 teh and adress.";
    await create(page, original);
    const saved = await workspace(page);
    await body(page).fill(`${original} Draft`);
    await open(page);
    await page.getByText("Presets", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Apply preset" }),
    ).toBeEnabled();
    await page
      .getByLabel("Proofreading preset", { exact: true })
      .selectOption("japanese");
    await page.getByRole("button", { name: "Apply preset" }).click();
    await expect(
      page.getByText("Current: Japanese prose", { exact: true }),
    ).toBeVisible();
    const configured = await preferences(page);
    expect(configured.schemaVersion).toBe(2);
    expect(configured.settings.plugins["textlint-ja"]).toBe(true);
    expect(configured.settings.plugins["textlint-ai"]).toBe(false);
    expect(configured.settings.plugins.ginza).toBe(false);
    await page.getByLabel("Preset name", { exact: true }).fill("My review");
    await page.getByLabel("Preset name", { exact: true }).press("Enter");
    await expect(
      page.getByRole("list", { name: "Saved presets" }),
    ).toContainText("My review");
    await page
      .getByLabel("Proofreading preset", { exact: true })
      .selectOption("basic");
    await page.getByRole("button", { name: "Apply preset" }).click();
    await expect(
      page.getByText("Current: Basic", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Proofreading preset", { exact: true })
      .selectOption("saved:My review");
    await page.getByRole("button", { name: "Apply preset" }).click();
    await expect(
      page.getByText("Current: My review", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Preset name", { exact: true }).fill("my review");
    await page.getByRole("button", { name: "Save current preset" }).click();
    await expect(page.getByRole("alert")).toContainText("already exists");
    expect((await preferences(page)).presets).toHaveLength(1);
    await expect(body(page)).toHaveValue(`${original} Draft`);
    expect(await workspace(page)).toBe(saved);
    await page.screenshot({
      path: `.tmp/proofreading-settings/presets-${width}.png`,
    });
    await page.getByRole("button", { name: "Close proofreading" }).click();
    await body(page).focus();
    await body(page).press("Control+z");
    await expect(body(page)).toHaveValue(original);
    await page.reload();
    await open(page);
    await page.getByText("Presets", { exact: true }).click();
    await expect(
      page.getByRole("list", { name: "Saved presets" }),
    ).toContainText("My review");
    await page.getByRole("button", { name: "Delete preset My review" }).click();
    await expect(page.getByRole("list", { name: "Saved presets" })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Current: Japanese prose", { exact: true }),
    ).toBeVisible();
    expect(await workspace(page)).toBe(saved);
  });
}

test("keyboard inline allowlisting folds ASCII case, keeps other checks, and can be removed", async ({
  page,
}) => {
  const original = "📝 teh TEH adress.\u200b";
  await create(page, original);
  const saved = await workspace(page);
  await expect(checks(page)).toHaveText("Checks: 4 issues");
  await body(page).focus();
  await body(page).press("Home");
  await body(page).press("F8");
  await expect(card(page)).toContainText("Possible typo: teh");
  await body(page).press("Control+.");
  await page.keyboard.press("Tab");
  await expect(
    card(page).getByRole("button", { name: "Allow “teh” everywhere" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(body(page)).toBeFocused();
  await expect(checks(page)).toHaveText("Checks: 2 issues");
  await expect(body(page)).toHaveValue(original);
  expect(await workspace(page)).toBe(saved);
  await open(page);
  await page.getByText("Presets", { exact: true }).click();
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 2 issues");
  expect((await preferences(page)).settings.allowedWords).toEqual(["teh"]);
  await page.getByText(/^Exceptions \(/).click();
  await expect(
    page.getByRole("list", { name: "Allowed spelling words" }),
  ).toContainText("teh");
  await page
    .getByLabel("Allowed spelling word", { exact: true })
    .fill("two words");
  await page.getByRole("button", { name: "Add allowed word" }).click();
  await expect(page.getByRole("alert")).toContainText("one word");
  expect((await preferences(page)).settings.allowedWords).toEqual(["teh"]);
  await page.screenshot({
    path: ".tmp/proofreading-settings/exceptions-1280.png",
  });
  await page.getByRole("button", { name: "Remove allowed word teh" }).click();
  await expect(checks(page)).toHaveText("Checks: 4 issues");
  expect(await workspace(page)).toBe(saved);
});

test("document rule exceptions survive reload, do not transfer to copies, and restore explicitly", async ({
  page,
}) => {
  await create(page, "teh adress", "Source");
  const saved = await workspace(page);
  await open(page);
  await page
    .locator(".analysis-issues > li")
    .filter({ hasText: "Possible typo: teh" })
    .getByRole("button", { name: "Ignore rule in this document" })
    .click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  await page.getByText("Presets", { exact: true }).click();
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  expect((await preferences(page)).settings.ignoredRules).toHaveLength(1);
  expect(await workspace(page)).toBe(saved);
  await page.reload();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  await page.getByLabel("Actions for Source", { exact: true }).click();
  await page
    .getByRole("button", { name: "Duplicate text", exact: true })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "Source (copy)",
  );
  await expect(checks(page)).toHaveText("Checks: 2 issues");
  await open(page);
  await page.getByText(/^Exceptions \(/).click();
  await expect(
    page.getByRole("list", { name: "Document rule exceptions" }),
  ).toContainText("Source");
  await page
    .getByRole("button", {
      name: "Remove exception typos.spelling for Source",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Close proofreading" }).click();
  await page.getByRole("button", { name: "Open Source", exact: true }).click();
  await expect(checks(page)).toHaveText("Checks: 2 issues");
  await expect(body(page)).toHaveValue("teh adress");
});

test("severity and document exclusions reach both Rust and Markdown adapters", async ({
  page,
}) => {
  await create(page, "📝 teh");
  const saved = await workspace(page);
  await open(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await plugin(page, "Typos");
  await page
    .getByLabel("Severity for Spelling", { exact: true })
    .selectOption("info");
  await expect(page.locator(".inline-info")).toHaveText("teh");
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await body(page).fill("# Heading\nteh text   \n");
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint.MD009/ }),
  ).toBeVisible();
  await plugin(page, "Markdown");
  await page
    .getByLabel("Severity for Trailing spaces", { exact: true })
    .selectOption("info");
  await expect
    .poll(async () =>
      (await page.locator(".inline-info").allTextContents()).some((text) =>
        /^ +$/.test(text),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", {
      name: "Exclude Trailing spaces in this document",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint.MD009/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Excluded for this document; still enabled elsewhere.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Restore Trailing spaces in this document",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint.MD009/ }),
  ).toBeVisible();
  expect(await workspace(page)).toBe(saved);
  await page.screenshot({ path: ".tmp/proofreading-settings/rules-1280.png" });
});

test("retained pending diagnostics cannot register stale exceptions", async ({
  page,
}) => {
  await create(page, "teh adress");
  const saved = await workspace(page);
  const time = new Date("2026-10-12T01:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await body(page).focus();
  await body(page).press("Home");
  await page.keyboard.insertText("📝 ");
  await hover(page, "teh");
  const allow = card(page).getByRole("button", {
    name: "Allow “teh” everywhere",
  });
  await expect(allow).toBeDisabled();
  await expect(
    card(page).getByRole("button", { name: "Ignore rule in this document" }),
  ).toBeDisabled();
  await allow.evaluate((button: HTMLButtonElement) => button.click());
  expect(await preferences(page)).toBeNull();
  await page.clock.runFor(400);
  await expect(checks(page)).toHaveText("Checks: 2 issues");
  await hover(page, "teh");
  await expect(allow).toBeEnabled();
  await allow.click();
  await page.clock.runFor(400);
  await expect(checks(page)).toHaveText("Checks: 1 issue");
  await expect(body(page)).toHaveValue("📝 teh adress");
  expect(await workspace(page)).toBe(saved);
});

test("another tab invalidates old policy and settings-only reload preserves a draft and history", async ({
  page,
  context,
}) => {
  await create(page, "teh");
  const saved = await workspace(page);
  const other = await context.newPage();
  await other.goto("/");
  await body(other).fill("teh !!");
  await open(page);
  await open(other);
  await page.getByText("Presets", { exact: true }).click();
  await other.getByText("Presets", { exact: true }).click();
  await expect(
    other.getByRole("button", { name: "Apply preset" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(other.getByRole("alert")).toContainText(
    "changed in another tab",
  );
  const fresh = await preferences(page);
  await other.getByLabel("Preset name", { exact: true }).fill("Stale");
  await other.getByRole("button", { name: "Save current preset" }).click();
  expect(await preferences(other)).toEqual(fresh);
  await other
    .getByRole("button", { name: "Reload proofreading settings", exact: true })
    .click();
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect(body(other)).toHaveValue("teh !!");
  await expect(
    other.getByText("Current: Basic", { exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Close proofreading" }).click();
  await body(other).focus();
  await body(other).press("Control+z");
  await expect(body(other)).toHaveValue("teh");
  expect(await workspace(other)).toBe(saved);
});

test("invalid v2 policy cannot overwrite saved texts or its own raw settings", async ({
  page,
}) => {
  await create(page, "teh");
  const saved = await workspace(page);
  const raw = JSON.stringify({
    schemaVersion: 2,
    settings: { plugins: {}, rules: {}, allowedWords: ["two words"] },
    presets: [],
  });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: settingsKey,
    raw,
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Proofreading is disabled",
  );
  await expect(body(page)).toHaveValue("teh");
  await page
    .getByRole("button", { name: "Reload proofreading settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Proofreading is disabled",
  );
  expect(await workspace(page)).toBe(saved);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), settingsKey),
  ).toBe(raw);
});

test("saved native-parser presets require a fresh manual request after switching policy", async ({
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
  await create(page, "これは文です。");
  await open(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await plugin(page, "Japanese dependencies");
  await page
    .getByRole("checkbox", { name: "Japanese dependencies", exact: true })
    .check();
  await page.getByText("Presets", { exact: true }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Local parser");
  await page.getByRole("button", { name: "Save current preset" }).click();
  await page
    .getByRole("button", { name: "Run dependency analysis", exact: true })
    .click();
  await expect.poll(() => requests).toBe(1);
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  await page
    .getByLabel("Proofreading preset", { exact: true })
    .selectOption("saved:Local parser");
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  expect(requests).toBe(1);
  await page
    .getByRole("button", { name: "Run dependency analysis", exact: true })
    .click();
  await expect.poll(() => requests).toBe(2);
});

test("mobile character limits count graphemes, round-trip in presets and remain independent of exceptions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = "📝e\u0301";
  await create(page, original);
  const saved = await workspace(page);
  await open(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Character limit" }).fill("1");
  await page.getByRole("button", { name: "Set limit", exact: true }).click();
  await expect(checks(page)).toHaveText("Checks: 1 issue");
  await expect(
    page.getByRole("button", { name: /core · core.character-limit/ }),
  ).toContainText("configured 1 graphemes");
  await plugin(page, "Text health");
  await page
    .getByLabel("Severity for Character limit", { exact: true })
    .selectOption("info");
  await expect(page.locator(".inline-info")).toHaveText(original);
  await page.screenshot({ path: ".tmp/proofreading-settings/rules-390.png" });
  await page.getByText("Presets", { exact: true }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Short text");
  await page.getByRole("button", { name: "Save current preset" }).click();
  await expect(page.getByRole("list", { name: "Saved presets" })).toContainText(
    "Short text",
  );
  await page
    .getByLabel("Proofreading preset", { exact: true })
    .selectOption("basic");
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  await page
    .getByLabel("Proofreading preset", { exact: true })
    .selectOption("saved:Short text");
  await page.getByRole("button", { name: "Apply preset" }).click();
  await expect(checks(page)).toHaveText("Checks: 1 issue");
  await page
    .getByRole("button", {
      name: "Exclude Character limit in this document",
      exact: true,
    })
    .click();
  await expect(checks(page)).toHaveText("Checks: 0 issues");
  await page.getByText(/^Exceptions \(/).click();
  await page.getByLabel("Allowed spelling word", { exact: true }).fill("teh");
  await page.getByRole("button", { name: "Add allowed word" }).click();
  await expect(
    page.getByRole("list", { name: "Allowed spelling words" }),
  ).toContainText("teh");
  await expect(
    page.getByRole("list", { name: "Document rule exceptions" }),
  ).toContainText("Character limit");
  await page.screenshot({
    path: ".tmp/proofreading-settings/exceptions-390.png",
  });
  const panel = page.getByRole("complementary", { name: "Proofreading" });
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Close proofreading" }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(body(page)).toHaveValue(original);
  expect(await workspace(page)).toBe(saved);
});
