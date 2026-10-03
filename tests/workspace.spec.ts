import { expect, test } from "@playwright/test";

const storageKey = "quadruple-quotes.workspace.v1";

test("real Rust/WASM workspace saves, copies, pastes, reloads, and deletes Unicode texts", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first text" }).click();
  await page.getByLabel("Text title", { exact: true }).fill("A first thought");
  const body = "  日本語 📝\n\nA little space to think.\n";
  await page.getByLabel("Text body", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text title", { exact: true }).fill("Pasted fragment");
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(body);
  // Paste replaces a selection, rather than replacing the entire document.
  await page
    .getByLabel("Text body", { exact: true })
    .evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(2, 5),
    );
  await page.evaluate(() => navigator.clipboard.writeText("文章"));
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    `  文章${body.slice(5)}`,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Your texts" })
    .getByRole("button", { name: /A first thought/ })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(body);
  await page.getByRole("button", { name: "Delete text", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(body);
  await page.getByRole("button", { name: "Delete text", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete text" })
    .click();
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "Your texts" })
      .getByRole("button", { name: /A first thought/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "Pasted fragment",
  );
});

test("unsaved changes can be canceled, saved before switching, or discarded", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text title", { exact: true }).fill("Keep this draft");
  await page.getByLabel("Text body", { exact: true }).fill("Original");
  await page.getByRole("button", { name: "New text" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Original",
  );
  await page.getByRole("button", { name: "New text" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & continue" })
    .click();
  await page.getByLabel("Text body", { exact: true }).fill("Discard me");
  await page
    .getByRole("navigation", { name: "Your texts" })
    .getByRole("button", { name: /Keep this draft/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Original",
  );
  await page.getByLabel("Text body", { exact: true }).fill("Revised");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Revised",
  );
});

test("storage failure retains draft and never claims it was saved", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text body", { exact: true }).fill("Keep on failure");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep on failure",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("corrupt snapshots are left untouched", async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "{broken-json"),
    storageKey,
  );
  await page.goto("/");
  await expect(
    page.getByText("We couldn’t open your workspace."),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe("{broken-json");
});

test("another tab cannot overwrite newer stored text", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text body", { exact: true }).fill("Original");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const other = await context.newPage();
  await other.goto("/");
  await page.getByLabel("Text body", { exact: true }).fill("Newer version");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await other.getByLabel("Text body", { exact: true }).fill("Stale version");
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByRole("alert")).toContainText("another tab");
  await expect(other.getByLabel("Text body", { exact: true })).toHaveValue(
    "Stale version",
  );
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), storageKey)) ??
        "{}",
    ).documents[0].body,
  ).toBe("Newer version");
});

test("clipboard denial offers the native shortcut without modifying text", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text body", { exact: true }).fill("Keep this");
  await page.evaluate(() => {
    navigator.clipboard.readText = () => Promise.reject(new Error("Denied"));
  });
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("usual paste shortcut");
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep this",
  );
});

test("mobile library and editor remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first text" }).click();
  await page.getByLabel("Text title", { exact: true }).fill("Mobile note");
  await page
    .getByLabel("Text body", { exact: true })
    .fill("A small screen, a quiet space.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open text list" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Your texts" })
      .getByRole("button", { name: /Mobile note/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close text list" }).click();
  await expect(
    page.getByRole("button", { name: "Copy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Text body", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
