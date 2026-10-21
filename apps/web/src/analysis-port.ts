import type {
  AnalysisPort,
  AnalysisRequest,
  AnalysisResult,
  DependencyAnalysisResult,
  Diagnostic,
  PluginDescriptor,
  PluginStatus,
} from "../../../packages/analysis/src/types";
import { TRUSTED_ADAPTER_CATALOG } from "./trusted-adapters";

const REALTIME_TIMEOUT_MS = 8_000;
const DEPENDENCY_TIMEOUT_MS = 7_000;
const ADAPTER_IDS = ["markdownlint", "textlint-ja", "textlint-ai"] as const;
type AdapterId = (typeof ADAPTER_IDS)[number];
type CorePayload = {
  result: AnalysisResult;
  effectiveSettings: AnalysisRequest["settings"];
};
type AdapterPayload = { diagnostics: Diagnostic[]; statuses: PluginStatus[] };
type WorkerResponse =
  | { id: number; ok: true; catalog: PluginDescriptor[] }
  | { id: number; ok: true; core: CorePayload }
  | { id: number; ok: true; result: AnalysisResult }
  | { id: number; ok: true; adapters: AdapterPayload }
  | { id: number; ok: true; dependencies: DependencyAnalysisResult }
  | { id: number; ok: false; error: string };
type Pending<T> = {
  id: number;
  resolve(value: T): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** An idle worker stays warm. A deadline or replacement terminates only its lane,
 * which is the hard cancellation boundary for synchronous WASM and JS work. */
class WorkerLane {
  private worker: Worker | null = null;
  private pending: Pending<unknown> | null = null;
  constructor(
    private readonly name: string,
    private readonly makeWorker: () => Worker,
    private readonly nextId: () => number,
  ) {}
  private ensure() {
    if (this.worker) return this.worker;
    const worker = this.makeWorker();
    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        const pending = this.pending;
        if (!pending || event.data.id !== pending.id) return;
        this.pending = null;
        clearTimeout(pending.timer);
        if (!event.data.ok) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data);
      },
    );
    worker.addEventListener("error", (event) =>
      this.stop(
        `${this.name} worker failed: ${event.message || "unknown error"}`,
      ),
    );
    this.worker = worker;
    return worker;
  }
  request<T>(message: object, timeoutMs: number): Promise<T> {
    if (this.pending)
      this.stop(`${this.name} was superseded by a newer revision.`);
    const id = this.nextId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending) this.stop(`${this.name} timed out.`);
      }, timeoutMs);
      this.pending = {
        id,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      };
      this.ensure().postMessage({ ...message, id });
    });
  }
  cancel(reason = `${this.name} was superseded by a newer revision.`) {
    if (this.pending) this.stop(reason);
  }
  dispose() {
    this.stop(`${this.name} was disposed.`);
    this.worker?.terminate();
    this.worker = null;
  }
  private stop(reason: string) {
    this.worker?.terminate();
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  }
}

