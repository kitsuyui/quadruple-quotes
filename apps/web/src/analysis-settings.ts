import {
  MAX_ALLOWED_WORDS,
  MAX_DOCUMENT_EXCEPTIONS,
  MAX_SAVED_PRESETS,
  validAllowedWord,
  wordKey,
} from "../../../packages/analysis/src/settings";
import type {
  AnalysisSettings,
  RuleSettings,
  SavedAnalysisPreset,
  Severity,
} from "../../../packages/analysis/src/types";

// Keep the storage key stable. Version 1 is read without writing; edits use v2.
export const ANALYSIS_SETTINGS_KEY =
  "quadruple-quotes.proofreading-settings.v1";
export type AnalysisPreferences = {
  settings: AnalysisSettings;
  presets: SavedAnalysisPreset[];
};
const defaults = (): AnalysisPreferences => ({
  settings: { plugins: {}, rules: {} },
  presets: [],
});
const invalid = () =>
  new Error("Proofreading settings are invalid and were not changed.");

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\p{C}]/u.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}
function map<T>(
  value: unknown,
  accepts: (item: unknown) => item is T,
): Record<string, T> {
  const entries = Object.entries(object(value));
  if (
    entries.length > 200 ||
    entries.some(([key, item]) => !identifier(key) || !accepts(item))
  )
    throw invalid();
  return Object.fromEntries(entries) as Record<string, T>;
}
const severity = (value: unknown): value is Severity =>
  value === "info" || value === "warning" || value === "error";
const ruleKeys = ["plugins", "rules", "characterLimit", "severities"];
function ruleSettings(value: unknown, keys = ruleKeys): RuleSettings {
  const candidate = object(value, keys);
  const result: RuleSettings = {
    plugins: map(
      candidate.plugins,
      (item): item is boolean => typeof item === "boolean",
    ),
    rules: map(
      candidate.rules,
      (item): item is boolean => typeof item === "boolean",
    ),
  };
  if (candidate.characterLimit !== undefined) {
    if (
      typeof candidate.characterLimit !== "number" ||
      !Number.isSafeInteger(candidate.characterLimit) ||
      candidate.characterLimit < 1 ||
      candidate.characterLimit > 1_000_000_000
    )
      throw invalid();
    result.characterLimit = candidate.characterLimit;
  }
  if (candidate.severities !== undefined)
    result.severities = map(candidate.severities, severity);
  return result;
}

function parse(raw: string | null): AnalysisPreferences {
  if (raw === null) return defaults();
  const value = object(JSON.parse(raw));
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    throw new Error(
      "Proofreading settings use an unsupported version and were not changed.",
    );
  if (value.schemaVersion === 1) {
    object(value, ["schemaVersion", "settings"]);
    return {
      settings: ruleSettings(value.settings, ruleKeys.slice(0, 3)),
      presets: [],
    };
  }
  object(value, ["schemaVersion", "settings", "presets"]);
  const candidate = object(value.settings, [
    ...ruleKeys,
    "allowedWords",
    "ignoredRules",
  ]);
  const settings: AnalysisSettings = ruleSettings(candidate, [
    ...ruleKeys,
    "allowedWords",
    "ignoredRules",
  ]);
  if (candidate.allowedWords !== undefined) {
    if (
      !Array.isArray(candidate.allowedWords) ||
      candidate.allowedWords.length > MAX_ALLOWED_WORDS ||
      candidate.allowedWords.some(
        (word) => typeof word !== "string" || !validAllowedWord(word),
      ) ||
      new Set(candidate.allowedWords.map(wordKey)).size !==
        candidate.allowedWords.length
    )
      throw invalid();
    settings.allowedWords = [...candidate.allowedWords];
  }
  if (candidate.ignoredRules !== undefined) {
    if (
      !Array.isArray(candidate.ignoredRules) ||
      candidate.ignoredRules.length > MAX_DOCUMENT_EXCEPTIONS
    )
      throw invalid();
    const ignored = candidate.ignoredRules.map((item) => {
      const exception = object(item, ["documentId", "ruleId"]);
      if (
        typeof exception.documentId !== "string" ||
        !exception.documentId ||
        exception.documentId.length > 512 ||
        /[\p{C}]/u.test(exception.documentId) ||
        !identifier(exception.ruleId)
      )
        throw invalid();
      return { documentId: exception.documentId, ruleId: exception.ruleId };
    });
    if (
      new Set(ignored.map((item) => JSON.stringify(item))).size !==
      ignored.length
    )
      throw invalid();
    settings.ignoredRules = ignored;
  }
  if (!Array.isArray(value.presets) || value.presets.length > MAX_SAVED_PRESETS)
    throw invalid();
  const presets = value.presets.map((item) => {
    const preset = object(item, ["name", "settings"]);
    if (
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      preset.name !== preset.name.trim() ||
      preset.name.length > 60 ||
      /[\p{C}]/u.test(preset.name)
    )
      throw invalid();
    return { name: preset.name, settings: ruleSettings(preset.settings) };
  });
  if (
    new Set(presets.map((item) => item.name.toLowerCase())).size !==
    presets.length
  )
    throw invalid();
  return { settings, presets };
}

export function loadAnalysisPreferences(storage: Storage): AnalysisPreferences {
  return parse(storage.getItem(ANALYSIS_SETTINGS_KEY));
}
export function loadAnalysisSettings(storage: Storage): AnalysisSettings {
  return loadAnalysisPreferences(storage).settings;
}

export function saveAnalysisSettings(
  storage: Storage,
  settings: AnalysisSettings,
  expectedRaw?: string | null,
  presets?: SavedAnalysisPreset[],
) {
  const currentRaw = storage.getItem(ANALYSIS_SETTINGS_KEY);
  if (expectedRaw !== undefined && currentRaw !== expectedRaw)
    throw new Error(
      "Proofreading settings changed in another tab. Reload before saving settings.",
    );
  // Validate the inspected value too: only an explicit reset replaces corrupt data.
  const previous = parse(currentRaw);
  const raw = JSON.stringify({
    schemaVersion: 2,
    settings,
    presets: presets ?? previous.presets,
  });
  parse(raw);
  storage.setItem(ANALYSIS_SETTINGS_KEY, raw);
  return raw;
}

export function safelyLoadAnalysisSettings(storage: Storage) {
  let raw: string | null = null;
  try {
    raw = storage.getItem(ANALYSIS_SETTINGS_KEY);
    return { ...parse(raw), raw, error: null as string | null };
  } catch (error) {
    return {
      ...defaults(),
      raw,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Only the exact value inspected by this tab can be explicitly reset. */
export function resetAnalysisSettings(
  storage: Storage,
  expectedRaw: string | null,
) {
  if (storage.getItem(ANALYSIS_SETTINGS_KEY) !== expectedRaw)
    throw new Error(
      "Proofreading settings changed in another tab. Reload before resetting.",
    );
  const preferences = defaults();
  storage.setItem(
    ANALYSIS_SETTINGS_KEY,
    JSON.stringify({ schemaVersion: 2, ...preferences }),
  );
  return preferences.settings;
}
