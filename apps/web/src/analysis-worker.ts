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
