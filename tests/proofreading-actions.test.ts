import { expect, test } from "bun:test";
import { BodyHistory } from "../apps/web/src/body-history";
import {
  adjacentDiagnostic,
  diagnosticKey,
} from "../packages/analysis/src/diagnostic-navigation";
import { applyDiagnosticFix } from "../packages/analysis/src/fixes";
import type { Diagnostic, DiagnosticFix } from "../packages/analysis/src/types";

const revision = { documentId: "one", revision: 7 };
const fix: DiagnosticFix = {
  label: "Replace with the",
  edits: [{ range: { start: 3, end: 6 }, expectedText: "teh", newText: "the" }],
};

test("fixes preserve emoji and combining marks and require the exact analyzed revision", () => {
  const current = { ...revision, text: "📝 teh か\u3099" };
  expect(applyDiagnosticFix(current, revision, fix)).toEqual({
    text: "📝 the か\u3099",
    selection: { start: 3, end: 6 },
  });
  expect(
    applyDiagnosticFix(current, { ...revision, revision: 6 }, fix),
  ).toBeNull();
  expect(
    applyDiagnosticFix(current, { ...revision, documentId: "other" }, fix),
  ).toBeNull();
  expect(
    applyDiagnosticFix({ ...current, text: "📝 teh?" }, revision, {
      ...fix,
      edits: [{ ...fix.edits[0], expectedText: "bad" }],
    }),
  ).toBeNull();
});

test("multi-edit fixes are atomic and reject overlapping, invalid, or split-surrogate ranges", () => {
  const current = { ...revision, text: "📝 teh adress" };
  const second = {
    range: { start: 7, end: 13 },
    expectedText: "adress",
    newText: "address",
  };
  expect(
    applyDiagnosticFix(current, revision, {
      label: "Both",
      edits: [second, ...fix.edits],
    })?.text,
  ).toBe("📝 the address");
  for (const range of [
    { start: 1, end: 2 },
    { start: -1, end: 2 },
    { start: 3.5, end: 6 },
    { start: 3, end: 99 },
    { start: 6, end: 3 },
  ])
    expect(
      applyDiagnosticFix(current, revision, {
        ...fix,
        edits: [
          {
            range,
            expectedText: current.text.slice(range.start, range.end),
            newText: "x",
          },
        ],
      }),
    ).toBeNull();
  expect(
    applyDiagnosticFix(current, revision, {
      ...fix,
      edits: [...fix.edits, ...fix.edits],
    }),
  ).toBeNull();
  expect(
    applyDiagnosticFix(current, revision, {
      ...fix,
      edits: [...fix.edits, { ...second, expectedText: "wrong" }],
    }),
  ).toBeNull();
  expect(current.text).toBe("📝 teh adress");
});

test("typing after a fix undoes first, while the fix remains one step with caret restoration", () => {
  const history = new BodyHistory();
  history.record(
    "teh",
    "the",
    { kind: "fix", before: { start: 0, end: 0 }, after: { start: 0, end: 3 } },
    0,
  );
  history.record(
    "the",
    "the!",
    {
      kind: "typing",
      before: { start: 3, end: 3 },
      after: { start: 4, end: 4 },
    },
    1,
  );
  history.record(
    "the!",
    "the!!",
    {
      kind: "typing",
      before: { start: 4, end: 4 },
      after: { start: 5, end: 5 },
    },
    2,
  );
  expect(history.undo("the!!")).toEqual({
    text: "the",
    selection: { start: 3, end: 3 },
  });
  expect(history.undo("the")).toEqual({
    text: "teh",
    selection: { start: 0, end: 0 },
  });
  expect(history.redo("teh")?.text).toBe("the");
  history.record(
    "the",
    "other",
    {
      kind: "paste",
      before: { start: 0, end: 3 },
      after: { start: 5, end: 5 },
    },
    3,
  );
  expect(history.canRedo).toBe(false);
});

test("IME is one history transaction and unrelated documents never inherit history", () => {
  const history = new BodyHistory();
  history.record("📝 teh", "📝 日本語 teh", {
    kind: "composition",
    before: { start: 3, end: 3 },
    after: { start: 7, end: 7 },
  });
  expect(history.undo("📝 日本語 teh")?.text).toBe("📝 teh");
  expect(history.redo("📝 teh")?.text).toBe("📝 日本語 teh");
  history.clear();
  expect(history.undo("other")).toBeNull();
  expect(history.canRedo).toBe(false);
});

test("navigation sorts source ranges, wraps, distinguishes overlaps, and respects moved selections", () => {
  const diagnostic = (start: number, ruleId: string): Diagnostic => ({
    pluginId: "test",
    ruleId,
    message: ruleId,
    severity: "warning",
    range: { start, end: start + 3 },
  });
  const first = diagnostic(0, "first");
  const overlap = diagnostic(0, "overlap");
  const last = diagnostic(10, "last");
  const issues = [last, first, overlap];
  expect(adjacentDiagnostic(issues, { start: 0, end: 0 }, 1, null)).toBe(first);
  expect(adjacentDiagnostic(issues, first.range, 1, diagnosticKey(first))).toBe(
    overlap,
  );
  expect(adjacentDiagnostic(issues, last.range, 1, diagnosticKey(last))).toBe(
    first,
  );
  expect(
    adjacentDiagnostic(issues, first.range, -1, diagnosticKey(first)),
  ).toBe(last);
  expect(
    adjacentDiagnostic(issues, { start: 6, end: 6 }, 1, diagnosticKey(first)),
  ).toBe(last);
  expect(adjacentDiagnostic([], first.range, 1, null)).toBeNull();
});
