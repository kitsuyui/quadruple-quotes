import { useEffect, useState } from "react";
import type {
  AnalysisResult,
  AnalysisSettings,
  Diagnostic,
  DiagnosticFix,
  PluginDescriptor,
  SavedAnalysisPreset,
} from "../../../packages/analysis/src/types";
import {
  DiagnosticExceptionButtons,
  type ExceptionAction,
} from "./DiagnosticExceptionButtons";
import { DiagnosticFixButtons } from "./DiagnosticFixButtons";
import { ProofreadingSettings } from "./ProofreadingSettings";

export function ProofreadingPanel({
  result,
  catalog,
  open,
  onClose,
  onSelect,
  settings,
  onSettings,
  onDependencies,
  onJapaneseStyle,
  onApply,
  disabled,
  presets,
  document,
  documents,
  text,
  onException,
}: {
  result: AnalysisResult | null;
  catalog: PluginDescriptor[];
  open: boolean;
  onClose(): void;
  onSelect(start: number, end: number, diagnostic?: Diagnostic): void;
  onApply(diagnostic: Diagnostic, fix: DiagnosticFix): void;
  disabled: boolean;
  settings: AnalysisSettings;
  onSettings(
    settings: AnalysisSettings,
    presets?: SavedAnalysisPreset[],
  ): boolean;
  presets: SavedAnalysisPreset[];
  document: { id: string; title: string } | null;
  documents: { id: string; title: string }[];
  text: string;
  onException(diagnostic: Diagnostic, action: ExceptionAction): void;
  onDependencies(): void;
  onJapaneseStyle(): void;
}) {
  const [filter, setFilter] = useState("");
  const [selectedDependency, setSelectedDependency] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (!open) {
      setFilter("");
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
  // Rust core applies rule severity and document exceptions before this UI sees
  // an advisory. The parser graph only supplies token relationships.
  const dependencyAdvisories = (result?.diagnostics ?? []).flatMap(
    (diagnostic) => {
      if (diagnostic.ruleId !== "ginza.long-dependency") return [];
      const node = dependencies.find(
        (candidate) =>
          candidate.range.start === diagnostic.range.start &&
          candidate.range.end === diagnostic.range.end,
      );
      const head =
        node?.head === null ? undefined : dependencyById.get(node?.head ?? -1);
      return node && head ? [{ node, head }] : [];
    },
  );
  const selectDependency = (id: number) => {
    const node = dependencyById.get(id);
    if (!node) return;
    setSelectedDependency(id);
    onSelect(node.range.start, node.range.end);
  };
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
              onClick={() => onSelect(item.range.start, item.range.end, item)}
              className="analysis-issue-select"
            >
              <small>
                {item.pluginId} · {item.ruleId}
              </small>
              {item.message}
            </button>
            <DiagnosticFixButtons
              fixes={item.fixes}
              disabled={disabled}
              onApply={(fix) => onApply(item, fix)}
            />
            <DiagnosticExceptionButtons
              diagnostic={item}
              text={text}
              disabled={disabled || !result}
              onException={onException}
            />
          </li>
        ))}
      </ul>
      <ProofreadingSettings
        settings={settings}
        presets={presets}
        catalog={catalog}
        document={document}
        documents={documents}
        disabled={disabled}
        onSettings={onSettings}
      />
      {(settings.plugins.ginza ?? false) && (
        <button type="button" onClick={onDependencies}>
          Run dependency analysis
        </button>
      )}
      {(settings.plugins["textlint-ja-morphology"] ?? false) && (
        <button type="button" onClick={onJapaneseStyle}>
          Run local Japanese style analysis (5,000 UTF-16 units max)
        </button>
      )}
      {dependencies.length ? (
        <>
          {dependencyAdvisories.length > 0 && (
            <section
              className="dependency-advisories"
              aria-label="Dependency advisories"
            >
              <strong>Dependency inspection cues</strong>
              <p>
                These are not grammar errors. Review the connected tokens in
                context.
              </p>
              <ul>
                {dependencyAdvisories.slice(0, 20).map(({ node, head }) => (
                  <li key={`advisory-${node.id}`}>
                    <button
                      type="button"
                      onClick={() => selectDependency(node.id)}
                    >
                      {node.text}
                    </button>
                    {" → "}
                    <button
                      type="button"
                      onClick={() => selectDependency(head.id)}
                    >
                      {head.text}
                    </button>
                    {` (${node.relation}; ${Math.abs(node.range.start - head.range.start)} UTF-16 units apart)`}
                  </li>
                ))}
              </ul>
            </section>
          )}
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
                <tr
                  key={node.id}
                  className={
                    selectedDependency === node.id ||
                    node.head === selectedDependency
                      ? "dependency-selected"
                      : undefined
                  }
                >
                  <td>
                    <button
                      type="button"
                      onClick={() => selectDependency(node.id)}
                    >
                      {node.text}
                    </button>
                  </td>
                  <td>
                    {node.head === null ? (
                      "—"
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectDependency(node.head!)}
                      >
                        {dependencyById.get(node.head)?.text ?? node.head}
                      </button>
                    )}
                  </td>
                  <td>{node.relation}</td>
                  <td>{node.sentence + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {dependencies.length > 200 ? (
        <p>{dependencies.length - 200} more dependencies are not shown.</p>
      ) : null}
    </aside>
  );
}
