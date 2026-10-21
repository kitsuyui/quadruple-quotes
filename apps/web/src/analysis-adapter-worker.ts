import type { AnalysisRequest } from "../../../packages/analysis/src/types";
import { runTrustedAdapters } from "./trusted-adapters";

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    kind: string;
    pluginId?: "markdownlint" | "textlint-ja" | "textlint-ai";
    request?: AnalysisRequest;
  }>,
) => {
  try {
    if (
      event.data.kind !== "adapter" ||
      !event.data.request ||
      !event.data.pluginId
    )
      throw new Error("Malformed adapter request.");
    self.postMessage({
      id: event.data.id,
      ok: true,
      adapters: await runTrustedAdapters(
        event.data.request,
        event.data.pluginId,
      ),
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
