import { createRequire } from "node:module";
import { TextlintKernel } from "@textlint/kernel";
import markdownPlugin from "@textlint/textlint-plugin-markdown";
import textPlugin from "@textlint/textlint-plugin-text";

const allowed = new Set([
  "no-mix-dearu-desumasu",
  "no-doubled-joshi",
  "no-redundant-expression",
  "no-abusage",
]);
const modules = {
  "no-mix-dearu-desumasu": () => import("textlint-rule-no-mix-dearu-desumasu"),
  "no-doubled-joshi": () => import("textlint-rule-no-doubled-joshi"),
  "no-redundant-expression": () =>
    import("textlint-rule-ja-no-redundant-expression"),
  "no-abusage": () => import("textlint-rule-ja-no-abusage"),
};
type KuromojiToken = { surface_form: string; word_position: number };
type KuromojinModule = {
  tokenize: (
    text: string,
    options?: unknown,
  ) => Promise<Readonly<Readonly<KuromojiToken>[]>>;
};

const require = createRequire(import.meta.url);
const kuromojin = require("kuromojin") as KuromojinModule;
const tokenize = kuromojin.tokenize;

function scalarToUtf16Table(text: string) {
  const offsets = [0];
  let utf16 = 0;
  for (const scalar of text) {
    utf16 += scalar.length;
    offsets.push(utf16);
  }
  return offsets;
}

function normalizeTokenPositions(
  text: string,
  tokens: readonly KuromojiToken[],
) {
  const offsets = scalarToUtf16Table(text);
  return tokens.map((token) => {
    const scalarStart = token.word_position - 1;
    const utf16Start = offsets[scalarStart];
    if (!Number.isInteger(token.word_position) || utf16Start === undefined)
      throw new Error("kuromoji returned an invalid scalar word_position");
    return { ...token, word_position: utf16Start + 1 };
  });
}

function markdownExcludedRanges(text: string) {
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  let fenced = false;
  for (const line of text.split(/(?<=\n)/)) {
    const end = offset + line.length;
    if (/^ {0,3}```/.test(line)) fenced = !fenced;
    if (fenced || /^ {0,3}>/.test(line)) ranges.push({ start: offset, end });
    let codeStart = line.indexOf("`");
    while (codeStart !== -1) {
      const codeEnd = line.indexOf("`", codeStart + 1);
      if (codeEnd === -1) break;
      ranges.push({ start: offset + codeStart, end: offset + codeEnd + 1 });
      codeStart = line.indexOf("`", codeEnd + 1);
    }
    offset = end;
  }
  return ranges;
}

// kuromoji reports word_position in Unicode scalar values while textlint's
// StringSource maps generated text using UTF-16 offsets. Normalize cloned
// tokens at that boundary, before any rule maps a token back to its AST source.
// The kuromojin cache stays unmodified for callers outside this isolated runner.
// Bun exposes CommonJS named exports as readonly, so replace this runner's
// CommonJS cache entry before the rules load it.
const normalizedKuromojin: KuromojinModule = {
  ...kuromojin,
  tokenize: async (text, options) =>
    normalizeTokenPositions(text, await tokenize(text, options)),
};
const kuromojinPath = require.resolve("kuromojin");
const kuromojinCacheEntry = require.cache[kuromojinPath];
if (!kuromojinCacheEntry) throw new Error("kuromojin was not loaded");
kuromojinCacheEntry.exports = normalizedKuromojin;
const chunks: Buffer[] = [];
function unwrap(module: unknown) {
  let value = module;
  while (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    (value as { default: unknown }).default !== value
  )
    value = (value as { default: unknown }).default;
  return value;
}
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const input = JSON.parse(Buffer.concat(chunks).toString()) as {
    text?: unknown;
    rules?: unknown;
    format?: unknown;
  };
  if (
    typeof input.text !== "string" ||
    (input.format !== "text" && input.format !== "markdown") ||
    !Array.isArray(input.rules) ||
    input.rules.some((rule) => typeof rule !== "string" || !allowed.has(rule))
  )
    throw new Error("invalid request");
  const rules = [];
  for (const id of input.rules) {
    rules.push({
      ruleId: id,
      rule: unwrap(await modules[id as keyof typeof modules]()),
    });
  }
  const result = await new TextlintKernel().lintText(input.text, {
    ext: input.format === "markdown" ? ".md" : ".txt",
    plugins: [
      {
        pluginId: input.format === "markdown" ? "markdown" : "text",
        plugin: input.format === "markdown" ? markdownPlugin : textPlugin,
      },
    ],
    rules,
  });
  const excludedRanges =
    input.format === "markdown" ? markdownExcludedRanges(input.text) : [];
  process.stdout.write(
    JSON.stringify({
      ok: true,
      diagnostics: result.messages
        .filter(
          (item) =>
            !excludedRanges.some(
              (range) =>
                range.start <= item.range[0] && item.range[1] <= range.end,
            ),
        )
        .slice(0, 200)
        .map((item) => {
          return {
            ruleId: item.ruleId,
            message: item.message,
            // Ranges are zero-based, half-open UTF-16 offsets once the
            // kuromoji token boundary above has been normalized. Keep each
            // upstream node's own source provenance; do not search the whole
            // document for a matching term.
            range: { start: item.range[0], end: item.range[1] },
          };
        }),
    }),
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
