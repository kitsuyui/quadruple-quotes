import type { AnalysisRequest } from "../../../packages/analysis/src/types";
import {
  runTrustedAdapters,
  TRUSTED_ADAPTER_CATALOG,
} from "./trusted-adapters";

type AnalysisWasm = {
  analyze_text(request: string): string;
  analysis_catalog(): string;
};

let ready: Promise<AnalysisWasm> | null = null;

function isDependency(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const dependency = value as Record<string, unknown>;
  if (
    typeof dependency.id !== "number" ||
    typeof dependency.text !== "string" ||
    typeof dependency.relation !== "string" ||
    typeof dependency.sentence !== "number" ||
    (dependency.head !== null && typeof dependency.head !== "number")
  )
    return false;
  if (typeof dependency.range !== "object" || dependency.range === null)
    return false;
  const range = dependency.range as Record<string, unknown>;
  return typeof range.start === "number" && typeof range.end === "number";
}

function dependencyPayload(value: unknown): { dependencies: unknown[] } {
  if (typeof value !== "object" || value === null)
    throw new Error("Local parser returned an invalid response.");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || !Array.isArray(payload.dependencies))
    throw new Error("Local parser did not confirm a successful analysis.");
  if (!payload.dependencies.every(isDependency))
    throw new Error("Local parser returned an invalid dependency schema.");
  return { dependencies: payload.dependencies };
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

self.onmessage = async (
  event: MessageEvent<AnalysisRequest | { kind: "catalog" }>,
) => {
  try {
    const engine = await load();
    if ("kind" in event.data && event.data.kind === "catalog") {
      if (typeof engine.analysis_catalog !== "function")
        throw new Error(
          "The proofreading catalog is unavailable. Rebuild the WASM adapter.",
        );
      self.postMessage({
        ok: true,
        catalog: JSON.parse(engine.analysis_catalog()),
      });
      return;
    }
    const request = event.data as AnalysisRequest;
    if (typeof engine.analyze_text !== "function")
      throw new Error(
        "The proofreading engine is unavailable. Rebuild the WASM adapter.",
      );
    const result = JSON.parse(engine.analyze_text(JSON.stringify(request)));
    const adapters =
      request.text.length > 100_000
        ? {
            diagnostics: [],
            statuses: TRUSTED_ADAPTER_CATALOG.filter(
              (plugin) => plugin.runPolicy === "realtime",
            ).map((plugin) => {
              const isEnabled =
                request.settings.plugins[plugin.id] ?? plugin.defaultEnabled;
              return isEnabled
                ? {
                    pluginId: plugin.id,
                    status: "skipped" as const,
                    message:
                      "Text is over the 100,000 UTF-16 unit analysis limit.",
                  }
                : { pluginId: plugin.id, status: "disabled" as const };
            }),
          }
        : await runTrustedAdapters(request);
    const diagnostics = [...result.diagnostics, ...adapters.diagnostics];
    result.diagnostics = diagnostics.slice(0, 200);
    result.truncated ||= diagnostics.length > 200;
    result.statuses = [...result.statuses, ...adapters.statuses];
    if (
      request.manual &&
      request.settings.plugins.ginza === true &&
      request.text.length > 5000
    ) {
      result.statuses.push({
        pluginId: "ginza",
        status: "skipped",
        message: "Dependency analysis is limited to 5,000 UTF-16 units.",
      });
    } else if (request.manual && request.settings.plugins.ginza === true) {
      try {
        const response = await fetch("/api/dependencies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: request.text }),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          const message =
            typeof failure === "object" &&
            failure !== null &&
            "error" in failure &&
            typeof failure.error === "string"
              ? failure.error
              : `Local parser returned ${response.status}. Start the GiNZA analysis host.`;
          throw new Error(message);
        }
        const payload = dependencyPayload(await response.json());
        result.dependencies = payload.dependencies;
        result.statuses.push({ pluginId: "ginza", status: "ok" });
      } catch (error) {
        result.statuses.push({
          pluginId: "ginza",
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
