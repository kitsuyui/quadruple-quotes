import type {
  AnalysisSettings,
  PluginDescriptor,
  RuleSettings,
  SavedAnalysisPreset,
} from "./types";

export const MAX_SAVED_PRESETS = 20;
export const MAX_ALLOWED_WORDS = 500;
export const MAX_DOCUMENT_EXCEPTIONS = 500;
export const BUILTIN_PRESETS = [
  {
    id: "basic",
    name: "Basic",
    description: "Text health and English spelling. Other analyzers stay off.",
  },
  {
    id: "japanese",
    name: "Japanese prose",
    description:
      "Basic checks plus normalization, sentence endings and length.",
  },
  {
    id: "markdown",
    name: "Markdown documentation",
    description:
      "Basic checks plus Markdown structure and Japanese normalization. Choose Markdown format separately.",
  },
] as const;
export type BuiltinPresetId = (typeof BUILTIN_PRESETS)[number]["id"];

export function builtinPreset(
  id: BuiltinPresetId,
  catalog: PluginDescriptor[],
): RuleSettings {
  return {
    plugins: Object.fromEntries(
      catalog.map((plugin) => [
        plugin.id,
        plugin.id === "core" ||
          plugin.id === "typos" ||
          (plugin.id === "textlint-ja" && id !== "basic") ||
          (plugin.id === "markdownlint" && id === "markdown"),
      ]),
    ),
    rules: Object.fromEntries(
      catalog.flatMap((plugin) =>
        plugin.rules.map((rule) => [
          rule.id,
          rule.id === "textlint-ja.invalid-control"
            ? false // The core already checks controls.
            : rule.id === "textlint-ja.mixed-period" ||
                rule.id === "textlint-ja.sentence-length"
              ? id === "japanese"
              : rule.defaultEnabled,
        ]),
      ),
    ),
  };
}

/** Presets contain rule policy only; personal and document exceptions survive. */
export function applyPreset(
  current: AnalysisSettings,
  preset: RuleSettings,
  catalog: PluginDescriptor[],
): AnalysisSettings {
  const pluginIds = new Set(catalog.map((plugin) => plugin.id));
  const ruleIds = new Set(
    catalog.flatMap((plugin) => plugin.rules.map((rule) => rule.id)),
  );
  const unknown = <T>(values: Record<string, T>, known: Set<string>) =>
    Object.fromEntries(Object.entries(values).filter(([id]) => !known.has(id)));
  return {
    ...current,
    plugins: { ...unknown(current.plugins, pluginIds), ...preset.plugins },
    rules: { ...unknown(current.rules, ruleIds), ...preset.rules },
    severities: {
      ...unknown(current.severities ?? {}, ruleIds),
      ...preset.severities,
    },
    characterLimit: preset.characterLimit,
  };
}

export function presetSnapshot(
  settings: AnalysisSettings,
  catalog: PluginDescriptor[] = [],
): RuleSettings {
  return structuredClone({
    plugins: {
      ...Object.fromEntries(
        catalog.map((plugin) => [plugin.id, plugin.defaultEnabled]),
      ),
      ...settings.plugins,
    },
    rules: {
      ...Object.fromEntries(
        catalog.flatMap((plugin) =>
          plugin.rules.map((rule) => [rule.id, rule.defaultEnabled]),
        ),
      ),
      ...settings.rules,
    },
    characterLimit: settings.characterLimit,
    severities: settings.severities,
  });
}

export function addPreset(
  presets: SavedAnalysisPreset[],
  name: string,
  settings: AnalysisSettings,
  catalog: PluginDescriptor[] = [],
): SavedAnalysisPreset[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60 || /[\p{C}]/u.test(trimmed))
    throw new Error(
      "Use a preset name of 1–60 characters without control characters.",
    );
  if (
    presets.some(
      (preset) => preset.name.toLowerCase() === trimmed.toLowerCase(),
    )
  )
    throw new Error(
      "A preset with this name already exists. Choose another name.",
    );
  if (presets.length >= MAX_SAVED_PRESETS)
    throw new Error("Remove a saved preset before adding another (limit: 20).");
  return [
    ...presets,
    { name: trimmed, settings: presetSnapshot(settings, catalog) },
  ];
}

export function sameRulePolicy(
  a: RuleSettings,
  b: RuleSettings,
  catalog: PluginDescriptor[],
) {
  const key = (settings: RuleSettings) =>
    JSON.stringify([
      catalog.map(
        (plugin) => settings.plugins[plugin.id] ?? plugin.defaultEnabled,
      ),
      catalog.flatMap((plugin) =>
        plugin.rules.map((rule) => [
          settings.rules[rule.id] ?? rule.defaultEnabled,
          settings.severities?.[rule.id] ?? null,
        ]),
      ),
      settings.characterLimit ?? null,
    ]);
  return key(a) === key(b);
}

export function validAllowedWord(word: string) {
  return (
    word.length > 0 && word.length <= 100 && /^[\p{L}\p{M}\p{N}]+$/u.test(word)
  );
}

// The spelling dictionary's allowlist folds ASCII case without altering text.
export function wordKey(word: string) {
  return word.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function allowWord(
  settings: AnalysisSettings,
  word: string,
): AnalysisSettings {
  const trimmed = word.trim();
  if (!validAllowedWord(trimmed))
    throw new Error(
      "Use one word of up to 100 characters, without spaces or punctuation.",
    );
  const words = settings.allowedWords ?? [];
  if (words.some((value) => wordKey(value) === wordKey(trimmed)))
    return settings;
  if (words.length >= MAX_ALLOWED_WORDS)
    throw new Error(
      "Remove an allowed word before adding another (limit: 500).",
    );
  return { ...settings, allowedWords: [...words, trimmed] };
}

export function ignoreRule(
  settings: AnalysisSettings,
  documentId: string,
  ruleId: string,
): AnalysisSettings {
  const ignored = settings.ignoredRules ?? [];
  if (
    ignored.some(
      (item) => item.documentId === documentId && item.ruleId === ruleId,
    )
  )
    return settings;
  if (ignored.length >= MAX_DOCUMENT_EXCEPTIONS)
    throw new Error(
      "Remove a document exception before adding another (limit: 500).",
    );
  return { ...settings, ignoredRules: [...ignored, { documentId, ruleId }] };
}
