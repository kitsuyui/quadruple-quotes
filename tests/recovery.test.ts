import { expect, test } from "bun:test";
import type { RecoveryRecord, TextDocument } from "../apps/web/src/ports";
import {
  BrowserRecoveryStore,
  MAX_RECOVERY_BYTES,
  RECOVERY_PREFIX,
  recoveryDocument,
  sameDocument,
} from "../apps/web/src/recovery";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const document = (overrides: Partial<TextDocument> = {}): TextDocument => ({
  id: "note-1",
  title: "A note",
  body: "  日本語 📝\\n",
  updatedAt: 100,
  archived: false,
  format: "text",
  ...overrides,
});

const record = (overrides: Partial<RecoveryRecord> = {}): RecoveryRecord => ({
  schemaVersion: 1,
  document: document(),
  base: document(),
  updatedAt: 200,
  ...overrides,
});

function validateDocument(value: unknown): TextDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid document");
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.body !== "string" ||
    !Number.isSafeInteger(item.updatedAt) ||
    typeof item.archived !== "boolean" ||
    (item.format !== undefined &&
      item.format !== "text" &&
      item.format !== "markdown")
  )
    throw new Error("invalid document");
  return { ...item, format: item.format ?? "text" } as TextDocument;
}

test("recovery keeps Unicode and whitespace, and clearing is guarded by its raw record", () => {
  const storage = new MemoryStorage();
  const recovery = new BrowserRecoveryStore(
    storage,
    validateDocument,
    () => "draft-1",
  );
  const saved = recovery.write(record(), null);

  expect(saved.key).toBe(`${RECOVERY_PREFIX}draft-1`);
  expect(recovery.list().entries).toEqual([saved]);
  expect(recovery.rawBackup()).toContain("日本語 📝");

  storage.setItem(saved.key, JSON.stringify(record({ updatedAt: 201 })));
  expect(() => recovery.remove(saved)).toThrow("changed in another tab");
  expect(storage.getItem(saved.key)).toContain('"updatedAt":201');
});

test("recovery corruption and oversized records stay in storage without hiding valid drafts", () => {
  const storage = new MemoryStorage();
  const recovery = new BrowserRecoveryStore(
    storage,
    validateDocument,
    () => "draft-2",
  );
  const valid = recovery.write(record(), null);
  const malformedKey = `${RECOVERY_PREFIX}broken`;
  const oversizedKey = `${RECOVERY_PREFIX}oversized`;
  storage.setItem(malformedKey, "{broken");
  storage.setItem(oversizedKey, "x".repeat(MAX_RECOVERY_BYTES + 1));

  const listed = recovery.list();
  expect(listed.entries).toEqual([valid]);
  expect(listed.errors).toHaveLength(2);
  expect(storage.getItem(malformedKey)).toBe("{broken");
  expect(storage.getItem(oversizedKey)).toHaveLength(MAX_RECOVERY_BYTES + 1);
});

test("recovery CAS and quota failures retain the current in-memory draft and raw records", () => {
  const storage = new MemoryStorage();
  let nextId = 3;
  const recovery = new BrowserRecoveryStore(
    storage,
    validateDocument,
    () => `draft-${nextId++}`,
  );
  const previous = recovery.write(record(), null);
  const raw = previous.raw;

  storage.setItem(previous.key, JSON.stringify(record({ updatedAt: 201 })));
  expect(() => recovery.write(record({ updatedAt: 202 }), previous)).toThrow(
    "changed in another tab",
  );
  expect(storage.getItem(previous.key)).not.toBe(raw);

  storage.setItem = () => {
    throw new DOMException("Storage full", "QuotaExceededError");
  };
  expect(() =>
    recovery.write(
      record({ document: document({ id: "note-2" }), base: null }),
      null,
    ),
  ).toThrow("Storage full");
  expect(storage.getItem(previous.key)).toContain('"updatedAt":201');
});

test("recovery restores a matching saved draft and creates a distinct unarchived copy on conflict", () => {
  const original = document({ format: "markdown" });
  const matching = record({ document: original, base: original });
  expect(recoveryDocument(matching, original, "new-id")).toEqual(original);
  expect(
    sameDocument(document({ format: undefined }), document({ format: "text" })),
  ).toBe(true);

  const changed = document({ body: "Saved elsewhere", archived: true });
  expect(recoveryDocument(matching, changed, "new-id")).toEqual({
    ...original,
    id: "new-id",
    archived: false,
    title: "A note (recovered copy)",
  });
  expect(
    recoveryDocument(record({ base: null }), undefined, "fresh-id"),
  ).toEqual(document());
});
