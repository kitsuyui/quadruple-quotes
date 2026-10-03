import { expect, test } from "bun:test";
import {
  textChange,
  trackDiagnostics,
} from "../packages/analysis/src/diagnostic-tracking";
import type { Diagnostic } from "../packages/analysis/src/types";

function issue(
  text: string,
  token: string,
  invalidationScope: Diagnostic["invalidationScope"] = "word",
): Diagnostic {
  const start = text.indexOf(token);
  return {
    pluginId: "test",
    ruleId: "test.rule",
    message: token,
    severity: "warning",
    range: { start, end: start + token.length },
    invalidationScope,
  };
}

test("UTF-16 replacements keep whole surrogate pairs and preserve unchanged text", () => {
  expect(textChange("a📝b", "a😀b")).toEqual({
    start: 1,
    end: 3,
    insertedLength: 2,
  });
  expect(textChange("a😀b", "a🚀b")).toEqual({
    start: 1,
    end: 3,
    insertedLength: 2,
  });
  expect(textChange("same", "same")).toBeNull();
});

test("unaffected issues follow repeated insertions and deletions without mutating results", () => {
  const before = "teh and adress.";
  const diagnostics = [issue(before, "teh"), issue(before, "adress")];
  const prefixed = `📝 日本語\n\n${before}`;
  const first = trackDiagnostics(before, prefixed, diagnostics);
  expect(
    first.map((item) => prefixed.slice(item.range.start, item.range.end)),
  ).toEqual(["teh", "adress"]);
  const corrected = prefixed.replace("teh", "the");
  const second = trackDiagnostics(prefixed, corrected, first);
  expect(second.map((item) => item.message)).toEqual(["adress"]);
  const shortened = corrected.replace("📝 日本語\n\n", "");
  expect(trackDiagnostics(corrected, shortened, second)[0].range.start).toBe(
    shortened.indexOf("adress"),
  );
  expect(diagnostics[0].range).toEqual({ start: 0, end: 3 });
  expect(trackDiagnostics(before, before, diagnostics)).toBe(diagnostics);
});

test("word boundaries invalidate appended letters and combining marks but allow spaces", () => {
  const before = "teh word.";
  const diagnostics = [issue(before, "teh")];
  expect(trackDiagnostics(before, "tehx word.", diagnostics)).toEqual([]);
  expect(trackDiagnostics(before, "xteh word.", diagnostics)).toEqual([]);
  expect(trackDiagnostics(before, "teh\u0301 word.", diagnostics)).toEqual([]);
  expect(trackDiagnostics(before, " teh word.", diagnostics)[0].range).toEqual({
    start: 1,
    end: 4,
  });
  expect(trackDiagnostics(before, "teh  word.", diagnostics)[0].range).toEqual({
    start: 0,
    end: 3,
  });
});

test("sentence and paragraph context invalidate nearby edits and retain distant issues", () => {
  const before = "Bad style here. Next sentence.\n\nAnother paragraph.";
  const sentence = issue(before, "style", "sentence");
  expect(
    trackDiagnostics(before, before.replace("Bad", "Poor"), [sentence]),
  ).toEqual([]);
  expect(
    trackDiagnostics(before, before.replace("Next", "Last"), [sentence]),
  ).toHaveLength(1);
  const paragraph = issue(before, "style", "paragraph");
  expect(
    trackDiagnostics(before, before.replace("Next", "Last"), [paragraph]),
  ).toEqual([]);
  expect(
    trackDiagnostics(before, before.replace("Another", "Final"), [paragraph]),
  ).toHaveLength(1);
  expect(
    trackDiagnostics(before, before.replace("\n\n", " "), [paragraph]),
  ).toEqual([]);
});

test("document-scoped and unknown plugins clear on any edit", () => {
  const before = "teh word.";
  const unknown = issue(before, "teh");
  delete unknown.invalidationScope;
  expect(
    trackDiagnostics(before, `${before} More.`, [
      unknown,
      issue(before, "teh", "document"),
    ]),
  ).toEqual([]);
});

test("point diagnostics move with preceding text and invalidate edits at their anchor", () => {
  const before = "abc";
  const point = { ...issue(before, "", "range"), range: { start: 3, end: 3 } };
  expect(trackDiagnostics(before, "xabc", [point])[0].range).toEqual({
    start: 4,
    end: 4,
  });
  expect(trackDiagnostics(before, "abcx", [point])).toEqual([]);
  expect(trackDiagnostics(before, "ab", [point])).toEqual([]);
});

test("invalid ranges, multi-region replacements, and over-limit input stay conservative", () => {
  const before = "teh other adress";
  const diagnostics = [issue(before, "teh"), issue(before, "adress")];
  expect(trackDiagnostics(before, "the other address", diagnostics)).toEqual(
    [],
  );
  expect(
    trackDiagnostics(before, ` ${before}`, [
      { ...diagnostics[0], range: { start: -1, end: 2 } },
    ]),
  ).toEqual([]);
  expect(trackDiagnostics(before, "a".repeat(100_001), diagnostics)).toEqual(
    [],
  );
  expect(trackDiagnostics(before, "", diagnostics)).toEqual([]);
});
