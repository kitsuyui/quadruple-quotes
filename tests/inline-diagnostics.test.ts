import { expect, test } from "bun:test";
import { diagnosticSegments } from "../apps/web/src/inline-diagnostics";
import type { Diagnostic, Severity } from "../packages/analysis/src/types";

function issue(
  start: number,
  end: number,
  severity: Severity = "warning",
): Diagnostic {
  return {
    pluginId: "test",
    ruleId: "test.range",
    message: "Review",
    severity,
    range: { start, end },
  };
}

test("overlapping diagnostics render the strongest severity without repeating or losing text", () => {
  const text = "abcdef";
  const segments = diagnosticSegments(text, [
    issue(1, 4, "info"),
    issue(2, 5, "error"),
  ]);
  expect(segments).toEqual([
    { start: 0, end: 1, severity: undefined },
    { start: 1, end: 2, severity: "info", diagnosticIndices: [0] },
    { start: 2, end: 4, severity: "error", diagnosticIndices: [0, 1] },
    { start: 4, end: 5, severity: "error", diagnosticIndices: [1] },
    { start: 5, end: 6, severity: undefined },
  ]);
  expect(
    segments.map((range) => text.slice(range.start, range.end)).join(""),
  ).toBe(text);
});

test("ranges inside combining characters and ZWJ emoji expand only the display to whole graphemes", () => {
  const text = "か\u3099 👨‍👩‍👧‍👦 end";
  const diagnostics = [issue(1, 2), issue(4, 5, "info")];
  const segments = diagnosticSegments(text, diagnostics);
  expect(
    segments
      .filter((segment) => segment.severity)
      .map((segment) => text.slice(segment.start, segment.end)),
  ).toEqual(["か\u3099", "👨‍👩‍👧‍👦"]);
  expect(diagnostics[1].range).toEqual({ start: 4, end: 5 });
});

test("adjacent ranges keep their own messages even when their severity matches", () => {
  const diagnostics = [issue(0, 1), issue(1, 2)];
  const marked = diagnosticSegments("ab", diagnostics);
  expect(
    marked.map((segment) =>
      segment.diagnosticIndices?.map((index) => diagnostics[index].range),
    ),
  ).toEqual([[{ start: 0, end: 1 }], [{ start: 1, end: 2 }]]);
});

test("invisible and end-of-document insertion diagnostics get a visible anchor", () => {
  expect(
    diagnosticSegments("A\u200bB", [issue(1, 2)]).filter(
      (segment) => segment.severity,
    ),
  ).toEqual([
    { start: 1, end: 3, severity: "warning", diagnosticIndices: [0] },
  ]);
  expect(
    diagnosticSegments("word", [issue(4, 4)]).filter(
      (segment) => segment.severity,
    ),
  ).toEqual([
    { start: 3, end: 4, severity: "warning", diagnosticIndices: [0] },
  ]);
});

test("invalid ranges are ignored and display work is bounded for over-limit input", () => {
  expect(
    diagnosticSegments("keep", [
      issue(-1, 1),
      issue(3, 2),
      issue(0, 9),
      issue(1.5, 2),
    ]),
  ).toEqual([{ start: 0, end: 4, severity: undefined }]);
  expect(diagnosticSegments("a".repeat(100_001), [issue(0, 1)])).toEqual([
    { start: 0, end: 100_001 },
  ]);
  expect(diagnosticSegments("", [issue(0, 0)])).toEqual([{ start: 0, end: 0 }]);
});
