import { expect, test } from "bun:test";
import { runTrustedAdapters } from "../apps/web/src/trusted-adapters";
import type { AnalysisRequest } from "../packages/analysis/src/types";

const browserRequest = (text: string, enabled: boolean): AnalysisRequest => ({
  documentId: "japanese-browser",
  revision: 1,
  text,
  format: "text",
  settings: {
    plugins: { "textlint-ja": true },
    rules: { "textlint-ja.no-unmatched-pair": enabled },
  },
});

async function run(
  text: string,
  rules: string[],
  format: "text" | "markdown" = "text",
) {
  const child = Bun.spawn(
    ["bun", "apps/analysis-host/japanese-style-runner.ts"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  child.stdin.write(JSON.stringify({ text, rules, format }));
  child.stdin.end();
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  return JSON.parse(output) as {
    ok: boolean;
    diagnostics: { ruleId: string; range: { start: number; end: number } }[];
  };
}

test("real morphology rules are opt-in and return UTF-16 ranges", async () => {
  const text = "これはこれはテストです。これはである。";
  const result = await run(text, ["no-doubled-joshi", "no-mix-dearu-desumasu"]);
  expect(result.ok).toBe(true);
  expect(result.diagnostics.map((item) => item.ruleId)).toEqual([
    "no-doubled-joshi",
    "no-mix-dearu-desumasu",
  ]);
  const doubled = result.diagnostics[0];
  expect(doubled?.range).toEqual({ start: 5, end: 6 });
  expect(text.slice(doubled?.range.start, doubled?.range.end)).toBe("は");
  expect(await run(text, [])).toMatchObject({ ok: true, diagnostics: [] });
});

test("morphology offsets convert astral-prefix code points to UTF-16", async () => {
  const text = "😀これはこれはテストです。";
  const result = await run(text, ["no-doubled-joshi"]);
  expect(result.diagnostics[0]?.range).toEqual({ start: 7, end: 8 });
  expect(text.slice(7, 8)).toBe("は");
});

test("unmatched pairs stay off by default and use the lightweight browser adapter when enabled", async () => {
  const text = "😀これは（秘密)です。";
  const disabled = await runTrustedAdapters(
    browserRequest(text, false),
    "textlint-ja",
  );
  expect(disabled.diagnostics).toEqual([]);
  const enabled = await runTrustedAdapters(
    browserRequest(text, true),
    "textlint-ja",
  );
  expect(enabled.diagnostics).toHaveLength(1);
  expect(enabled.diagnostics[0]).toMatchObject({
    ruleId: "textlint-ja.no-unmatched-pair",
    range: { start: text.indexOf("（"), end: text.indexOf("（") + 1 },
  });
  const enabledIssue = enabled.diagnostics[0];
  if (!enabledIssue) throw new Error("Expected an unmatched-pair diagnostic.");
  expect(text.slice(enabledIssue.range.start, enabledIssue.range.end)).toBe(
    "（",
  );
  const plainText = "これは（秘密)です。";
  const plain = await runTrustedAdapters(
    browserRequest(plainText, true),
    "textlint-ja",
  );
  expect(plain.diagnostics[0]?.range).toEqual({
    start: plainText.indexOf("（"),
    end: plainText.indexOf("（") + 1,
  });
  const plainIssue = plain.diagnostics[0];
  if (!plainIssue) throw new Error("Expected an unmatched-pair diagnostic.");
  expect(plainText.slice(plainIssue.range.start, plainIssue.range.end)).toBe(
    "（",
  );
  expect(
    (
      await runTrustedAdapters(
        browserRequest("これは（秘密）です。", true),
        "textlint-ja",
      )
    ).diagnostics,
  ).toEqual([]);
  expect(
    (
      await runTrustedAdapters(
        browserRequest("😀これは（秘密）です。", true),
        "textlint-ja",
      )
    ).diagnostics,
  ).toEqual([]);
});

test("AI textlint ranges preserve zero-based half-open offsets", async () => {
  const text = "これは革命的な製品です。";
  const result = await runTrustedAdapters(
    {
      ...browserRequest(text, false),
      settings: {
        plugins: { "textlint-ja": false, "textlint-ai": true },
        rules: { "textlint-ai.hype": true },
      },
    },
    "textlint-ai",
  );
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.range).toEqual({ start: 3, end: 7 });
  expect(text.slice(3, 7)).toBe("革命的な");
});

test("real morphology runner uses the Markdown parser to exclude code and quotes", async () => {
  const clean = await run(
    "> これはこれは引用です。\n\n```js\nconst particle = 'これはこれは';\n```\n\n本文です。",
    [
      "no-doubled-joshi",
      "no-mix-dearu-desumasu",
      "no-redundant-expression",
      "no-abusage",
    ],
    "markdown",
  );
  expect(clean.ok).toBe(true);
  expect(clean.diagnostics).toEqual([]);
});

test("fixed-dictionary rules report real upstream positive cases and keep clean counterexamples", async () => {
  const redundant = await run("検討を行う。", ["no-redundant-expression"]);
  expect(redundant.diagnostics.map((item) => item.ruleId)).toEqual([
    "no-redundant-expression",
  ]);
  const abusage = await run("この条件を適応する。", ["no-abusage"]);
  expect(abusage.diagnostics.map((item) => item.ruleId)).toEqual([
    "no-abusage",
  ]);
  expect(
    (
      await run("検討する。この条件を適用する。", [
        "no-redundant-expression",
        "no-abusage",
      ])
    ).diagnostics,
  ).toEqual([]);
});

test("native morphology rule ranges stay on UTF-16 source boundaries", async () => {
  const body =
    "これはこれはテストです。検討を行う。この条件を適応する。これはである。";
  const cases = [
    { name: "plain astral prefix", format: "text" as const, text: `😀${body}` },
    {
      name: "Markdown heading before astral paragraph",
      format: "markdown" as const,
      text: `# 😀見出し\n\n😀${body}`,
    },
    {
      name: "Markdown previous paragraph",
      format: "markdown" as const,
      text: `😀前文です。\n\n${body}`,
    },
    {
      name: "multiple astral characters",
      format: "text" as const,
      text: `😀😀${body}`,
    },
    {
      name: "CRLF Markdown paragraphs",
      format: "markdown" as const,
      text: `😀前文です。\r\n\r\n${body}`,
    },
  ];
  const expected = {
    "no-doubled-joshi": ["は"],
    "no-redundant-expression": ["検討", "検"],
    "no-abusage": ["を"],
    "no-mix-dearu-desumasu": ["である", "で"],
  } as const;
  const rules = Object.keys(expected);

  for (const fixture of cases) {
    const result = await run(fixture.text, rules, fixture.format);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((item) => item.ruleId).sort()).toEqual(
      [...rules].sort(),
    );
    for (const issue of result.diagnostics) {
      const range = issue.range;
      expect(fixture.text.slice(range.start, range.end)).toSatisfy((slice) =>
        expected[issue.ruleId as keyof typeof expected].includes(
          slice as never,
        ),
      );
    }
  }
});

