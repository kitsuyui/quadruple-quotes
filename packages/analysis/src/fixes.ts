import type { DiagnosticFix, Range } from "./types";

type Revision = { documentId: string; revision: number };

function boundary(text: string, offset: number) {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  );
}

/** Hosts apply an entire fix atomically, never a suggestion string or old result. */
export function applyDiagnosticFix(
  current: Revision & { text: string },
  analyzed: Revision,
  fix: DiagnosticFix,
): { text: string; selection: Range } | null {
  if (
    current.documentId !== analyzed.documentId ||
    current.revision !== analyzed.revision ||
    !fix.edits.length ||
    fix.edits.length > 100
  )
    return null;
  const edits = [...fix.edits].sort(
    (a, b) => a.range.start - b.range.start || a.range.end - b.range.end,
  );
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    const { start, end } = edit.range;
    const previous = edits[index - 1];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > current.text.length ||
      !boundary(current.text, start) ||
      !boundary(current.text, end) ||
      typeof edit.expectedText !== "string" ||
      typeof edit.newText !== "string" ||
      current.text.slice(start, end) !== edit.expectedText ||
      (previous &&
        (previous.range.end > start || previous.range.start === start))
    )
      return null;
  }
  let text = current.text;
  for (const edit of [...edits].reverse())
    text =
      text.slice(0, edit.range.start) +
      edit.newText +
      text.slice(edit.range.end);
  if (text === current.text) return null;
  const first = edits[0];
  return {
    text,
    selection: {
      start: first.range.start,
      end: first.range.start + first.newText.length,
    },
  };
}
