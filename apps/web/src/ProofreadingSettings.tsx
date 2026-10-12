import { useEffect, useState } from "react";
import {
  addPreset,
  allowWord,
  applyPreset,
  BUILTIN_PRESETS,
  builtinPreset,
  ignoreRule,
  sameRulePolicy,
} from "../../../packages/analysis/src/settings";
import type {
  AnalysisSettings,
  PluginDescriptor,
  SavedAnalysisPreset,
  Severity,
} from "../../../packages/analysis/src/types";

export function ProofreadingSettings({
  settings,
  presets,
  catalog,
  document,
  documents,
  disabled,
  onSettings,
}: {
  settings: AnalysisSettings;
  presets: SavedAnalysisPreset[];
  catalog: PluginDescriptor[];
  document: { id: string; title: string } | null;
  documents: { id: string; title: string }[];
  disabled: boolean;
  onSettings(
    settings: AnalysisSettings,
    presets?: SavedAnalysisPreset[],
  ): boolean;
}) {
  const [choice, setChoice] = useState("basic");
  const [name, setName] = useState("");
  const [word, setWord] = useState("");
  const [limit, setLimit] = useState(String(settings.characterLimit ?? ""));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLimit(String(settings.characterLimit ?? ""));
  }, [settings.characterLimit]);
  const unavailable = disabled || catalog.length === 0;
  const selectedSaved = presets.find(
    (preset) => `saved:${preset.name}` === choice,
  );
  const selectedBuiltin =
    BUILTIN_PRESETS.find((preset) => preset.id === choice) ??
    (selectedSaved ? undefined : BUILTIN_PRESETS[0]);
  const currentName =
    presets.find((preset) => sameRulePolicy(settings, preset.settings, catalog))
      ?.name ??
    BUILTIN_PRESETS.find((preset) =>
      sameRulePolicy(settings, builtinPreset(preset.id, catalog), catalog),
    )?.name ??
    "Custom rules";
  const ruleNames = new Map(
    catalog.flatMap((plugin) =>
      plugin.rules.map((rule) => [rule.id, rule.name]),
    ),
  );
  const documentNames = new Map(
    documents.map((item) => [item.id, item.title.trim() || "Untitled text"]),
  );
  if (document)
    documentNames.set(document.id, document.title.trim() || "Untitled text");
  function attempt(action: () => void) {
    try {
      setError(null);
      action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <div className="proofreading-settings">
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <details className="analysis-settings">
        <summary>Presets</summary>
        <fieldset disabled={unavailable} className="settings-controls">
          <p className="settings-help">
            Current: {catalog.length ? currentName : "Loading rules…"}
          </p>
          <label>
            Proofreading preset
            <select
              className="settings-select"
              aria-label="Proofreading preset"
              value={selectedBuiltin || selectedSaved ? choice : "basic"}
              onChange={(event) => setChoice(event.target.value)}
            >
              <optgroup label="Built-in">
                {BUILTIN_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
              {presets.length > 0 && (
                <optgroup label="Saved">
                  {presets.map((preset) => (
                    <option key={preset.name} value={`saved:${preset.name}`}>
                      {preset.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <p className="settings-help">
            {selectedBuiltin?.description ??
              "Your saved rule switches, severities and character limit."}
          </p>
          <button
            type="button"
            onClick={() => {
              const policy =
                selectedSaved?.settings ??
                builtinPreset(selectedBuiltin?.id ?? "basic", catalog);
              onSettings(applyPreset(settings, policy, catalog));
            }}
          >
            Apply preset
          </button>
          <p className="settings-help">
            Applying replaces rule settings and the character limit. Allowed
            words and document exceptions are kept. AI hints and dependency
            analysis stay off in built-in presets.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              attempt(() => {
                if (
                  onSettings(
                    settings,
                    addPreset(presets, name, settings, catalog),
                  )
                )
                  setName("");
              });
            }}
            className="settings-form"
          >
            <label>
              Preset name
              <input
                className="settings-input"
                aria-label="Preset name"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="Save these rules as…"
              />
            </label>
            <button type="submit">Save current preset</button>
          </form>
          {presets.length > 0 && (
            <ul className="settings-list" aria-label="Saved presets">
              {presets.map((preset) => (
                <li className="settings-list-item" key={preset.name}>
                  <span className="settings-list-value">{preset.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={() =>
                      onSettings(
                        settings,
                        presets.filter((item) => item.name !== preset.name),
                      )
                    }
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </details>
      <details className="analysis-settings">
        <summary>Rules and plugins</summary>
        <fieldset disabled={unavailable} className="settings-controls">
          <input
            className="analysis-search"
            aria-label="Search rules and plugins"
            placeholder="Search rules and plugins"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              attempt(() => {
                const value = limit.trim() === "" ? undefined : Number(limit);
                if (
                  value !== undefined &&
                  (!Number.isSafeInteger(value) ||
                    value < 1 ||
                    value > 1_000_000_000)
                )
                  throw new Error(
                    "Use a whole character limit from 1 to 1,000,000,000, or leave it blank.",
                  );
                onSettings({ ...settings, characterLimit: value });
              });
            }}
          >
            <label>
              Character limit
              <input
                className="settings-input"
                aria-label="Character limit"
                type="number"
                min={1}
                max={1_000_000_000}
                step={1}
                placeholder="No limit"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </label>
            <button type="submit">Set limit</button>
          </form>
          <p className="settings-help">
            The limit counts grapheme clusters. A blank limit disables this
            check.
          </p>
          {catalog.map((plugin) => {
            const lower = query.toLowerCase();
            const rules = plugin.rules.filter((rule) =>
              `${rule.id} ${rule.name} ${rule.description}`
                .toLowerCase()
                .includes(lower),
            );
            if (
              lower &&
              !`${plugin.id} ${plugin.name} ${plugin.description}`
                .toLowerCase()
                .includes(lower) &&
              !rules.length
            )
              return null;
            return (
              <details
                key={plugin.id}
                className="analysis-plugin"
                open={!!query}
              >
                <summary>{plugin.name}</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      settings.plugins[plugin.id] ?? plugin.defaultEnabled
                    }
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        plugins: {
                          ...settings.plugins,
                          [plugin.id]: event.target.checked,
                        },
                      })
                    }
                  />{" "}
                  <strong>{plugin.name}</strong>
                </label>
                <span>{plugin.description}</span>
                {rules.map((rule) => {
                  const excluded = settings.ignoredRules?.some(
                    (item) =>
                      item.documentId === document?.id &&
                      item.ruleId === rule.id,
                  );
                  return (
                    <div className="analysis-rule" key={rule.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={
                            settings.rules[rule.id] ?? rule.defaultEnabled
                          }
                          onChange={(event) =>
                            onSettings({
                              ...settings,
                              rules: {
                                ...settings.rules,
                                [rule.id]: event.target.checked,
                              },
                            })
                          }
                        />{" "}
                        <small>{rule.name}</small>
                      </label>
                      <div className="rule-options">
                        <select
                          className="settings-select"
                          aria-label={`Severity for ${rule.name}`}
                          value={settings.severities?.[rule.id] ?? "default"}
                          onChange={(event) => {
                            const severities = { ...settings.severities };
                            if (event.target.value === "default")
                              delete severities[rule.id];
                            else
                              severities[rule.id] = event.target
                                .value as Severity;
                            onSettings({ ...settings, severities });
                          }}
                        >
                          <option value="default">Default severity</option>
                          <option value="info">Suggestion</option>
                          <option value="warning">Warning</option>
                          <option value="error">Error</option>
                        </select>
                        {document && (
                          <button
                            type="button"
                            aria-label={`${excluded ? "Restore" : "Exclude"} ${rule.name} in this document`}
                            onClick={() =>
                              attempt(() =>
                                onSettings(
                                  excluded
                                    ? {
                                        ...settings,
                                        ignoredRules:
                                          settings.ignoredRules?.filter(
                                            (item) =>
                                              item.documentId !== document.id ||
                                              item.ruleId !== rule.id,
                                          ),
                                      }
                                    : ignoreRule(
                                        settings,
                                        document.id,
                                        rule.id,
                                      ),
                                ),
                              )
                            }
                          >
                            {excluded ? "Restore here" : "Exclude here"}
                          </button>
                        )}
                      </div>
                      {excluded && (
                        <p className="settings-help">
                          Excluded for this document; still enabled elsewhere.
                        </p>
                      )}
                    </div>
                  );
                })}
              </details>
            );
          })}
        </fieldset>
      </details>
      <details className="analysis-settings">
        <summary>
          Exceptions (
          {(settings.allowedWords?.length ?? 0) +
            (settings.ignoredRules?.length ?? 0)}
          )
        </summary>
        <fieldset disabled={disabled} className="settings-controls">
          <p className="settings-help">
            Allowed spelling words apply to all texts, ignoring ASCII case. They
            do not suppress other checks.
          </p>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              attempt(() => {
                if (onSettings(allowWord(settings, word))) setWord("");
              });
            }}
          >
            <label>
              Allowed spelling word
              <input
                className="settings-input"
                aria-label="Allowed spelling word"
                value={word}
                maxLength={100}
                onChange={(event) => setWord(event.target.value)}
                placeholder="One word"
              />
            </label>
            <button type="submit">Add allowed word</button>
          </form>
          <ul className="settings-list" aria-label="Allowed spelling words">
            {(settings.allowedWords ?? []).map((item) => (
              <li className="settings-list-item" key={item}>
                <span className="settings-list-value">{item}</span>
                <button
                  type="button"
                  aria-label={`Remove allowed word ${item}`}
                  onClick={() =>
                    onSettings({
                      ...settings,
                      allowedWords: settings.allowedWords?.filter(
                        (value) => value !== item,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="settings-help">
            Document exceptions suppress every diagnostic from the named rule
            only in that document. Copies have their own exceptions.
          </p>
          <ul className="settings-list" aria-label="Document rule exceptions">
            {(settings.ignoredRules ?? []).map((item) => (
              <li className="settings-list-item" key={JSON.stringify(item)}>
                <span className="settings-list-value">
                  {ruleNames.get(item.ruleId) ?? item.ruleId}
                  <small>
                    {documentNames.get(item.documentId) ?? "Unavailable text"}
                    {item.documentId === document?.id ? " (current)" : ""}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`Remove exception ${item.ruleId} for ${documentNames.get(item.documentId) ?? "Unavailable text"}`}
                  onClick={() =>
                    onSettings({
                      ...settings,
                      ignoredRules: settings.ignoredRules?.filter(
                        (value) =>
                          value.documentId !== item.documentId ||
                          value.ruleId !== item.ruleId,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {!settings.ignoredRules?.length && (
            <p className="settings-help">No document exceptions.</p>
          )}
        </fieldset>
      </details>
      <p className="settings-help">
        Settings save separately from your texts. Changing them does not save or
        edit a draft.
      </p>
    </div>
  );
}