test("Markdown code and quotes are excluded without moving real native ranges", async () => {
  const text =
    "😀これはこれは引用です。\n\n> これはこれは引用です。\n\n```js\nconst x = 'これはこれは';\n```\n\n検討を行う。この条件を適応する。これはである。";
  const result = await run(
    text,
    [
      "no-doubled-joshi",
      "no-redundant-expression",
      "no-abusage",
      "no-mix-dearu-desumasu",
    ],
    "markdown",
  );
  const slices = Object.fromEntries(
    result.diagnostics.map((issue) => [
      issue.ruleId,
      text.slice(issue.range.start, issue.range.end),
    ]),
  );
  expect(slices).toEqual({
    "no-doubled-joshi": "は",
    "no-redundant-expression": "検",
    "no-abusage": "を",
    "no-mix-dearu-desumasu": "で",
  });
  const codeStart = text.indexOf("```js");
  const codeEnd = text.indexOf("\n```", codeStart) + 4;
  const quoteStart = text.indexOf("> これはこれは");
  const quoteEnd = text.indexOf("\n", quoteStart);
  for (const issue of result.diagnostics) {
    expect(issue.range.start).toBeGreaterThanOrEqual(0);
    expect(
      issue.range.start >= quoteStart && issue.range.start < quoteEnd,
    ).toBe(false);
    expect(issue.range.start >= codeStart && issue.range.start < codeEnd).toBe(
      false,
    );
  }
});

test("no-abusage keeps upstream node provenance for repeated and excluded text", async () => {
  const cases = [
    {
      name: "valid preceding use does not capture the invalid use",
      format: "text" as const,
      text: "環境に適応する。この条件を適応する。",
      ranges: [{ start: 12, end: 13 }],
    },
    {
      name: "link and inline code keep their own source locations",
      format: "markdown" as const,
      text: "[この条件を適応する。](https://example.test/) と `この条件を適応する。` の後、この条件を適応する。",
      ranges: [
        { start: 5, end: 6 },
        { start: 58, end: 59 },
      ],
    },
    {
      name: "quote and fenced code do not absorb the final paragraph",
      format: "markdown" as const,
      text: "> この条件を適応する。\n\n```txt\nこの条件を適応する。\n```\n\nこの条件を適応する。",
      ranges: [{ start: 41, end: 42 }],
    },
    {
      name: "astral prefix remains a UTF-16 boundary",
      format: "text" as const,
      text: "😀この条件を適応する。",
      ranges: [{ start: 6, end: 7 }],
    },
  ];

  for (const fixture of cases) {
    const result = await run(fixture.text, ["no-abusage"], fixture.format);
    expect(result.diagnostics).toHaveLength(fixture.ranges.length);
    expect(result.diagnostics.map((issue) => issue.range)).toEqual(
      fixture.ranges,
    );
    expect(
      result.diagnostics.map((issue) =>
        fixture.text.slice(issue.range.start, issue.range.end),
      ),
    ).toEqual(fixture.ranges.map(() => "を"));
  }
});
