import { expect, test } from "bun:test";
import { BrowserAnalysisPort } from "../apps/web/src/analysis-port";
import type {
  AnalysisRequest,
  AnalysisResult,
} from "../packages/analysis/src/types";

const request: AnalysisRequest = {
  documentId: "doc",
  revision: 1,
  text: "text",
  format: "text",
  settings: { plugins: {}, rules: {} },
};
const coreResult: AnalysisResult = {
  documentId: "doc",
  revision: 1,
  metrics: {
    characters: 4,
    charactersWithoutWhitespace: 4,
    unicodeScalars: 4,
    utf16Units: 4,
    bytes: 4,
    lines: 1,
    words: 1,
  },
  diagnostics: [],
  dependencies: [],
  statuses: [],
  truncated: false,
};

class FakeWorker {
  listeners: {
    message: ((event: MessageEvent<unknown>) => void)[];
    error: ((event: ErrorEvent) => void)[];
  } = {
    message: [],
    error: [],
  };
  terminated = false;
  posted: {
    id: number;
    kind: string;
    pluginId?: string;
    request?: AnalysisRequest;
    core?: { result: AnalysisResult };
    adapters?: { statuses: unknown[] };
  }[] = [];
  respond = true;
  addEventListener(
    type: "message",
    callback: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(type: "error", callback: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "message" | "error",
    callback:
      | ((event: MessageEvent<unknown>) => void)
      | ((event: ErrorEvent) => void),
  ) {
    if (type === "message")
      this.listeners.message.push(
        callback as (event: MessageEvent<unknown>) => void,
      );
    else this.listeners.error.push(callback as (event: ErrorEvent) => void);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(message: {
    id: number;
    kind: string;
    pluginId?: string;
    request?: AnalysisRequest;
    core?: { result: AnalysisResult };
    adapters?: { statuses: unknown[] };
  }) {
    this.posted.push(message);
    queueMicrotask(() => {
      if (this.terminated || !this.respond) return;
      const data =
        message.kind === "core"
          ? {
              id: message.id,
              ok: true,
              core: {
                result: {
                  ...coreResult,
                  documentId: message.request?.documentId ?? "doc",
                  revision: message.request?.revision ?? 1,
                },
                effectiveSettings: request.settings,
              },
            }
          : message.kind === "adapter"
            ? {
                id: message.id,
                ok: true,
                adapters: {
                  diagnostics: [],
                  statuses: [{ pluginId: message.pluginId, status: "ok" }],
                },
              }
            : message.kind === "policy"
              ? {
                  id: message.id,
                  ok: true,
                  result: {
                    ...(message.core?.result ?? coreResult),
                    statuses: message.adapters?.statuses ?? [],
                  },
                }
              : message.kind === "dependencies"
                ? {
                    id: message.id,
                    ok: true,
                    dependencies: {
                      documentId: "doc",
                      revision: 1,
                      dependencies: [],
                      status: { pluginId: "ginza", status: "ok" },
                    },
                  }
                : { id: message.id, ok: true, catalog: [] };
      for (const callback of this.listeners.message)
        callback({ data } as MessageEvent<unknown>);
    });
  }
  emit(data: unknown) {
    for (const callback of this.listeners.message)
      callback({ data } as MessageEvent<unknown>);
  }
  fail(message = "worker failed") {
    for (const callback of this.listeners.error)
      callback({ message } as ErrorEvent);
  }
}

test("keeps five fixed lanes warm and isolates manual dependency work", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const realtime = await port.analyze(request);
  await port.analyzeDependencies(request);
  expect(realtime.statuses).toHaveLength(3);
  expect(workers).toHaveLength(5); // core + three adapters + GiNZA
  await port.analyze({ ...request, revision: 2 });
  expect(workers).toHaveLength(5); // idle workers are reused
  port.dispose();
  expect(workers.every((worker) => worker.terminated)).toBe(true);
});

test("catalog and realtime analysis use independent lanes in either order", async () => {
  for (const catalogFirst of [true, false]) {
    const workers: FakeWorker[] = [];
    const port = new BrowserAnalysisPort(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const catalog = catalogFirst ? port.catalog() : undefined;
    const analysis = port.analyze(request);
    const concurrentCatalog = catalog ?? port.catalog();
    if (catalogFirst) {
      await expect(concurrentCatalog).resolves.toHaveLength(5);
      await expect(analysis).resolves.toMatchObject({ documentId: "doc" });
    } else {
      await expect(analysis).resolves.toMatchObject({ documentId: "doc" });
      await expect(concurrentCatalog).resolves.toHaveLength(5);
    }
    const created = workers.length;
    await expect(port.catalog()).resolves.toHaveLength(5);
    expect(workers).toHaveLength(created);
    expect(workers.some((worker) => worker.terminated)).toBe(true);
    port.dispose();
  }
});

test("catalog survives realtime cancellation and keeps its successful cache", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(() => {
    const worker = new FakeWorker();
    worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = port.catalog();
  port.cancel();
  expect(port.catalog()).toBe(first);
  const catalogWorker = workers[0];
  if (!catalogWorker) throw new Error("Catalog worker was not created.");
  catalogWorker.respond = true;
  catalogWorker.emit({
    id: catalogWorker.posted[0]?.id,
    ok: true,
    catalog: [],
  });
  await expect(first).resolves.toHaveLength(5);
  const count = workers.length;
  port.cancel();
  await expect(port.catalog()).resolves.toHaveLength(5);
  expect(workers).toHaveLength(count);
  port.dispose();
});

test("replaces busy realtime work and ignores a stale reply from its retired lane", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(() => {
    const worker = new FakeWorker();
    worker.respond = workers.length !== 0;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = port.analyze(request);
  await Promise.resolve();
  const second = port.analyze({ ...request, revision: 2 });
  await expect(first).rejects.toThrow("superseded");
  const retiredCore = workers[0];
  retiredCore.emit({
    id: retiredCore.posted[0]?.id,
    ok: true,
    core: { result: coreResult, effectiveSettings: request.settings },
  });
  await expect(second).resolves.toMatchObject({ revision: 2 });
  expect(retiredCore.terminated).toBe(true);
  port.dispose();
});

test("times out only a stuck adapter and keeps other adapter results", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(
    (lane) => {
      const worker = new FakeWorker();
      if (lane === "textlint-ja") worker.respond = false;
      workers.push(worker);
      return worker as unknown as Worker;
    },
    { realtime: 10 },
  );
  const result = await port.analyze({
    ...request,
    format: "markdown",
    settings: { plugins: { markdownlint: true }, rules: {} },
  });
  expect(result.statuses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pluginId: "textlint-ja", status: "error" }),
      expect.objectContaining({ pluginId: "markdownlint", status: "ok" }),
    ]),
  );
  expect(
    workers.find((worker) => worker.posted[0]?.pluginId === "textlint-ja")
      ?.terminated,
  ).toBe(true);
  port.dispose();
});

