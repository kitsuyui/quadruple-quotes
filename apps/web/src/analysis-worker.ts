import type {
  AnalysisRequest,
  AnalysisResult,
  Diagnostic,
  PluginStatus,
} from "../../../packages/analysis/src/types";

type AnalysisWasm = {
  analyze_text(request: string): string;
  analysis_catalog(): string;
  resolve_analysis_settings(request: string): string;
  apply_diagnostic_settings(request: string): string;
};
type CorePayload = {
  result: AnalysisResult;
  effectiveSettings: AnalysisRequest["settings"];
};
let ready: Promise<AnalysisWasm> | null = null;
const japaneseRuleIds = new Set([
  "no-mix-dearu-desumasu",
  "no-doubled-joshi",
  "no-redundant-expression",
  "no-abusage",
]);

function isUtf16Boundary(text: string, offset: number) {
  return !(
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}

async function load() {
  const module = await import("./generated-analysis/quadruple_quotes_analysis");
  const wasmUrl = new URL(
    "./generated-analysis/quadruple_quotes_analysis_bg.wasm",
    import.meta.url,
  );
  ready ??= module
    .default({ module_or_path: wasmUrl })
    .then(() => module as unknown as AnalysisWasm);
  return ready;
}

async function dependencies(request: AnalysisRequest) {
  if (request.settings.plugins.ginza !== true)
    return {
      documentId: request.documentId,
      revision: request.revision,
      dependencies: [],
      status: { pluginId: "ginza", status: "disabled" as const },
    };
  if (request.text.length > 5000)
    return {
      documentId: request.documentId,
      revision: request.revision,
      dependencies: [],
      status: {
        pluginId: "ginza",
        status: "skipped" as const,
        message: "Dependency analysis is limited to 5,000 UTF-16 units.",
      },
    };
  const controller = new AbortController();
  const timer = self.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/dependencies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: request.text }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Local parser returned ${response.status}. Start the GiNZA analysis host.`,
      );
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { ok?: unknown }).ok !== true ||
      !Array.isArray((payload as { dependencies?: unknown }).dependencies)
    )
      throw new Error("Local parser did not confirm a successful analysis.");
    return {
      documentId: request.documentId,
      revision: request.revision,
      dependencies: (payload as { dependencies: [] }).dependencies,
      status: { pluginId: "ginza", status: "ok" as const },
    };
  } catch (error) {
    return {
      documentId: request.documentId,
      revision: request.revision,
      dependencies: [],
      status: {
        pluginId: "ginza",
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    self.clearTimeout(timer);
    controller.abort();
  }
}
async function japaneseStyle(request: AnalysisRequest) {
  const pluginId = "textlint-ja-morphology";
  const rules = Object.entries(request.settings.rules)
    .filter(
      ([id, enabled]) =>
        enabled &&
        id.startsWith("textlint-ja.") &&
        [
          "textlint-ja.no-mix-dearu-desumasu",
          "textlint-ja.no-doubled-joshi",
          "textlint-ja.no-redundant-expression",
          "textlint-ja.no-abusage",
        ].includes(id),
    )
    .map(([id]) => id.replace("textlint-ja.", ""));
  if (request.settings.plugins[pluginId] !== true)
    return {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics: [],
      status: { pluginId, status: "disabled" as const },
    };
  if (request.text.length > 5000)
    return {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics: [],
      status: {
        pluginId,
        status: "skipped" as const,
        message:
          "Japanese morphology analysis is limited to 5,000 UTF-16 units.",
      },
    };
  if (!rules.length)
    return {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics: [],
      status: {
        pluginId,
        status: "disabled" as const,
        message: "Enable at least one Japanese morphology rule.",
      },
    };
  const controller = new AbortController();
  const timer = self.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/japanese-style", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        rules,
        format: request.format,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Local Japanese style helper returned ${response.status}.`,
      );
    const payload = (await response.json()) as {
      ok?: unknown;
      diagnostics?: unknown;
    };
    if (payload.ok !== true || !Array.isArray(payload.diagnostics))
      throw new Error(
        "Local Japanese style helper returned an invalid response.",
      );
    const diagnostics = payload.diagnostics
      .slice(0, 200)
      .flatMap((item): Diagnostic[] => {
        if (typeof item !== "object" || item === null) return [];
        const value = item as {
          ruleId?: unknown;
          message?: unknown;
          range?: { start?: unknown; end?: unknown };
        };
        const range = value.range;
        if (
          typeof value.ruleId !== "string" ||
          !japaneseRuleIds.has(value.ruleId) ||
          typeof value.message !== "string" ||
          !range ||
          typeof range.start !== "number" ||
          typeof range.end !== "number" ||
          !Number.isInteger(range.start) ||
          !Number.isInteger(range.end) ||
          range.start < 0 ||
          range.end < range.start ||
          range.end > request.text.length ||
          !isUtf16Boundary(request.text, range.start) ||
          !isUtf16Boundary(request.text, range.end)
        )
          return [];
        return [
          {
            pluginId,
            ruleId: `textlint-ja.${value.ruleId}`,
            message: value.message,
            severity: "warning",
            range: { start: range.start, end: range.end },
            invalidationScope: "document",
          },
        ];
      });
    return {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics,
      status: { pluginId, status: "ok" as const },
    };
  } catch (error) {
    return {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics: [],
      status: {
        pluginId,
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    self.clearTimeout(timer);
    controller.abort();
  }
}

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    kind: string;
    request?: AnalysisRequest;
    pluginId?: "markdownlint" | "textlint-ja" | "textlint-ai";
    core?: CorePayload;
    adapters?: { diagnostics: Diagnostic[]; statuses: PluginStatus[] };
  }>,
) => {
  const { id, kind } = event.data;
  try {
    // This branch is ahead of `load`: manual GiNZA workers never instantiate WASM.
    if (kind === "dependencies") {
      if (!event.data.request) throw new Error("Malformed dependency request.");
      self.postMessage({
        id,
        ok: true,
        dependencies: await dependencies(event.data.request),
      });
      return;
    }
    if (kind === "japanese-style") {
      if (!event.data.request)
        throw new Error("Malformed Japanese style request.");
      self.postMessage({
        id,
        ok: true,
        japaneseStyle: await japaneseStyle(event.data.request),
      });
      return;
    }
    const engine = await load();
    if (kind === "catalog") {
      self.postMessage({
        id,
        ok: true,
        catalog: JSON.parse(engine.analysis_catalog()),
      });
      return;
    }
    if (kind === "core") {
      if (!event.data.request) throw new Error("Malformed core request.");
      const original = event.data.request;
      const effectiveSettings = JSON.parse(
        engine.resolve_analysis_settings(
          JSON.stringify({
            documentId: original.documentId,
            settings: original.settings,
          }),
        ),
      );
      const result = JSON.parse(
        engine.analyze_text(
          JSON.stringify({ ...original, settings: effectiveSettings }),
        ),
      ) as AnalysisResult;
      self.postMessage({
        id,
        ok: true,
        core: { result, effectiveSettings } satisfies CorePayload,
      });
      return;
    }
    if (kind === "policy") {
      if (!event.data.core || !event.data.adapters)
        throw new Error("Malformed policy request.");
      const core = event.data.core;
      const adapters = event.data.adapters;
      const filtered = JSON.parse(
        engine.apply_diagnostic_settings(
          JSON.stringify({
            documentId: core.result.documentId,
            settings: core.effectiveSettings,
            diagnostics: adapters.diagnostics,
          }),
        ),
      ) as Diagnostic[];
      const diagnostics = [...core.result.diagnostics, ...filtered];
      self.postMessage({
        id,
        ok: true,
        result: {
          ...core.result,
          diagnostics: diagnostics.slice(0, 200),
          truncated: core.result.truncated || diagnostics.length > 200,
          statuses: [...core.result.statuses, ...adapters.statuses],
        },
      });
      return;
    }
    throw new Error("Unknown analysis worker request.");
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
