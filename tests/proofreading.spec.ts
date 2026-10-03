import { expect, type Page, test } from "@playwright/test";

const workspaceKey = "quadruple-quotes.workspace.v1";
const settingsKey = "quadruple-quotes.proofreading-settings.v1";

async function createText(page: Page, title: string, body: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first text" }).click();
  await page.getByLabel("Text title", { exact: true }).fill(title);
  await page.getByLabel("Text body", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function openProofreading(page: Page) {
  await page.getByRole("button", { name: "Proofreading", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Proofreading" }),
  ).toBeVisible();
}

async function expandPlugin(page: Page, name: string) {
  const plugin = page.locator(".analysis-plugin").filter({ hasText: name });
  await plugin.locator("summary").click();
  return plugin;
}

test("proofreading keeps its worker unloaded until the panel opens", async ({
  page,
}) => {
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));

  await createText(page, "Lazy analysis", "A saved sentence.");
  await page.waitForTimeout(500);
  expect(workers).toEqual([]);

  await openProofreading(page);
  await expect
    .poll(() => workers.some((url) => url.includes("analysis-worker")))
    .toBe(true);
});

test("Unicode metrics and a UTF-16 diagnostic range select the original editor text", async ({
  page,
}) => {
  const body = "e\u0301 👨‍👩‍👧‍👦\u200b";
  await createText(page, "Unicode range", body);
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    workspaceKey,
  );

  await openProofreading(page);
  await expect(
    page.getByText("4 grapheme clusters", { exact: true }),
  ).toBeVisible();
  const issue = page
    .getByRole("button", {
      name: /Zero-width character may be hard to review/,
    })
    .first();
  await expect(issue).toBeVisible();
  await issue.click();

  const selection = await page
    .getByLabel("Text body", { exact: true })
    .evaluate((element: HTMLTextAreaElement) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      selected: element.value.slice(
        element.selectionStart,
        element.selectionEnd,
      ),
    }));
  expect(selection).toEqual({
    start: body.indexOf("\u200d"),
    end: body.indexOf("\u200d") + 1,
    selected: "\u200d",
  });
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(original);
});

test("core rules can be turned off and their settings survive a reload", async ({
  page,
}) => {
  await createText(page, "Rule settings", "A\u200bB");
  await openProofreading(page);
  await expect(
    page.getByRole("button", {
      name: /Zero-width character may be hard to review/,
    }),
  ).toBeVisible({ timeout: 12_000 });
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Text health");
  const core = page.getByRole("checkbox", { name: "Text health", exact: true });
  await expect(core).toBeChecked();
  await core.uncheck();
  await expect(page.getByText("0 issues", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await page.reload();
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Text health");
  await expect(
    page.getByRole("checkbox", { name: "Text health", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByText("0 issues", { exact: true })).toBeVisible();
});

test("switching documents never leaves diagnostics from the previous document visible", async ({
  page,
}) => {
  await createText(page, "First", "A\u200bB");
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await page.getByLabel("Text title", { exact: true }).fill("Second");
  await page
    .getByLabel("Text body", { exact: true })
    .fill("A plain second text.");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await openProofreading(page);
  await page
    .getByRole("navigation", { name: "Your texts" })
    .getByRole("button", { name: "Open First", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Your texts" })
    .getByRole("button", { name: "Open Second", exact: true })
    .click();

  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "A plain second text.",
  );
  await expect(page.getByText("0 issues", { exact: true })).toBeVisible();
});

test("IME composition pauses analysis and resumes with only the committed text", async ({
  page,
}) => {
  await createText(page, "Composition", "A\u200bB");
  await openProofreading(page);
  await expect(
    page.getByRole("button", {
      name: /Zero-width character may be hard to review/,
    }),
  ).toBeVisible();

  const body = page.getByLabel("Text body", { exact: true });
  await body.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await body.fill("Committed without an invisible character.");
  await expect(page.getByText("Analyzing…", { exact: true })).toBeVisible();
  await body.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    ),
  );
  await expect(page.getByText("0 issues", { exact: true })).toBeVisible();
});

test("a stale browser cannot overwrite newer analysis settings or a saved workspace", async ({
  page,
  context,
}) => {
  await createText(page, "Shared workspace", "Keep this saved text.");
  const workspace = await page.evaluate(
    (key) => localStorage.getItem(key),
    workspaceKey,
  );
  const other = await context.newPage();
  await other.goto("/");
  await openProofreading(page);
  await openProofreading(other);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await other.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Text health");
  await expandPlugin(other, "Text health");
  await page
    .getByRole("checkbox", { name: "Text health", exact: true })
    .uncheck();
  const newerSettings = await page.evaluate(
    (key) => localStorage.getItem(key),
    settingsKey,
  );

  await other
    .getByRole("checkbox", { name: "Text health", exact: true })
    .click();
  await expect(other.getByRole("alert")).toContainText(
    "changed in another tab",
  );
  await expect(
    other.getByRole("checkbox", { name: "Text health", exact: true }),
  ).toBeChecked();
  expect(
    await other.evaluate((key) => localStorage.getItem(key), settingsKey),
  ).toBe(newerSettings);
  expect(
    await other.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(workspace);
});

test("markdownlint reports Markdown structure and is skipped for a plain-text document", async ({
  page,
}) => {
  await createText(
    page,
    "Markdown",
    "# Heading\nText directly follows the heading.",
  );
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await openProofreading(page);
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint\.MD022/ }),
  ).toBeVisible();

  await page.getByLabel("Format", { exact: true }).selectOption("text");
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint\./ }),
  ).toHaveCount(0);
});