test("cancel and dispose reject every outstanding lane request", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(() => {
    const worker = new FakeWorker();
    worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const realtime = port.analyze(request);
  const dependency = port.analyzeDependencies(request);
  await Promise.resolve();
  port.cancel();
  await expect(realtime).rejects.toThrow("superseded");
  port.dispose();
  await expect(dependency).rejects.toThrow("disposed");
  expect(workers.every((worker) => worker.terminated)).toBe(true);
});

test("recovers catalog lifecycle after a worker error", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort(() => {
    const worker = new FakeWorker();
    worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const catalog = port.catalog();
  await Promise.resolve();
  workers[0]?.fail("startup error");
  await expect(catalog).rejects.toThrow("catalog worker failed: startup error");
  const recovered = port.catalog();
  const replacement = workers[1];
  if (!replacement)
    throw new Error("Catalog did not create a replacement worker.");
  replacement.respond = true;
  await expect(recovered).resolves.toHaveLength(5);
  port.dispose();
});

function japaneseReply(worker: FakeWorker, request: AnalysisRequest) {
  worker.emit({
    id: worker.posted[0]?.id,
    ok: true,
    japaneseStyle: {
      documentId: request.documentId,
      revision: request.revision,
      diagnostics: [],
      status: { pluginId: "textlint-ja-morphology", status: "ok" },
    },
  });
}

test("a late Japanese result cannot replace a newer realtime analysis", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort((lane) => {
    const worker = new FakeWorker();
    if (lane === "Japanese style") worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const manual = port.analyzeJapaneseStyle(request);
  await Promise.resolve();
  const japanese = workers.find(
    (worker) => worker.posted[0]?.kind === "japanese-style",
  );
  if (!japanese) throw new Error("Japanese lane was not created.");
  const realtime = port.analyze({ ...request, revision: 2 });
  await expect(manual).rejects.toThrow("superseded");
  expect(japanese.terminated).toBe(true);
  japaneseReply(japanese, request);
  await expect(realtime).resolves.toMatchObject({ revision: 2 });
  expect(
    workers.filter((worker) => worker.posted[0]?.kind === "core"),
  ).toHaveLength(1);
  port.dispose();
});

test("a matching realtime snapshot does not supersede Japanese style analysis", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort((lane) => {
    const worker = new FakeWorker();
    if (lane === "Japanese style") worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const manual = port.analyzeJapaneseStyle(request);
  await Promise.resolve();
  const japanese = workers.find(
    (worker) => worker.posted[0]?.kind === "japanese-style",
  );
  if (!japanese) throw new Error("Japanese lane was not created.");
  const realtime = port.analyze(request);
  japaneseReply(japanese, request);
  await expect(realtime).resolves.toMatchObject({ revision: 1 });
  await expect(manual).resolves.toMatchObject({
    documentId: "doc",
    revision: 1,
  });
  port.dispose();
});

test("cancel rejects pending Japanese style work without starting a core worker", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort((lane) => {
    const worker = new FakeWorker();
    if (lane === "Japanese style") worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const manual = port.analyzeJapaneseStyle(request);
  await Promise.resolve();
  port.cancel();
  await expect(manual).rejects.toThrow("superseded");
  expect(workers).toHaveLength(1);
  expect(workers[0]?.terminated).toBe(true);
  port.dispose();
});

test("dispose rejects pending Japanese style work and never recreates a worker", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort((lane) => {
    const worker = new FakeWorker();
    if (lane === "Japanese style") worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const manual = port.analyzeJapaneseStyle(request);
  await Promise.resolve();
  const japanese = workers[0];
  if (!japanese) throw new Error("Japanese lane was not created.");
  port.dispose();
  japaneseReply(japanese, request);
  await expect(manual).rejects.toThrow("disposed");
  expect(workers).toHaveLength(1);
});

test("a same-text Japanese retry rejects the old request and uses only the new result", async () => {
  const workers: FakeWorker[] = [];
  const port = new BrowserAnalysisPort((lane) => {
    const worker = new FakeWorker();
    if (lane === "Japanese style") worker.respond = false;
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = port.analyzeJapaneseStyle(request);
  await Promise.resolve();
  const second = port.analyzeJapaneseStyle(request);
  await expect(first).rejects.toThrow("superseded");
  const current = workers.at(-1);
  if (!current) throw new Error("Japanese retry did not create a worker.");
  japaneseReply(current, request);
  await expect(second).resolves.toMatchObject({
    documentId: "doc",
    revision: 1,
  });
  expect(
    workers.filter((worker) => worker.posted[0]?.kind === "japanese-style"),
  ).toHaveLength(2);
  port.dispose();
});
