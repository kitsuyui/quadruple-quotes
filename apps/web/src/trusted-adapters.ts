import type {
  TextlintPluginCreator,
  TextlintRuleModule,
} from "@textlint/types";
import "./browser-require";
import type {
  AnalysisRequest,
  Diagnostic,
  PluginDescriptor,
  PluginStatus,
} from "../../../packages/analysis/src/types";

const MARKDOWN_RULES: PluginDescriptor["rules"] = [
  ["MD001", "Heading levels", "Headings increase by one level at a time."],
  ["MD009", "Trailing spaces", "Lines do not end with extra spaces."],
  ["MD012", "Blank lines", "Avoid multiple consecutive blank lines."],
  ["MD022", "Heading spacing", "Headings are surrounded by blank lines."],
  ["MD025", "Single title", "Use one top-level heading."],
  [
    "MD031",
    "Fenced code spacing",
    "Fenced code blocks have blank lines around them.",
  ],
  ["MD032", "List spacing", "Lists have blank lines around them."],
  ["MD040", "Code fence language", "Fenced code blocks name a language."],
  ["MD041", "First-line heading", "The first line is a top-level heading."],
  ["MD047", "Final newline", "Files end with one newline."],
].map(([rule, name, description]) => ({
  id: `markdownlint.${rule}`,
  name,
  description,
  defaultEnabled: true,
}));

export const TRUSTED_ADAPTER_CATALOG: PluginDescriptor[] = [
  {
    id: "ginza",
    name: "Japanese dependencies",
    description: "Optional local GiNZA dependency inspection.",
    defaultEnabled: false,
    runPolicy: "manual",
    rules: [],
  },
  {
    id: "markdownlint",
    name: "Markdown",
    description: "Bundled markdownlint checks for Markdown documents.",
    defaultEnabled: true,
    runPolicy: "realtime",
    rules: MARKDOWN_RULES,
  },
  {
    id: "textlint-ja",
    name: "Japanese writing",
    description: "Bundled low-cost textlint rules.",
    defaultEnabled: false,
    runPolicy: "realtime",
    rules: [
      {
        id: "textlint-ja.invalid-control",
        name: "Invalid control characters",
        description: "Control-character checks.",
        defaultEnabled: true,
      },
      {
        id: "textlint-ja.no-nfd",
        name: "Normalized Japanese characters",
        description: "Flags decomposed Japanese characters.",
        defaultEnabled: true,
      },
      {
        id: "textlint-ja.mixed-period",
        name: "Sentence endings",
        description: "Hints for mixed or missing Japanese sentence periods.",
        defaultEnabled: false,
      },
      {
        id: "textlint-ja.sentence-length",
        name: "Sentence length",
        description: "Flags sentences longer than 100 characters.",
        defaultEnabled: false,
      },
    ],
  },
  {
    id: "textlint-ai",
    name: "AI style hints",
    description: "Optional style hints, not an AI authorship judgement.",
    defaultEnabled: false,
    runPolicy: "realtime",
    rules: [
      {
        id: "textlint-ai.hype",
        name: "Hype expressions",
        description: "Flags potentially overstated Japanese expressions.",
        defaultEnabled: true,
      },
    ],
  },
];

function enabled(request: AnalysisRequest, plugin: PluginDescriptor) {
  return request.settings.plugins[plugin.id] ?? plugin.defaultEnabled;
}
function trustedPlugin(id: string): PluginDescriptor {
  const plugin = TRUSTED_ADAPTER_CATALOG.find(
    (candidate) => candidate.id === id,
  );
  if (!plugin) throw new Error(`Missing trusted adapter: ${id}`);
  return plugin;
}
function offsetAtLine(text: string, line: number) {
  let offset = 0;
  for (let index = 1; index < line; index += 1) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}