test("a Markdown rule can be found, expanded, disabled, and persisted on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createText(
    page,
    "Heading spacing",
    "# Heading\nText directly follows.",
  );
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await openProofreading(page);
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint\.MD022/ }),
  ).toBeVisible();
  await page.getByText("Rules and plugins", { exact: true }).click();
  const search = page.getByLabel("Search rules and plugins", { exact: true });
  await search.fill("Final newline");
  await expect(
    page.getByRole("checkbox", { name: "Final newline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Heading spacing", exact: true }),
  ).toHaveCount(0);
  await search.fill("");
  const markdown = page
    .locator(".analysis-plugin")
    .filter({ hasText: "Markdown" });
  await markdown.locator("summary").focus();
  await page.keyboard.press("Enter");
  const headingSpacing = markdown.getByRole("checkbox", {
    name: "Heading spacing",
    exact: true,
  });
  await expect(headingSpacing).toBeVisible();
  await headingSpacing.uncheck();
  await expect(
    page.getByRole("button", { name: /markdownlint · markdownlint\.MD022/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.reload();
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  const persistedMarkdown = page
    .locator(".analysis-plugin")
    .filter({ hasText: "Markdown" });
  await persistedMarkdown.locator("summary").click();
  await expect(
    persistedMarkdown.getByRole("checkbox", {
      name: "Heading spacing",
      exact: true,
    }),
  ).not.toBeChecked();
});

test("manual GiNZA reports failed and malformed local responses without background requests", async ({
  page,
}) => {
  let mode: "failed" | "malformed" = "failed";
  let requests = 0;
  await page.route("**/api/dependencies", async (route) => {
    requests += 1;
    if (mode === "failed") {
      await route.fulfill({ status: 500, body: "parser unavailable" });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: false }),
    });
  });
  await createText(page, "Parser failure", "文章です。");
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Japanese dependencies");
  const dependencies = page.getByRole("checkbox", {
    name: "Japanese dependencies",
    exact: true,
  });
  await dependencies.check();
  await page.waitForTimeout(500);
  expect(requests).toBe(0);
  const run = page.getByRole("button", {
    name: "Run dependency analysis",
    exact: true,
  });
  await run.click();
  await expect(page.getByRole("list", { name: "Plugin status" })).toContainText(
    "ginza: error — Local parser returned 500",
  );
  expect(requests).toBe(1);

  mode = "malformed";
  await page
    .getByLabel("Text body", { exact: true })
    .fill("文章を更新します。");
  await expect(page.getByRole("list", { name: "Plugin status" })).toContainText(
    "ginza: error — Local parser did not confirm a successful analysis.",
  );
  expect(requests).toBe(2);
});

test("textlint detects a decomposed Japanese character and the individual rule can be disabled", async ({
  page,
}) => {
  await createText(page, "Japanese normalization", "か\u3099");
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Japanese writing");
  await page
    .getByRole("checkbox", { name: "Japanese writing", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: /textlint-ja · textlint-ja\.no-nfd/ }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Normalized Japanese characters",
      exact: true,
    })
    .uncheck();
  await expect(
    page.getByRole("button", { name: /textlint-ja · textlint-ja\.no-nfd/ }),
  ).toHaveCount(0);
});

