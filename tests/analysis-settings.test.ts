import { expect, test } from "bun:test";
import {
  ANALYSIS_SETTINGS_KEY,
  loadAnalysisPreferences,
  loadAnalysisSettings,
  resetAnalysisSettings,
  safelyLoadAnalysisSettings,
  saveAnalysisSettings,
} from "../apps/web/src/analysis-settings";
import {
  addPreset,
  allowWord,
  applyPreset,
  builtinPreset,
  ignoreRule,
  sameRulePolicy,
} from "../packages/analysis/src/settings";
import type {
  AnalysisSettings,
  PluginDescriptor,
} from "../packages/analysis/src/types";

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
    schemaVersion: 2,
    settings,
    presets: [],
  });
});

test("malformed, unknown-version, array, and non-boolean settings fail closed without overwriting raw storage", () => {
  const invalidValues = [
    "{broken",
    JSON.stringify({ schemaVersion: 3, settings: { plugins: {}, rules: {} } }),
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
      presets: [],
      raw,
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

test("legacy settings are read without writes and upgrade only on an explicit change", () => {
  const storage = new MemoryStorage();
  const settings = {
    plugins: { typos: false, future: true },
    rules: { "future.rule": false },
    characterLimit: 100,
  };
  const raw = JSON.stringify({ schemaVersion: 1, settings });
  storage.setItem(ANALYSIS_SETTINGS_KEY, raw);
  expect(loadAnalysisPreferences(storage)).toEqual({ settings, presets: [] });
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(raw);
  saveAnalysisSettings(storage, { ...settings, allowedWords: ["teh"] }, raw);
  expect(loadAnalysisSettings(storage)).toEqual({
    ...settings,
    allowedWords: ["teh"],
  });
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toContain('"schemaVersion":2');
});

test("custom presets persist separately from word and document exceptions and survive ordinary settings edits", () => {
  const storage = new MemoryStorage();
  const settings: AnalysisSettings = {
    plugins: { typos: true },
    rules: {},
    severities: { "typos.spelling": "info" },
    allowedWords: ["teh"],
    ignoredRules: [{ documentId: "one", ruleId: "core.zero-width" }],
  };
  const presets = addPreset([], "Gentle", settings);
  const raw = saveAnalysisSettings(storage, settings, null, presets);
  expect(loadAnalysisPreferences(storage)).toEqual({ settings, presets });
  expect(presets[0].settings).not.toHaveProperty("allowedWords");
  expect(presets[0].settings).not.toHaveProperty("ignoredRules");
  saveAnalysisSettings(storage, { ...settings, characterLimit: 20 }, raw);
  expect(loadAnalysisPreferences(storage).presets).toEqual(presets);
  expect(() => addPreset(presets, " gentle ", settings)).toThrow(
    "already exists",
  );
  expect(() => addPreset(presets, "\u0000bad", settings)).toThrow();
});

test("invalid policy, future fields, and oversized settings are protected on both reads and writes", () => {
  const valid = { plugins: {}, rules: {} };
  for (const settings of [
    { ...valid, severities: { "typos.spelling": "fatal" } },
    { ...valid, characterLimit: 1.5 },
    { ...valid, characterLimit: Infinity },
    { ...valid, allowedWords: ["teh", "TEH"] },
    { ...valid, allowedWords: Array(501).fill("teh") },
    {
      ...valid,
      ignoredRules: [
        { documentId: "one", ruleId: "x" },
        { documentId: "one", ruleId: "x" },
      ],
    },
    { ...valid, futurePolicy: true },
  ]) {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 2, settings, presets: [] });
    storage.setItem(ANALYSIS_SETTINGS_KEY, raw);
    expect(() => loadAnalysisSettings(storage)).toThrow();
    expect(() => saveAnalysisSettings(storage, valid, raw)).toThrow();
    expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(raw);
  }
  const storage = new MemoryStorage();
  const raw = saveAnalysisSettings(storage, valid);
  expect(() =>
    saveAnalysisSettings(storage, { ...valid, characterLimit: -1 }, raw),
  ).toThrow();
  expect(storage.getItem(ANALYSIS_SETTINGS_KEY)).toBe(raw);
  expect(() =>
    saveAnalysisSettings(storage, valid, raw, [
      { name: "bad", settings: { ...valid, allowedWords: ["x"] } } as never,
    ]),
  ).toThrow();
});

const catalog: PluginDescriptor[] = [
  ["core", ["core.zero-width"]],
  ["typos", ["typos.spelling"]],
  ["style", ["style.filler"]],
  ["markdownlint", ["markdownlint.MD009"]],
  ["textlint-ja", ["textlint-ja.no-nfd", "textlint-ja.mixed-period"]],
  ["textlint-ai", ["textlint-ai.hype"]],
  ["ginza", []],
].map(([id, rules]) => ({
  id: id as string,
  name: id as string,
  description: "",
  defaultEnabled: id === "core" || id === "typos" || id === "markdownlint",
  runPolicy: id === "ginza" ? "manual" : "realtime",
  rules: (rules as string[]).map((rule) => ({
    id: rule,
    name: rule,
    description: "",
    defaultEnabled: !rule.endsWith("mixed-period"),
  })),
}));

test("built-in presets replace known switches, preserve exceptions and unknown IDs, and keep heavy/AI plugins off", () => {
  const original: AnalysisSettings = {
    plugins: { future: true, ginza: true, "textlint-ai": true },
    rules: { "future.rule": false },
    severities: { "typos.spelling": "error", "future.rule": "info" },
    characterLimit: 10,
    allowedWords: ["teh"],
    ignoredRules: [{ documentId: "one", ruleId: "typos.spelling" }],
  };
  for (const id of ["basic", "japanese", "markdown"] as const) {
    const preset = builtinPreset(id, catalog);
    const applied = applyPreset(original, preset, catalog);
    expect(applied.allowedWords).toEqual(original.allowedWords);
    expect(applied.ignoredRules).toEqual(original.ignoredRules);
    expect(applied.plugins.future).toBe(true);
    expect(applied.rules["future.rule"]).toBe(false);
    expect(applied.severities).toEqual({ "future.rule": "info" });
    expect(applied.characterLimit).toBeUndefined();
    expect(applied.plugins.ginza).toBe(false);
    expect(applied.plugins["textlint-ai"]).toBe(false);
    expect(applied.plugins.markdownlint).toBe(id === "markdown");
    expect(applied.plugins["textlint-ja"]).toBe(id !== "basic");
    expect(sameRulePolicy(applied, preset, catalog)).toBe(true);
  }
  expect(original.plugins.ginza).toBe(true);
  const saved = addPreset(
    [],
    "Default",
    { plugins: {}, rules: {} },
    catalog,
  )[0];
  expect(saved.settings.plugins.typos).toBe(true);
  expect(saved.settings.rules["core.zero-width"]).toBe(true);
});

test("exception registration is scoped, deduplicated and bounded without editing the input", () => {
  const original: AnalysisSettings = { plugins: {}, rules: {} };
  const allowed = allowWord(original, " TeH ");
  expect(allowWord(allowed, "teh")).toBe(allowed);
  expect(() => allowWord(allowed, "two words")).toThrow();
  const ignored = ignoreRule(allowed, "one", "typos.spelling");
  expect(ignoreRule(ignored, "one", "typos.spelling")).toBe(ignored);
  expect(
    ignoreRule(ignored, "copy", "typos.spelling").ignoredRules,
  ).toHaveLength(2);
  expect(original).toEqual({ plugins: {}, rules: {} });
  expect(() =>
    addPreset(
      Array.from({ length: 20 }, (_, index) => ({
        name: `${index}`,
        settings: original,
      })),
      "Extra",
      original,
    ),
  ).toThrow("limit: 20");
  expect(() =>
    allowWord(
      {
        ...original,
        allowedWords: Array.from({ length: 500 }, (_, index) => `word${index}`),
      },
      "extra",
    ),
  ).toThrow("limit: 500");
  expect(() =>
    ignoreRule(
      {
        ...original,
        ignoredRules: Array.from({ length: 500 }, (_, index) => ({
          documentId: `${index}`,
          ruleId: "x",
        })),
      },
      "extra",
      "x",
    ),
  ).toThrow("limit: 500");
});
