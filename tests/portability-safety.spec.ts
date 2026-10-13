import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const workspaceKey = "quadruple-quotes.workspace.v1";
const recoveryPrefix = "quadruple-quotes.draft.v1.";
const saved = {
  id: "saved",
  title: "Original",
  body: "Saved body",
  updatedAt: 123,
  archived: false,
  format: "text",
};

test("quota and stale recovery writes preserve drafts and reject unsafe discard", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, document }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ schemaVersion: 3, documents: [document] }),
      ),
    { key: workspaceKey, document: saved },
  );
  await page.goto("/");
  const body = page.getByLabel("Text body", { exact: true });
  await body.fill("First recovery 日本語 📝");
  await expect
    .poll(() =>
      page.evaluate(
        (prefix) =>
          Object.keys(localStorage).filter((key) => key.startsWith(prefix))
            .length,
        recoveryPrefix,
      ),
    )
    .toBe(1);
  const entry = await page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((item) =>
      item.startsWith(prefix),
    );
    if (!key) throw new Error("Recovery missing");
    return { key, raw: localStorage.getItem(key) };
  }, recoveryPrefix);
  await page.evaluate((prefix) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix))
        throw new DOMException("Recovery full", "QuotaExceededError");
      return original.call(this, key, value);
    };
    (
      window as unknown as { restoreRecoveryStorage: () => void }
    ).restoreRecoveryStorage = () => {
      Storage.prototype.setItem = original;
    };
  }, recoveryPrefix);
  await body.fill("Latest unsaved 日本語 📝");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Draft recovery could not be updated" }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), entry.key),
  ).toBe(entry.raw);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toContain("Saved body");
  await expect(body).toHaveValue("Latest unsaved 日本語 📝");

  await page.evaluate(({ key, raw }) => {
    (
      window as unknown as { restoreRecoveryStorage: () => void }
    ).restoreRecoveryStorage();
    if (!raw) throw new Error("Missing raw recovery");
    const changed = JSON.parse(raw);
    changed.document.body = "Another tab's recovery";
    localStorage.setItem(key, JSON.stringify(changed));
  }, entry);
  const otherRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    entry.key,
  );
  await body.fill("Still my latest draft");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Recovery data changed in another tab" }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), entry.key),
  ).toBe(otherRaw);
  await page.getByRole("button", { name: "New text", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByRole("dialog").filter({ hasText: "Keep your changes?" }),
  ).toContainText("Could not discard recovery");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(body).toHaveValue("Still my latest draft");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), entry.key),
  ).toBe(otherRaw);
});

test("stale workspace imports and oversized file headers cannot partially replace saved texts", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, document }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ schemaVersion: 3, documents: [document] }),
      ),
    { key: workspaceKey, document: saved },
  );
  await page.goto("/");
  await page
    .getByLabel("Text body", { exact: true })
    .fill("Current draft kept");
  await page
    .getByRole("button", { name: "Files & recovery", exact: true })
    .click();
  const picker = page.getByLabel("Import file", { exact: true });
  const incoming = JSON.stringify({
    schemaVersion: 3,
    documents: [{ ...saved, id: "incoming" }],
  });
  await picker.setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(incoming),
  });
  await expect(page.getByRole("button", { name: "Add 1 texts" })).toBeVisible();
  const changed = JSON.stringify({
    schemaVersion: 3,
    documents: [{ ...saved, body: "Saved in another tab" }],
  });
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: workspaceKey,
    raw: changed,
  });
  await page.getByRole("button", { name: "Add 1 texts" }).click();
  await expect(
    page.getByRole("dialog", { name: "Files and recovery" }),
  ).toContainText("workspace changed in another tab");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(changed);
  await picker.setInputFiles({
    name: "too-large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, "x"),
  });
  await expect(
    page.getByRole("dialog", { name: "Files and recovery" }),
  ).toContainText("exceeds the import size limit");
  await page.getByRole("button", { name: "Close files and recovery" }).click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Current draft kept",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(changed);
});

test("damaged startup and future recovery data can be downloaded without resetting storage", async ({
  page,
}) => {
  await page.goto("/");
  const rawWorkspace = '{"schemaVersion":99,"documents":[]}';
  const rawRecovery = '{"schemaVersion":99,"document":{"future":"kept"}}';
  const recoveryKey = `${recoveryPrefix}future`;
  await page.evaluate(
    ({ key, raw, draftKey, draftRaw }) => {
      localStorage.setItem(key, raw);
      localStorage.setItem(draftKey, draftRaw);
    },
    {
      key: workspaceKey,
      raw: rawWorkspace,
      draftKey: recoveryKey,
      draftRaw: rawRecovery,
    },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "We couldn’t open your workspace." }),
  ).toBeVisible();
  const workspaceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download raw workspace data" })
    .click();
  const workspacePath = await (await workspaceDownload).path();
  if (!workspacePath) throw new Error("Missing workspace download");
  expect(await readFile(workspacePath, "utf8")).toBe(rawWorkspace);
  const recoveryDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download raw recovery data" })
    .click();
  const recoveryPath = await (await recoveryDownload).path();
  if (!recoveryPath) throw new Error("Missing recovery download");
  expect(
    JSON.parse(await readFile(recoveryPath, "utf8")).records[recoveryKey],
  ).toBe(rawRecovery);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe(rawWorkspace);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), recoveryKey),
  ).toBe(rawRecovery);
  await page.evaluate(
    (key) => localStorage.setItem(key, '{"schemaVersion":3,"documents":[]}'),
    workspaceKey,
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Some recovery data could not be read and has been kept",
  );
  await page
    .getByRole("button", { name: "Files & recovery", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Files and recovery" }),
  ).toContainText("Could not read recovery record future");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), recoveryKey),
  ).toBe(rawRecovery);
});

test("older file read failures cannot replace the latest import preview", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Files & recovery", exact: true })
    .click();
  await page.evaluate(() => {
    const requests: Record<
      string,
      { resolve(value: ArrayBuffer): void; reject(error: Error): void }
    > = {};
    File.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        requests[this.name] = { resolve, reject };
      });
    };
    (window as unknown as { fileReads: typeof requests }).fileReads = requests;
  });
  const picker = page.getByLabel("Import file", { exact: true });
  await picker.setInputFiles({
    name: "first.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("old"),
  });
  await expect(picker).toBeDisabled();
  // Force a rapid second selection to exercise transport responses out of order.
  await picker.evaluate((input: HTMLInputElement) => {
    input.disabled = false;
  });
  await picker.setInputFiles({
    name: "second.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("new"),
  });
  await page.evaluate(() => {
    const requests = (
      window as unknown as {
        fileReads: Record<string, { resolve(value: ArrayBuffer): void }>;
      }
    ).fileReads;
    requests["second.txt"].resolve(
      new TextEncoder().encode("Latest chosen text").buffer,
    );
  });
  await expect(
    page.getByRole("dialog", { name: "Files and recovery" }),
  ).toContainText("second.txt");
  await page.evaluate(() => {
    const requests = (
      window as unknown as {
        fileReads: Record<string, { reject(error: Error): void }>;
      }
    ).fileReads;
    requests["first.txt"].reject(new Error("Old read failure"));
  });
  await expect(
    page.getByRole("dialog", { name: "Files and recovery" }),
  ).not.toContainText("Old read failure");
  await page.getByRole("button", { name: "Open as unsaved text" }).click();
  await expect(page.getByLabel("Text body", { exact: true })).toHaveValue(
    "Latest chosen text",
  );
  await expect(page.getByLabel("Text title", { exact: true })).toHaveValue(
    "second",
  );
});