test("opt-in Japanese sentence rules each report their own trigger and can be disabled", async ({
  page,
}) => {
  const longSentence = `${"あ".repeat(101)}。`;
  await createText(
    page,
    "Japanese rules",
    `これは文です。これは文\n${longSentence}`,
  );
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Japanese writing");
  await page
    .getByRole("checkbox", { name: "Japanese writing", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Sentence endings", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Sentence length", exact: true })
    .check();
  await expect(
    page.getByRole("button", {
      name: /textlint-ja · textlint-ja\.mixed-period/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /textlint-ja · textlint-ja\.sentence-length/,
    }),
  ).toBeVisible();

  await page
    .getByRole("checkbox", { name: "Sentence endings", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Sentence length", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", {
      name: /textlint-ja · textlint-ja\.(mixed-period|sentence-length)/,
    }),
  ).toHaveCount(0);
});

test("AI style hints are opt-in and ignore a Markdown code span", async ({
  page,
}) => {
  await createText(page, "AI hints", "`革命的な`");
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "AI style hints");
  await page
    .getByRole("checkbox", { name: "AI style hints", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: /textlint-ai · textlint-ai\.hype/ }),
  ).toHaveCount(0);

  await page
    .getByLabel("Text body", { exact: true })
    .fill("革命的な改善です。");
  await expect(
    page.getByRole("button", { name: /textlint-ai · textlint-ai\.hype/ }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Hype expressions", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", { name: /textlint-ai · textlint-ai\.hype/ }),
  ).toHaveCount(0);
});

test("GiNZA stays offline until an enabled user-requested manual run and its result selects a token on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let dependencyRequests = 0;
  await page.route("**/api/dependencies", async (route) => {
    dependencyRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        dependencies: [
          {
            id: 1,
            text: "文章",
            range: { start: 0, end: 2 },
            head: null,
            relation: "root",
            sentence: 1,
          },
        ],
      }),
    });
  });
  await createText(page, "Dependency", "文章を確認する。");
  await openProofreading(page);
  await page.getByText("Rules and plugins", { exact: true }).click();
  await expandPlugin(page, "Japanese dependencies");
  await page
    .getByRole("checkbox", { name: "Japanese dependencies", exact: true })
    .check();
  const run = page.getByRole("button", {
    name: "Run dependency analysis",
    exact: true,
  });
  await expect(run).toBeVisible();
  await page.waitForTimeout(500);
  expect(dependencyRequests).toBe(0);

  await run.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".dependency-table")).toBeVisible();
  expect(dependencyRequests).toBe(1);
  await page
    .locator(".dependency-table")
    .getByRole("button", { name: "文章" })
    .click();
  await expect
    .poll(() =>
      page
        .getByLabel("Text body", { exact: true })
        .evaluate((element: HTMLTextAreaElement) =>
          element.value.slice(element.selectionStart, element.selectionEnd),
        ),
    )
    .toBe("文章");
});

test("an over-limit text retains full metrics while every realtime analyzer is skipped", async ({
  page,
}) => {
  const text = "a".repeat(100_001);
  await createText(page, "Large text", text);
  await openProofreading(page);
  await expect(
    page.getByText("100,001 grapheme clusters", { exact: true }),
  ).toBeVisible();
  const statuses = page.getByRole("list", { name: "Plugin status" });
  await expect(statuses).toContainText("core: skipped");
  await expect(statuses).toContainText("markdownlint: skipped");
  await expect(statuses).toContainText("textlint-ja: disabled");
  await expect(page.locator(".analysis-issues > li")).toHaveCount(0);
});

test("corrupt proofreading settings disable only analysis and can be reset without changing a workspace", async ({
  page,
}) => {
  const workspace = JSON.stringify({
    schemaVersion: 2,
    documents: [
      {
        id: "safe",
        title: "Saved",
        body: "Keep this.",
        updatedAt: 1,
        archived: false,
      },
    ],
  });
  await page.addInitScript(
    ({ workspace, workspaceKey, settingsKey }) => {
      localStorage.setItem(workspaceKey, workspace);
      localStorage.setItem(settingsKey, "{broken");
    },
    { workspace, workspaceKey, settingsKey },
  );
  await page.goto("/");
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep this.",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Proofreading is disabled",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(workspace);

  await page
    .getByRole("button", { name: "Reset proofreading settings" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(workspace);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), settingsKey),
  ).toContain('"schemaVersion":1');
});
