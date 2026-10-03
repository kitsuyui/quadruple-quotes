import type {
  Diagnostic,
  Severity,
} from "../../../packages/analysis/src/types";

export interface DiagnosticSegment {
  start: number;
  end: number;
  severity?: Severity;
  diagnosticIndices?: number[];
}

const priority: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

/** Display ranges expand to graphemes; the original diagnostic offsets stay intact. */
export function diagnosticSegments(
  text: string,
  diagnostics: Diagnostic[],
): DiagnosticSegment[] {
  if (!text || !diagnostics.length || text.length > 100_000)
    return [{ start: 0, end: text.length }];

  const boundaries = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (segment) => segment.index,
  );
  boundaries.push(text.length);
  function graphemeAt(offset: number) {
    let low = 0;
    let high = boundaries.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (boundaries[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  const ranges: (DiagnosticSegment & { diagnosticIndex: number })[] = [];
  for (const [diagnosticIndex, diagnostic] of diagnostics
    .slice(0, 200)
    .entries()) {
    const { start, end } = diagnostic.range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > text.length
    )
      continue;
    const first = graphemeAt(Math.min(start, text.length - 1));
    const last = graphemeAt(
      Math.min(Math.max(start, end - 1), text.length - 1),
    );
    let displayStart = boundaries[first];
    let displayEnd = boundaries[last + 1];
    // Give invisible controls and newline/insertion diagnostics a visible anchor.
    if (/^[\p{Cf}\p{Cc}\p{M}]+$/u.test(text.slice(displayStart, displayEnd))) {
      if (last + 2 < boundaries.length) displayEnd = boundaries[last + 2];
      else if (first > 0) displayStart = boundaries[first - 1];
    }
    ranges.push({
      start: displayStart,
      end: displayEnd,
      severity: diagnostic.severity,
      diagnosticIndex,
    });
  }

  const offsets = [
    ...new Set([
      0,
      text.length,
      ...ranges.flatMap((range) => [range.start, range.end]),
    ]),
  ].sort((a, b) => a - b);
  const segments: DiagnosticSegment[] = [];
  for (let index = 0; index + 1 < offsets.length; index += 1) {
    const start = offsets[index];
    const end = offsets[index + 1];
    let severity: Severity | undefined;
    const diagnosticIndices: number[] = [];
    for (const range of ranges) {
      if (range.start <= start && range.end >= end && range.severity) {
        diagnosticIndices.push(range.diagnosticIndex);
        if (!severity || priority[range.severity] > priority[severity])
          severity = range.severity;
      }
    }
    const previous = segments.at(-1);
    const indices = diagnosticIndices.length ? diagnosticIndices : undefined;
    if (
      previous &&
      previous.severity === severity &&
      previous.diagnosticIndices?.join(",") === indices?.join(",")
    )
      previous.end = end;
    else
      segments.push({
        start,
        end,
        severity,
        ...(indices ? { diagnosticIndices: indices } : {}),
      });
  }
  return segments;
}