export async function runTrustedAdapters(
  request: AnalysisRequest,
): Promise<{ diagnostics: Diagnostic[]; statuses: PluginStatus[] }> {
  const diagnostics: Diagnostic[] = [];
  const statuses: PluginStatus[] = [];
  const markdown = trustedPlugin("markdownlint");
  if (!enabled(request, markdown))
    statuses.push({ pluginId: markdown.id, status: "disabled" });
  else if (request.format !== "markdown")
    statuses.push({
      pluginId: markdown.id,
      status: "skipped",
      message: "Markdown texts only.",
    });
  else
    try {
      const module = await import("markdownlint/promise");
      const config = Object.fromEntries(
        markdown.rules.map((rule) => [
          rule.id.replace("markdownlint.", ""),
          request.settings.rules[rule.id] ?? rule.defaultEnabled,
        ]),
      );
      const result = await module.lint({
        config: { default: false, ...config },
        strings: { document: request.text },
      });
      for (const issue of result.document ?? []) {
        const start =
          offsetAtLine(request.text, issue.lineNumber) +
          Math.max(0, (issue.errorRange?.[0] ?? 1) - 1);
        diagnostics.push({
          pluginId: markdown.id,
          ruleId: `markdownlint.${issue.ruleNames[0]}`,
          message: issue.ruleDescription,
          severity: "warning",
          invalidationScope: "document",
          range: {
            start,
            end: start + Math.max(1, issue.errorRange?.[1] ?? 1),
          },
        });
      }
      statuses.push({ pluginId: markdown.id, status: "ok" });
    } catch (error) {
      statuses.push({
        pluginId: markdown.id,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  const textlint = trustedPlugin("textlint-ja");
  const ai = trustedPlugin("textlint-ai");
  const textlintEnabled = enabled(request, textlint);
  const aiEnabled =
    enabled(request, ai) &&
    request.settings.rules["textlint-ai.hype"] !== false;
  if (!textlintEnabled)
    statuses.push({ pluginId: textlint.id, status: "disabled" });
  if (!aiEnabled) statuses.push({ pluginId: ai.id, status: "disabled" });
  if (textlintEnabled || aiEnabled)
    try {
      const [{ TextlintKernel }, { moduleInterop }, pluginModule] =
        await Promise.all([
          import("@textlint/kernel"),
          import("@textlint/module-interop"),
          request.format === "markdown"
            ? import("@textlint/textlint-plugin-markdown")
            : import("@textlint/textlint-plugin-text"),
        ]);
      // Babel's CommonJS output can acquire an extra `default` when Vite loads it
      // through native ESM. Textlint requires the actual module, not its wrapper.
      const unwrap = (module: unknown) => {
        let value: unknown = moduleInterop(module);
        while (
          typeof value === "object" &&
          value !== null &&
          "default" in value &&
          Object.keys(value).length === 1
        )
          value = (value as { default: unknown }).default;
        return value;
      };
      const rule = (module: unknown) => unwrap(module) as TextlintRuleModule;
      const [
        controlModule,
        nfdModule,
        mixedPeriodModule,
        sentenceLengthModule,
        hypeModule,
      ] = await Promise.all([
        textlintEnabled &&
        request.settings.rules["textlint-ja.invalid-control"] !== false
          ? import("@textlint-rule/textlint-rule-no-invalid-control-character")
          : Promise.resolve(undefined),
        textlintEnabled &&
        request.settings.rules["textlint-ja.no-nfd"] !== false
          ? import("textlint-rule-no-nfd")
          : Promise.resolve(undefined),
        textlintEnabled &&
        request.settings.rules["textlint-ja.mixed-period"] === true
          ? import("textlint-rule-ja-no-mixed-period")
          : Promise.resolve(undefined),
        textlintEnabled &&
        request.settings.rules["textlint-ja.sentence-length"] === true
          ? import("textlint-rule-sentence-length")
          : Promise.resolve(undefined),
        aiEnabled
          ? import(
              "@textlint-ja/textlint-rule-preset-ai-writing/lib/rules/no-ai-hype-expressions.js"
            )
          : Promise.resolve(undefined),
      ]);
      const result = await new TextlintKernel().lintText(request.text, {
        ext: request.format === "markdown" ? ".md" : ".txt",
        plugins: [
          {
            pluginId: "text",
            plugin: unwrap(pluginModule) as TextlintPluginCreator,
          },
        ],
        rules: [
          ...(!controlModule
            ? []
            : [{ ruleId: "invalid-control", rule: rule(controlModule) }]),
          ...(!nfdModule ? [] : [{ ruleId: "no-nfd", rule: rule(nfdModule) }]),
          ...(!mixedPeriodModule
            ? []
            : [{ ruleId: "mixed-period", rule: rule(mixedPeriodModule) }]),
          ...(!sentenceLengthModule
            ? []
            : [
                {
                  ruleId: "sentence-length",
                  rule: rule(sentenceLengthModule),
                  options: { max: 100 },
                },
              ]),
          ...(!hypeModule ? [] : [{ ruleId: "hype", rule: rule(hypeModule) }]),
        ],
      });
      for (const issue of result.messages)
        diagnostics.push({
          pluginId: issue.ruleId === "hype" ? ai.id : textlint.id,
          ruleId:
            issue.ruleId === "hype"
              ? `textlint-ai.${issue.ruleId}`
              : `textlint-ja.${issue.ruleId}`,
          message: issue.message,
          severity:
            issue.ruleId === "hype"
              ? "info"
              : issue.ruleId === "mixed-period" ||
                  issue.ruleId === "sentence-length"
                ? "warning"
                : issue.severity === 2
                  ? "error"
                  : "warning",
          range: { start: issue.range[0], end: issue.range[1] },
          // Markdown parser context and mixed-period checks can affect distant text.
          invalidationScope:
            request.format === "markdown" || issue.ruleId === "mixed-period"
              ? "document"
              : issue.ruleId === "invalid-control"
                ? "range"
                : issue.ruleId === "no-nfd"
                  ? "paragraph"
                  : "sentence",
        });
      if (textlintEnabled)
        statuses.push({ pluginId: textlint.id, status: "ok" });
      if (aiEnabled) statuses.push({ pluginId: ai.id, status: "ok" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (textlintEnabled)
        statuses.push({ pluginId: textlint.id, status: "error", message });
      if (aiEnabled)
        statuses.push({ pluginId: ai.id, status: "error", message });
    }
  return { diagnostics, statuses };
}
