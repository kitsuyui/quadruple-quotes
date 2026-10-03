import { expect, type Page, test } from "@playwright/test";

const storageKey = "quadruple-quotes.workspace.v1";

test("the last row menu stays usable in a scrollable sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 640 });
  await page.addInitScript((key) => {
    const documents = Array.from({ length: 20 }, (_, index) => ({
      id: `note-${index}`,
      title: `Note ${index}`,
      body: "A saved text.",
      updatedAt: 100 + index,
    }));
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, documents }));
  }, storageKey);
  await page.goto("/");
  const menu = await actions(page, "Note 0");
  await expect(
    menu.getByRole("button", { name: "Archive text", exact: true }),
  ).toBeInViewport();
  await expect(
    menu.getByRole("button", { name: "Delete text", exact: true }),
  ).toBeInViewport();
  await menu.getByRole("button", { name: "Archive text", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Note 0", exact: true }),
  ).toHaveCount(0);
});
const legacy = {
  schemaVersion: 1,
  documents: [
    { id: "one", title: "First note", body: "  日本語 📝\n", updatedAt: 100 },
    {
      id: "two",
      title: "Second note",
      body: "Keep editing here.",
      updatedAt: 200,
    },
  ],
};

async function seed(page: Page) {
  await page.addInitScript(
    ({ key, snapshot }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(snapshot));
    },
    { key: storageKey, snapshot: legacy },
  );
  await page.goto("/");
}

async function actions(page: Page, title: string) {
  await page.getByLabel(`Actions for ${title}`, { exact: true }).click();
  return page.locator(".text-actions[open]");
}

test("sidebar archives legacy text, persists it, and restores its exact contents", async ({
  page,
}) => {
  await seed(page);
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "Second note",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Your texts" })
      .getByRole("button", { name: "Open First note", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Archived texts", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Archived texts", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  const archived = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), storageKey)) ??
      "{}",
  );
  expect(archived.schemaVersion).toBe(2);
  expect(archived.documents[0].archived).toBe(true);
  expect(archived.documents[0].updatedAt).toBe(100);
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Restore text", exact: true })
    .click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Back to texts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open First note", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
});

test("sidebar deletion targets another text and preserves the current unsaved draft", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Unsaved second draft");
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("“First note”");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Unsaved second draft",
  );
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Unsaved second draft",
  );
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open First note", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Unsaved second draft",
  );
});

test("archive and restore protect edits with cancel, save, and discard choices", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Save before archive");
  await (await actions(page, "Second note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Save before archive",
  );
  await (await actions(page, "Second note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & continue" })
    .click();
  await page
    .getByRole("button", { name: "Archived texts", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Save before archive",
  );
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Discard before restore");
  await (await actions(page, "Second note"))
    .getByRole("button", { name: "Restore text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Back to texts", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Save before archive",
  );
});

test("failed archive or sidebar deletion preserves the saved texts", async ({
  page,
}) => {
  await seed(page);
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Could not archive");
  await expect(
    page.getByRole("button", { name: "Open First note", exact: true }),
  ).toBeVisible();
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Could not delete");
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep editing here.",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(original);
});

test("new drafts can be deleted from the sidebar and require saving before archive", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await page.getByLabel("Text title", { exact: true }).fill("Only a draft");
  await page.getByLabel("Text body", { exact: true }).fill("Not saved");
  const menu = await actions(page, "Only a draft");
  await expect(
    menu.getByRole("button", { name: "Archive text", exact: true }),
  ).toBeDisabled();
  await expect(
    menu.getByRole("button", { name: "Duplicate text", exact: true }),
  ).toBeDisabled();
  await menu.getByRole("button", { name: "Delete text", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unsaved changes");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await expect(page.getByText("A thought starts here.")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("duplicate opens an independent copy, preserving exact text and the original", async ({
  page,
}) => {
  await seed(page);
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Duplicate text", exact: true })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "First note (copy)",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  await expect(page.getByLabel("Text title", { exact: true })).toBeFocused();
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Edit just the copy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Edit just the copy",
  );
  await page
    .getByRole("button", { name: "Open First note", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Duplicate text", exact: true })
    .click();
  const snapshot = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), storageKey)) ??
      "{}",
  );
  expect(snapshot.documents).toHaveLength(4);
  expect(
    new Set(snapshot.documents.map((document: { id: string }) => document.id))
      .size,
  ).toBe(4);
  expect(snapshot.documents[0]).toEqual({
    ...legacy.documents[0],
    archived: false,
  });
  expect(snapshot.documents[1]).toEqual({
    ...legacy.documents[1],
    archived: false,
  });
});

