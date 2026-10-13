import { expect, test } from "@playwright/test";

const workspaceKey = "quadruple-quotes.workspace.v1";
const recoveryPrefix = "quadruple-quotes.draft.v1.";

const workspace = (documents: unknown[]) =>
  JSON.stringify({ schemaVersion: 3, documents });

const text = (overrides: Record<string, unknown> = {}) => ({
  id: "saved-1",
  title: "Original note",
  body: "Saved body",
  updatedAt: 100,
  archived: false,
  format: "text",
  ...overrides,
});

test("UTF-8 text import opens an unsaved Unicode draft and exports it without saving", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Files & recovery" }).click();
  const dialog = page.getByRole("dialog", { name: "Files and recovery" });
  const content = "\uFEFF  日本語 📝\n\nMarkdown *space*\n";
  await dialog.getByLabel("Import file").setInputFiles({
    name: "my note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(content, "utf8"),
  });
  await expect(dialog.getByText("my note.md")).toBeVisible();
  await dialog.getByRole("button", { name: "Open as unsaved text" }).click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "my note",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    content,
  );
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
    "markdown",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBeNull();

  await page.getByRole("button", { name: "Files & recovery" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "Files and recovery" })
    .getByRole("button", { name: "Download current text" })
    .click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("my note.md");
  const stream = await saved.createReadStream();
  let downloaded = "";
  for await (const chunk of stream ?? []) downloaded += chunk.toString();
  expect(downloaded).toBe(content);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBeNull();
});

test("workspace import appends independent IDs and rejects unsafe JSON without mutation", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, snapshot }) => localStorage.setItem(key, snapshot),
    { key: workspaceKey, snapshot: workspace([text()]) },
  );
  await page.goto("/");
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    workspaceKey,
  );
  await page.getByRole("button", { name: "Files & recovery" }).click();
  const dialog = page.getByRole("dialog", { name: "Files and recovery" });
  const incoming = workspace([
    text({
      id: "saved-1",
      title: "Imported archived",
      archived: true,
      format: "markdown",
    }),
    text({
      id: "another",
      title: "Imported plain",
      body: "  keep whitespace\n",
    }),
  ]);
  await dialog.getByLabel("Import file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(incoming),
  });
  await dialog.getByRole("button", { name: "Add 2 texts" }).click();
  const imported = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), workspaceKey)) ??
      "{}",
  );
  expect(imported.documents).toHaveLength(3);
  expect(
    new Set(imported.documents.map((item: { id: string }) => item.id)).size,
  ).toBe(3);
  expect(
    imported.documents.find(
      (item: { title: string }) => item.title === "Imported archived",
    ),
  ).toMatchObject({ archived: true, format: "markdown" });
  expect(
    imported.documents.find(
      (item: { title: string }) => item.title === "Imported plain",
    ),
  ).toMatchObject({ body: "  keep whitespace\n", format: "text" });

  await dialog.getByLabel("Import file").setInputFiles({
    name: "unsafe.json",
    mimeType: "application/json",
    buffer: Buffer.from(workspace([text(), text()])),
  });
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).not.toBe(before);
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), workspaceKey)) ??
        "{}",
    ).documents,
  ).toHaveLength(3);
});

test("invalid UTF-8 is rejected before it can replace an unsaved draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  await page.getByLabel("Text body", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Files & recovery" }).click();
  const dialog = page.getByRole("dialog", { name: "Files and recovery" });
  await dialog.getByLabel("Import file").setInputFiles({
    name: "broken.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await expect(dialog.getByRole("alert")).toContainText("not valid UTF-8");
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep this draft",
  );
});

test("autosaved title, body, and format recover after reload and clear only after explicit Save", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, snapshot }) => localStorage.setItem(key, snapshot),
    { key: workspaceKey, snapshot: workspace([text()]) },
  );
  await page.goto("/");
  await page.getByLabel("Text title", { exact: true }).fill("Recovered title");
  await page
    .getByLabel("Text body", { exact: true })
    .fill("  recovered body\n");
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await page.waitForTimeout(650);
  await page.reload();
  await page.getByRole("button", { name: "Recover drafts (1)" }).click();
  await page
    .getByRole("dialog", { name: "Files and recovery" })
    .getByRole("button", { name: "Recover Recovered title" })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "Recovered title",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "  recovered body\n",
  );
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
    "markdown",
  );
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), workspaceKey)) ??
        "{}",
    ).documents[0],
  ).toMatchObject({
    title: "Original note",
    body: "Saved body",
    format: "text",
  });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await page.evaluate(
      (prefix) =>
        Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
      recoveryPrefix,
    ),
  ).toEqual([]);
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), workspaceKey)) ??
        "{}",
    ).documents[0],
  ).toMatchObject({
    title: "Recovered title",
    body: "  recovered body\n",
    format: "markdown",
  });
});

test("mobile files dialog scrolls to recovery actions while retaining keyboard close access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Files & recovery" }).click();
  const dialog = page.getByRole("dialog", { name: "Files and recovery" });
  const geometry = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  const raw = dialog.getByRole("button", {
    name: "Download raw recovery data",
  });
  await raw.scrollIntoViewIfNeeded();
  await expect(raw).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Close files and recovery" }),
  ).toBeInViewport();
  await dialog
    .getByRole("button", { name: "Close files and recovery" })
    .focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Files & recovery" }),
  ).toBeFocused();
});

test("pagehide records the final IME composition without waiting for the autosave timer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text" }).click();
  const body = page.getByLabel("Text body", { exact: true });
  await body.evaluate((element: HTMLTextAreaElement) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.value = "確定した入力";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  const recovery = await page.evaluate(
    (prefix) =>
      Object.entries(localStorage).find(([key]) => key.startsWith(prefix)),
    recoveryPrefix,
  );
  expect(recovery?.[1]).toContain("確定した入力");
});

test("recovery keeps a final composed draft across reload, restores conflicts as copies, and discards only after confirmation", async ({
  page,
}) => {
  const saved = text();
  const recovered = text({ body: "Final 日本語入力", format: "markdown" });
  await page.addInitScript(
    ({ key, recoveryKey, discardKey, snapshot, raw, discardRaw }) => {
      localStorage.setItem(key, snapshot);
      localStorage.setItem(recoveryKey, raw);
      localStorage.setItem(discardKey, discardRaw);
    },
    {
      key: workspaceKey,
      recoveryKey: `${recoveryPrefix}draft`,
      discardKey: `${recoveryPrefix}discard`,
      snapshot: workspace([text({ body: "Changed in another tab" })]),
      raw: JSON.stringify({
        schemaVersion: 1,
        document: recovered,
        base: saved,
        updatedAt: 200,
      }),
      discardRaw: JSON.stringify({
        schemaVersion: 1,
        document: text({
          id: "discard",
          title: "Discard me",
          body: "Keep saved text",
        }),
        base: null,
        updatedAt: 199,
      }),
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Recover drafts (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Files and recovery" });
  await dialog
    .getByRole("button", { name: "Discard recovery for Discard me" })
    .click();
  await expect(
    page.getByRole("group", {
      name: "Confirm discard recovery for Discard me",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm discard recovery" }).click();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${recoveryPrefix}discard`,
    ),
  ).toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toContain("Changed in another tab");
  await dialog.getByRole("button", { name: "Recover Original note" }).click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "Original note (recovered copy)",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Final 日本語入力",
  );
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
    "markdown",
  );
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${recoveryPrefix}draft`,
    ),
  ).not.toBeNull();
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${recoveryPrefix}draft`,
    ),
  ).toBeNull();
});
