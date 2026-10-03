import type { Diagnostic, Range } from "./types";

/** One replacement in the previous document's UTF-16 coordinates. */
export interface TextChange {
  start: number;
  end: number;
  insertedLength: number;
}

/** A bounded fallback for hosts, such as a textarea, without edit transactions. */
export function textChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  // Never split a surrogate pair when two replacements share one code unit.
  const lowSurrogate = (text: string, offset: number) =>
    offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset]);
  if (start > 0 && (lowSurrogate(before, start) || lowSurrogate(after, start)))
    start--;
  if (lowSurrogate(before, oldEnd) || lowSurrogate(after, newEnd)) {
    oldEnd++;
    newEnd++;
  }
  return { start, end: oldEnd, insertedLength: newEnd - start };
}

function valid(range: Range, length: number) {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= length
  );
}

function mapRange(range: Range, change: TextChange): Range | null {
  const insertion = change.start === change.end;
  const touched = insertion
    ? range.start === range.end
      ? change.start === range.start
      : change.start > range.start && change.start < range.end
    : range.start === range.end
      ? change.start <= range.start && change.end >= range.end
      : change.start < range.end && change.end > range.start;
  if (touched) return null;
  // Insertions at the start stay before the mark; at the end they stay after it.
  const shift =
    change.end <= range.start
      ? change.insertedLength - (change.end - change.start)
      : 0;
  return { start: range.start + shift, end: range.end + shift };
}

/** Context indexes are lazy and shared by all diagnostics in one update. */
function contextIndex(text: string) {
  const indexes = new Map<string, Range[]>();
  function ranges(scope: string) {
    const cached = indexes.get(scope);
    if (cached) return cached;
    let result: Range[];
    if (scope === "word")
      result = Array.from(
        text.matchAll(/[\p{L}\p{N}\p{M}_'’-]+/gu),
        (match) => ({
          start: match.index,
          end: match.index + match[0].length,
        }),
      );
    else {
      const starts =
        scope === "sentence"
          ? Array.from(
              new Intl.Segmenter(undefined, {
                granularity: "sentence",
              }).segment(text),
              (segment) => segment.index,
            )
          : [
              0,
              ...Array.from(
                text.matchAll(/\n[\t ]*\n/g),
                (match) => match.index + match[0].length,
              ),
            ];
      result = starts.map((start, index) => ({
        start,
        end: starts[index + 1] ?? text.length,
      }));
    }
    indexes.set(scope, result);
    return result;
  }
  function at(entries: Range[], offset: number) {
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (entries[middle].start <= offset) low = middle + 1;
      else high = middle;
    }
    return entries[low - 1];
  }
  return (range: Range, scope: Diagnostic["invalidationScope"]): Range => {
    if (scope === "range") return range;
    const entries = ranges(scope ?? "document");
    const first = at(entries, range.start);
    const last = at(entries, Math.max(range.start, range.end - 1));
    return {
      start: first && first.end >= range.start ? first.start : range.start,
      end: last && last.end >= range.end ? last.end : range.end,
    };
  };
}

/** Position tracking is advisory display state, never a new analysis result.
 * Multi-region replacements conservatively invalidate the intervening region. */
export function trackDiagnostics(
  before: string,
  after: string,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  if (before === after) return diagnostics;
  if (Math.max(before.length, after.length) > 100_000 || !after) return [];
  const change = textChange(before, after);
  if (!change) return diagnostics;
  const oldContext = contextIndex(before);
  const newContext = contextIndex(after);
  const tracked: Diagnostic[] = [];
  for (const diagnostic of diagnostics.slice(0, 200)) {
    const scope = diagnostic.invalidationScope ?? "document";
    if (scope === "document" || !valid(diagnostic.range, before.length))
      continue;
    const range = mapRange(diagnostic.range, change);
    if (!range || !valid(range, after.length)) continue;
    const previous = oldContext(diagnostic.range, scope);
    const current = newContext(range, scope);
    if (
      before.slice(previous.start, previous.end) ===
      after.slice(current.start, current.end)
    )
      tracked.push({ ...diagnostic, range });
  }
  return tracked;
}