/** Five bounded lanes: core, three adapters, and manual GiNZA. Only core loads WASM. */
export class BrowserAnalysisPort implements AnalysisPort {
  private nextRequestId = 1;
  private generation = 0;
  private readonly core: WorkerLane;
  private readonly catalogLane: WorkerLane;
  private catalogCache: Promise<PluginDescriptor[]> | null = null;
  private readonly adapters: Record<AdapterId, WorkerLane>;
  private readonly dependencies: WorkerLane;
  constructor(
    private readonly workerFactory: (lane: string) => Worker = (lane) => {
      if (ADAPTER_IDS.includes(lane as AdapterId))
        return new Worker(
          new URL("./analysis-adapter-worker.ts", import.meta.url),
          { type: "module" },
        );
      return new Worker(new URL("./analysis-worker.ts", import.meta.url), {
        type: "module",
      });
    },
    private readonly timeouts: {
      realtime?: number;
      dependency?: number;
    } = {},
  ) {
    this.core = this.lane("core");
    this.catalogLane = this.lane("catalog");
    this.adapters = Object.fromEntries(
      ADAPTER_IDS.map((id) => [id, this.lane(id)]),
    ) as Record<AdapterId, WorkerLane>;
    this.dependencies = this.lane("GiNZA");
  }
  private lane(name: string) {
    return new WorkerLane(
      name,
      () => this.workerFactory(name),
      () => this.nextRequestId++,
    );
  }
  catalog(): Promise<PluginDescriptor[]> {
    if (this.catalogCache) return this.catalogCache;
    const catalog = this.catalogLane
      .request<WorkerResponse>(
        { kind: "catalog", lane: "core" },
        this.timeouts.realtime ?? REALTIME_TIMEOUT_MS,
      )
      .then((response) => {
        if (!("catalog" in response))
          throw new Error("Missing proofreading catalog.");
        return [...response.catalog, ...TRUSTED_ADAPTER_CATALOG];
      });
    this.catalogCache = catalog;
    void catalog.then(
      () => {
        if (this.catalogCache === catalog) this.catalogLane.dispose();
      },
      () => {
        if (this.catalogCache === catalog) {
          this.catalogCache = null;
          this.catalogLane.dispose();
        }
      },
    );
    return catalog;
  }
  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const generation = ++this.generation;
    this.cancelRealtime();
    const coreResponse = await this.core.request<WorkerResponse>(
      { kind: "core", lane: "core", request: { ...request, manual: false } },
      this.timeouts.realtime ?? REALTIME_TIMEOUT_MS,
    );
    if (!("core" in coreResponse))
      throw new Error("Missing core analysis result.");
    this.assertResultIdentity(coreResponse.core.result, request);
    this.assertCurrent(generation, request);
    const effectiveRequest = {
      ...request,
      settings: coreResponse.core.effectiveSettings,
      manual: false,
    };
    const settled = await Promise.allSettled(
      ADAPTER_IDS.map((pluginId) =>
        this.adapters[pluginId].request<WorkerResponse>(
          {
            kind: "adapter",
            lane: pluginId,
            pluginId,
            request: effectiveRequest,
          },
          this.timeouts.realtime ?? REALTIME_TIMEOUT_MS,
        ),
      ),
    );
    this.assertCurrent(generation, request);
    const adapters: AdapterPayload = { diagnostics: [], statuses: [] };
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      const pluginId = ADAPTER_IDS[index];
      if (result.status === "fulfilled" && "adapters" in result.value) {
        adapters.diagnostics.push(...result.value.adapters.diagnostics);
        adapters.statuses.push(...result.value.adapters.statuses);
      } else
        adapters.statuses.push({
          pluginId,
          status: "error",
          message:
            result.status === "rejected"
              ? String(
                  result.reason instanceof Error
                    ? result.reason.message
                    : result.reason,
                )
              : "Malformed adapter response.",
        });
    }
    const finalResponse = await this.core.request<WorkerResponse>(
      { kind: "policy", lane: "core", core: coreResponse.core, adapters },
      this.timeouts.realtime ?? REALTIME_TIMEOUT_MS,
    );
    if (!("result" in finalResponse))
      throw new Error("Missing final proofreading result.");
    this.assertResultIdentity(finalResponse.result, request);
    this.assertCurrent(generation, request);
    return finalResponse.result;
  }
  analyzeDependencies(
    request: AnalysisRequest,
  ): Promise<DependencyAnalysisResult> {
    return this.dependencies
      .request<WorkerResponse>(
        { kind: "dependencies", lane: "ginza", request },
        this.timeouts.dependency ?? DEPENDENCY_TIMEOUT_MS,
      )
      .then((response) => {
        if (!("dependencies" in response))
          throw new Error("Missing dependency analysis result.");
        return response.dependencies;
      });
  }
  cancel() {
    this.generation += 1;
    this.cancelRealtime();
  }
  dispose() {
    this.generation += 1;
    this.catalogCache = null;
    this.core.dispose();
    this.catalogLane.dispose();
    for (const lane of Object.values(this.adapters)) lane.dispose();
    this.dependencies.dispose();
  }
  private cancelRealtime() {
    this.core.cancel();
    for (const lane of Object.values(this.adapters)) lane.cancel();
  }
  private assertCurrent(generation: number, request: AnalysisRequest) {
    if (generation !== this.generation)
      throw new Error("Analysis superseded by a newer revision.");
    if (!request.documentId || !Number.isSafeInteger(request.revision))
      throw new Error("Invalid analysis request identity.");
  }
  private assertResultIdentity(
    result: AnalysisResult,
    request: AnalysisRequest,
  ) {
    if (
      result.documentId !== request.documentId ||
      result.revision !== request.revision
    )
      throw new Error(
        "Analysis worker returned a result for another revision.",
      );
  }
}