for (const choice of ["Save & continue", "Discard"] as const) {
  test(`duplicate protects the current edited source with cancel and ${choice}`, async ({
    page,
  }) => {
    await seed(page);
    await page
      .getByLabel("Text body", { exact: true })
      .fill("Changes before copying");
    const original = await page.evaluate(
      (key) => localStorage.getItem(key),
      storageKey,
    );
    await (await actions(page, "Second note"))
      .getByRole("button", { name: "Duplicate text", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
      "Changes before copying",
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toBe(original);
    await (await actions(page, "Second note"))
      .getByRole("button", { name: "Duplicate text", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: choice, exact: true })
      .click();
    const body =
      choice === "Discard"
        ? legacy.documents[1].body
        : "Changes before copying";
    await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
      "Second note (copy)",
    );
    await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
      body,
    );
    await page
      .getByRole("button", { name: "Open Second note", exact: true })
      .click();
    await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
      body,
    );
  });
}

test("duplicating another sidebar row offers to keep the unrelated draft", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Keep this second draft");
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Duplicate text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & continue" })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "First note (copy)",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  await page
    .getByRole("button", { name: "Open Second note", exact: true })
    .click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Keep this second draft",
  );
});

for (const failure of ["storage failure", "stale tab"] as const) {
  test(`duplicate preserves storage and an unsaved draft on ${failure}`, async ({
    page,
  }) => {
    await seed(page);
    await page
      .getByLabel("Text body", { exact: true })
      .fill("Still keep this draft");
    await page.evaluate(
      ({ key, failure }) => {
        if (failure === "storage failure") {
          Storage.prototype.setItem = () => {
            throw new Error("Storage unavailable");
          };
        } else {
          const snapshot = JSON.parse(localStorage.getItem(key) ?? "{}");
          snapshot.documents.push({
            id: "other-tab",
            title: "Other tab",
            body: "Preserve this too",
            updatedAt: 300,
          });
          localStorage.setItem(key, JSON.stringify(snapshot));
        }
      },
      { key: storageKey, failure },
    );
    const before = await page.evaluate(
      (key) => localStorage.getItem(key),
      storageKey,
    );
    await (await actions(page, "Second note"))
      .getByRole("button", { name: "Duplicate text", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Could not duplicate");
    await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
      "Still keep this draft",
    );
    await expect(
      page.getByRole("button", {
        name: "Open Second note (copy)",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toBe(before);
  });
}

test("mobile keyboard duplication from the archive opens an active copy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page
    .getByRole("button", { name: "Open text list", exact: true })
    .click();
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archived texts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open text list", exact: true })
    .click();
  await page.getByLabel("Actions for First note", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Duplicate text", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "First note (copy)",
  );
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    legacy.documents[0].body,
  );
  await expect(page.locator(".breadcrumb strong")).toHaveText("Texts");
  await expect(page.locator(".sidebar")).not.toBeVisible();
  const snapshot = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), storageKey)) ??
      "{}",
  );
  expect(snapshot.documents[0]).toEqual({
    ...legacy.documents[0],
    archived: true,
  });
  expect(snapshot.documents[2].archived).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mobile sidebar actions support keyboard dismissal and deletion from archive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page
    .getByRole("button", { name: "Open text list", exact: true })
    .click();
  const toggle = page.getByLabel("Actions for First note", { exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".text-actions[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".text-actions[open]")).toHaveCount(0);
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Archive text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archived texts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open text list", exact: true })
    .click();
  await (await actions(page, "First note"))
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete text", exact: true })
    .click();
  await expect(page.getByLabel("Text title", { exact: true })).toHaveCount(0);
  const snapshot = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), storageKey)) ??
      "{}",
  );
  expect(
    snapshot.documents.map((document: { id: string }) => document.id),
  ).toEqual(["two"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
