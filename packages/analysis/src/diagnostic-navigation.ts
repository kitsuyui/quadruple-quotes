import type { Diagnostic, Range } from "./types";

export function diagnosticKey(diagnostic: Diagnostic) {
  return JSON.stringify([
    diagnostic.pluginId,
    diagnostic.ruleId,
    diagnostic.range.start,
    diagnostic.range.end,
    diagnostic.message,
  ]);
}

/** Navigation follows source order, including distinct overlapping diagnostics. */
export function adjacentDiagnostic(
  diagnostics: Diagnostic[],
  selection: Range,
  direction: 1 | -1,
  selectedKey: string | null,
): Diagnostic | null {
  const ordered = [...diagnostics].sort(
    (a, b) => a.range.start - b.range.start || a.range.end - b.range.end,
  );
  if (!ordered.length) return null;
  const index = ordered.findIndex(
    (item) =>
      diagnosticKey(item) === selectedKey &&
      item.range.start === selection.start &&
      item.range.end === selection.end,
  );
  if (index >= 0)
    return ordered[(index + direction + ordered.length) % ordered.length];
  return direction === 1
    ? (ordered.find((item) => item.range.start >= selection.end) ?? ordered[0])
    : ([...ordered]
        .reverse()
        .find((item) => item.range.end <= selection.start) ??
        ordered.at(-1) ??
        null);
}
