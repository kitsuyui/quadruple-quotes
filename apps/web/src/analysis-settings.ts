import type { AnalysisSettings } from "../../../packages/analysis/src/types";

export const ANALYSIS_SETTINGS_KEY =
  "quadruple-quotes.proofreading-settings.v1";
const defaults: AnalysisSettings = { plugins: {}, rules: {} };
type Envelope = { schemaVersion: 1; settings: AnalysisSettings };

function booleanMap(value: unknown): value is Record<string, boolean> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "boolean")
  );
}

export function loadAnalysisSettings(storage: Storage): AnalysisSettings {
  const raw = storage.getItem(ANALYSIS_SETTINGS_KEY);
  if (raw === null) return defaults;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Proofreading settings are invalid and were not changed.");
  const envelope = value as Partial<Envelope>;
  if (envelope.schemaVersion !== 1 || !envelope.settings)
    throw new Error(
      "Proofreading settings use an unsupported version and were not changed.",
    );
  const candidate = envelope.settings;
  if (
    !candidate.plugins ||
    !candidate.rules ||
    !booleanMap(candidate.plugins) ||
    !booleanMap(candidate.rules) ||
    (candidate.characterLimit !== undefined &&
      (!Number.isFinite(candidate.characterLimit) ||
        candidate.characterLimit <= 0))
  )
    throw new Error("Proofreading settings are invalid and were not changed.");
  return {
    plugins: candidate.plugins as Record<string, boolean>,
    rules: candidate.rules as Record<string, boolean>,
    characterLimit: candidate.characterLimit,
  };
}

export function saveAnalysisSettings(
  storage: Storage,
  settings: AnalysisSettings,
  expectedRaw?: string | null,
) {
  if (
    expectedRaw !== undefined &&
    storage.getItem(ANALYSIS_SETTINGS_KEY) !== expectedRaw
  )
    throw new Error(
      "Proofreading settings changed in another tab. Reload before saving settings.",
    );
  const raw = JSON.stringify({ schemaVersion: 1, settings } satisfies Envelope);
  storage.setItem(ANALYSIS_SETTINGS_KEY, raw);
  return raw;
}

export function safelyLoadAnalysisSettings(storage: Storage) {
  try {
    return {
      settings: loadAnalysisSettings(storage),
      error: null as string | null,
    };
  } catch (error) {
    return {
      settings: defaults,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Reset only the exact corrupt value this tab inspected; never erase a newer tab's settings. */
export function resetAnalysisSettings(
  storage: Storage,
  expectedRaw: string | null,
) {
  if (storage.getItem(ANALYSIS_SETTINGS_KEY) !== expectedRaw)
    throw new Error(
      "Proofreading settings changed in another tab. Reload before resetting.",
    );
  saveAnalysisSettings(storage, defaults, expectedRaw);
  return defaults;
}
