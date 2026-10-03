import { expect, test } from "bun:test";
import {
  ANALYSIS_SETTINGS_KEY,
  loadAnalysisSettings,
  resetAnalysisSettings,
  safelyLoadAnalysisSettings,
  saveAnalysisSettings,
} from "../apps/web/src/analysis-settings";

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

test("analysis settings round-trip independent plugin and rule choices", () => {
  const storage = new MemoryStorage();
  const settings = {
    plugins: { markdownlint: true, "textlint-ja": false },
    rules: { "markdownlint.default": false, "textlint-ja.max-ten": true },
    characterLimit: 100_000,
  };

  saveAnalysisSettings(storage, settings);

  expect(loadAnalysisSettings(storage)).toEqual(settings);
  expect(JSON.parse(storage.getItem(ANALYSIS_SETTINGS_KEY) ?? "{}")).toEqual({
    schemaVersion: 1,
    settings,
  });
});

test("malformed, unknown-version, array, and non-boolean settings fail closed without overwriting raw storage", () => {
  const invalidValues = [
    "{broken",
    JSON.stringify({ schemaVersion: 2, settings: { plugins: {}, rules: {} } }),
    JSON.stringify([]),
    JSON.stringify({
      schemaVersion: 1,
      settings: { plugins: { markdownlint: "yes" }, rules: {} },
    }),
  ];

  for (const raw of invalidValues) {
    const storage = new MemoryStorage();
    storage.setItem(ANALYSIS_SETTINGS_KEY, raw);

    expect(() => loadAnalysisSettings(storage)).toThrow();
    expect(safelyLoadAnalysisSettings(storage)).toEqual({
      settings: { plugins: {}, rules: {} },
      error: expect.any(String),
    });
    expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(raw);
  }
});

test("settings write failures leave the last successful configuration intact", () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({
    schemaVersion: 1,
    settings: { plugins: { markdownlint: true }, rules: {} },
  });
  storage.setItem(ANALYSIS_SETTINGS_KEY, original);
  storage.setItem = () => {
    throw new DOMException("Storage full", "QuotaExceededError");
  };

  expect(() =>
    saveAnalysisSettings(storage, {
      plugins: { markdownlint: false },
      rules: {},
    }),
  ).toThrow("Storage full");
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(original);
});

test("reset refuses to overwrite settings changed by another tab", () => {
  const storage = new MemoryStorage();
  const invalid = "{broken";
  const newer = JSON.stringify({
    schemaVersion: 1,
    settings: { plugins: { typos: false }, rules: {} },
  });
  storage.setItem(ANALYSIS_SETTINGS_KEY, invalid);
  storage.setItem(ANALYSIS_SETTINGS_KEY, newer);

  expect(() => resetAnalysisSettings(storage, invalid)).toThrow(
    "changed in another tab",
  );
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(newer);
});

test("a stale settings save is rejected before it can overwrite another tab", () => {
  const storage = new MemoryStorage();
  const inspected = JSON.stringify({
    schemaVersion: 1,
    settings: { plugins: { markdownlint: true }, rules: {} },
  });
  const newer = JSON.stringify({
    schemaVersion: 1,
    settings: { plugins: { typos: false }, rules: {} },
  });
  storage.setItem(ANALYSIS_SETTINGS_KEY, newer);

  expect(() =>
    saveAnalysisSettings(
      storage,
      { plugins: { markdownlint: false }, rules: {} },
      inspected,
    ),
  ).toThrow("changed in another tab");
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(newer);
});

test("reset replaces only the corrupt configuration inspected by this tab", () => {
  const storage = new MemoryStorage();
  const invalid = "{broken";
  storage.setItem(ANALYSIS_SETTINGS_KEY, invalid);

  expect(resetAnalysisSettings(storage, invalid)).toEqual({
    plugins: {},
    rules: {},
  });
  expect(loadAnalysisSettings(storage)).toEqual({ plugins: {}, rules: {} });
});
