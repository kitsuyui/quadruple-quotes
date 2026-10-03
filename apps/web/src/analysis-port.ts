import type {
  AnalysisPort,
  AnalysisRequest,
  AnalysisResult,
  PluginDescriptor,
} from "../../../packages/analysis/src/types";
import { TRUSTED_ADAPTER_CATALOG } from "./trusted-adapters";

type WorkerResponse =
  | { ok: true; result?: AnalysisResult; catalog?: PluginDescriptor[] }
  | { ok: false; error: string };

/** A single-flight worker port. A new request terminates old synchronous work. */
export class BrowserAnalysisPort implements AnalysisPort {
  private worker: Worker | null = null;
  private reject: ((reason: Error) => void) | null = null;

  async catalog(): Promise<PluginDescriptor[]> {
    const worker = new Worker(
      new URL("./analysis-worker.ts", import.meta.url),
      { type: "module" },
    );
    return new Promise((resolve, reject) => {
      worker.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          worker.terminate();
          if (event.data.ok && event.data.catalog)
            resolve([...event.data.catalog, ...TRUSTED_ADAPTER_CATALOG]);
          else if (!event.data.ok) reject(new Error(event.data.error));
          else reject(new Error("Missing proofreading catalog."));
        },
        { once: true },
      );
      worker.postMessage({ kind: "catalog" });
    });
  }

  analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    this.reject?.(new Error("Analysis superseded by a newer revision."));
    this.worker?.terminate();
    this.worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), {
      type: "module",
    });
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.worker?.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          this.reject = null;
          if (event.data.ok && event.data.result) resolve(event.data.result);
          else if (!event.data.ok) reject(new Error(event.data.error));
          else reject(new Error("Missing proofreading result."));
        },
        { once: true },
      );
      this.worker?.postMessage(request);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.reject = null;
  }
}
