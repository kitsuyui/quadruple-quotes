import type {
  AnalysisRequest,
  AnalysisResult,
} from "../../../packages/analysis/src/types";
import { BrowserAnalysisPort } from "./analysis-port";

type Case = {
  name: string;
  request: AnalysisRequest;
  dependencies?: boolean;
};

const curated = {
  plugins: { markdownlint: true, "textlint-ja": true, "textlint-ai": true },
  rules: {},
};
const cases: Case[] = [
  {
    name: "short-plain-default",
    request: {
      documentId: "benchmark",
      revision: 1,
      text: "This is teh short plain-text benchmark.",
      format: "text",
      settings: { plugins: {}, rules: {} },
    },
  },
  {
    name: "short-markdown-curated-adapters",
    request: {
      documentId: "benchmark",
      revision: 1,
      text: "# Heading\n\nThis is teh benchmark.",
      format: "markdown",
      settings: curated,
    },
  },
  {
    name: "exactly-100000-utf16-default",
    request: {
      documentId: "benchmark",
      revision: 1,
      text: "a".repeat(100_000),
      format: "text",
      settings: { plugins: {}, rules: {} },
    },
  },
  {
    name: "many-diagnostics-shared-200-cap",
    request: {
      documentId: "benchmark",
      revision: 1,
      text: "teh ".repeat(1_000),
      format: "text",
      settings: { plugins: {}, rules: {} },
    },
  },
  {
    name: "over-100000-ginza-skip",
    request: {
      documentId: "benchmark",
      revision: 1,
      text: "a".repeat(100_001),
      format: "text",
      settings: { plugins: { ginza: true }, rules: {} },
    },
    dependencies: true,
  },
];

function quantile(samples: number[], percentile: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0;
}

function summary(
  result:
    | AnalysisResult
    | Awaited<ReturnType<BrowserAnalysisPort["analyzeDependencies"]>>,
) {
  if ("metrics" in result)
    return {
      diagnostics: result.diagnostics.length,
      truncated: result.truncated,
      statuses: result.statuses.map(
        (status) => `${status.pluginId}:${status.status}`,
      ),
    };
  return {
    dependencies: result.dependencies.length,
    status: `${result.status.pluginId}:${result.status.status}`,
  };
}

function createPort(workerCounts: Record<string, number>) {
  return new BrowserAnalysisPort((lane) => {
    workerCounts[lane] = (workerCounts[lane] ?? 0) + 1;
    if (
      lane === "markdownlint" ||
      lane === "textlint-ja" ||
      lane === "textlint-ai"
    )
      return new Worker(
        new URL("./analysis-adapter-worker.ts", import.meta.url),
        { type: "module" },
      );
    return new Worker(new URL("./analysis-worker.ts", import.meta.url), {
      type: "module",
    });
  });
}

async function measure(one: Case, samples: number, prime = false) {
  const workerCounts: Record<string, number> = {};
  const port = createPort(workerCounts);
  const run = () =>
    one.dependencies
      ? port.analyzeDependencies(one.request)
      : port.analyze(one.request);
  const elapsed: number[] = [];
  let outcome: ReturnType<typeof summary> | undefined;
  try {
    if (prime) outcome = summary(await run());
    for (let sample = 0; sample < samples; sample += 1) {
      const started = performance.now();
      const result = await run();
      elapsed.push(performance.now() - started);
      outcome = summary(result);
    }
  } finally {
    port.dispose();
  }
  return { elapsedMs: elapsed, workerCounts, outcome };
}

declare global {
  interface Window {
    runAnalysisBenchmark?: () => Promise<unknown>;
  }
}

window.runAnalysisBenchmark = async () => {
  const result = [];
  for (const one of cases) {
    const cold = await measure(one, 1);
    const warm = await measure(one, 11, true);
    result.push({
      name: one.name,
      utf16Units: one.request.text.length,
      utf8Bytes: new TextEncoder().encode(one.request.text).byteLength,
      format: one.request.format,
      settings: one.request.settings,
      operation: one.dependencies ? "dependencies" : "analyze",
      cold: {
        elapsedMs: cold.elapsedMs[0],
        workerCounts: cold.workerCounts,
        outcome: cold.outcome,
      },
      warm: {
        elapsedMs: warm.elapsedMs,
        medianMs: quantile(warm.elapsedMs, 0.5),
        p95Ms: quantile(warm.elapsedMs, 0.95),
        workerCounts: warm.workerCounts,
        outcome: warm.outcome,
      },
    });
  }
  return {
    browser: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    cases: result,
  };
};
