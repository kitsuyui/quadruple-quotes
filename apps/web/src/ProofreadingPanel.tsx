import { useEffect, useState } from "react";
import type {
  AnalysisResult,
  AnalysisSettings,
  PluginDescriptor,
} from "../../../packages/analysis/src/types";

export function ProofreadingPanel({
  result,
  catalog,
  open,
  onClose,
  onSelect,
  settings,
  onSettings,
  onDependencies,
}: {
  result: AnalysisResult | null;
  catalog: PluginDescriptor[];
  open: boolean;
  onClose(): void;
  onSelect(start: number, end: number): void;
  settings: AnalysisSettings;
  onSettings(settings: AnalysisSettings): void;
  onDependencies(): void;
}) {
  const [filter, setFilter] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  useEffect(() => {
    if (!open) {
      setFilter("");
      setRuleFilter("");
    }
  }, [open]);
  if (!open) return null;
  const diagnostics = (result?.diagnostics ?? [])
    .filter((item) =>
      `${item.pluginId} ${item.ruleId} ${item.message}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .slice(0, 50);
  const dependencies = result?.dependencies ?? [];
  const dependencyById = new Map(dependencies.map((node) => [node.id, node]));
  return (
    <aside className="proofreading-panel" aria-label="Proofreading">
      <header>
        <strong>Proofreading</strong>
        <button type="button" aria-label="Close proofreading" onClick={onClose}>
          ×
        </button>
      </header>
      {result && (
        <div className="analysis-metrics">
          <span>
            {result.metrics.characters.toLocaleString()} grapheme clusters
          </span>
          <span>{result.metrics.utf16Units.toLocaleString()} UTF-16 units</span>
          <span>{result.metrics.bytes.toLocaleString()} UTF-8 bytes</span>
          <span>{result.metrics.lines.toLocaleString()} lines</span>
        </div>
      )}
      <input
        className="analysis-search"
        aria-label="Filter issues"
        placeholder="Filter issues"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <p className="analysis-summary">
        {result
          ? `${result.diagnostics.length} issue${result.diagnostics.length === 1 ? "" : "s"}`
          : "Analyzing…"}
      </p>
      {result && (
        <ul className="analysis-statuses" aria-label="Plugin status">
          {result.statuses
            .filter((status) => status.status !== "ok")
            .map((status) => (
              <li key={status.pluginId}>
                <strong>{status.pluginId}</strong>: {status.status}
                {status.message ? ` — ${status.message}` : ""}
              </li>
            ))}
        </ul>
      )}
      <ul className="analysis-issues">
        {diagnostics.map((item) => (
          <li
            key={`${item.pluginId}-${item.ruleId}-${item.range.start}-${item.range.end}-${item.message}`}
          >
            <button
              type="button"
              onClick={() => onSelect(item.range.start, item.range.end)}
            >
              <small>
                {item.pluginId} · {item.ruleId}
              </small>
              {item.message}
            </button>
          </li>
        ))}
      </ul>
      <details className="analysis-settings">
        <summary>Rules and plugins</summary>
        <input
          className="analysis-search"
          aria-label="Search rules and plugins"
          placeholder="Search rules and plugins"
          value={ruleFilter}
          onChange={(event) => setRuleFilter(event.target.value)}
        />
        {catalog.map((plugin) => {
          const query = ruleFilter.toLowerCase();
          const rules = plugin.rules.filter((rule) =>
            `${rule.id} ${rule.name} ${rule.description}`
              .toLowerCase()
              .includes(query),
          );
          const matchesPlugin =
            `${plugin.id} ${plugin.name} ${plugin.description}`
              .toLowerCase()
              .includes(query);
          if (query && !matchesPlugin && rules.length === 0) return null;
          return (
            <details key={plugin.id} className="analysis-plugin" open={!!query}>
              <summary>{plugin.name}</summary>
              <label>
                <input
                  type="checkbox"
                  checked={settings.plugins[plugin.id] ?? plugin.defaultEnabled}
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
              {rules.map((rule) => (
                <label key={rule.id}>
                  <input
                    type="checkbox"
                    checked={settings.rules[rule.id] ?? rule.defaultEnabled}
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
              ))}
            </details>
          );
        })}
        <p>Settings are stored separately from your texts.</p>
      </details>
      {(settings.plugins.ginza ?? false) && (
        <button type="button" onClick={onDependencies}>
          Run dependency analysis
        </button>
      )}
      {dependencies.length ? (
        <table className="dependency-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Head</th>
              <th>Relation</th>
              <th>Sentence</th>
            </tr>
          </thead>
          <tbody>
            {dependencies.slice(0, 200).map((node) => (
              <tr key={node.id}>
                <td>
                  <button
                    type="button"
                    onClick={() => onSelect(node.range.start, node.range.end)}
                  >
                    {node.text}
                  </button>
                </td>
                <td>
                  {node.head === null
                    ? "—"
                    : (dependencyById.get(node.head)?.text ?? node.head)}
                </td>
                <td>{node.relation}</td>
                <td>{node.sentence + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {dependencies.length > 200 ? (
        <p>{dependencies.length - 200} more dependencies are not shown.</p>
      ) : null}
    </aside>
  );
}
