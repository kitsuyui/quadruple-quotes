import { afterAll, beforeAll, expect, test } from "bun:test";
import { request as nodeRequest } from "node:http";

let port: number;
let server: Bun.Subprocess | undefined;
const request = (
  body: unknown,
  init: RequestInit = {},
  path = "/api/dependencies",
) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
const fragmentedRequest = (body: Buffer, split: number) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const next = nodeRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/dependencies",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    next.on("error", reject);
    next.write(body.subarray(0, split));
    setTimeout(() => next.end(body.subarray(split)), 10);
  });

beforeAll(async () => {
  // Allocate a fresh test port instead of contacting another run's helper.
  const reservation = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });
  port = reservation.port ?? 0;
  reservation.stop(true);
  server = Bun.spawn(["bun", "apps/analysis-host/server.ts"], {
    env: {
      ...process.env,
      ANALYSIS_HOST_PORT: String(port),
      ANALYSIS_HOST_TIMEOUT_MS: "100",
      ANALYSIS_HOST_PYTHON: "python3",
      ANALYSIS_HOST_SCRIPT: "tests/fixtures/fake-dependency-parser.py",
      ANALYSIS_HOST_JAPANESE_STYLE_RUNNER:
        "tests/fixtures/fake-japanese-style-runner.ts",
    },
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (server.exitCode !== null)
      throw new Error("test host exited before becoming ready");
    try {
      await request({ text: "ready" });
      if (server.exitCode !== null)
        throw new Error("test host did not own its port");
      return;
    } catch {
      await Bun.sleep(25);
    }
  }
  throw new Error("host did not start");
});
afterAll(async () => {
  if (!server) return;
  server.kill();
  await Promise.race([server.exited, Bun.sleep(100)]);
  // The helper's SIGTERM handler stops its parser; close this owned test host too.
  if (server.exitCode === null) server.kill("SIGKILL");
  await server.exited;
});
test("rejects unexpected origins and oversized or invalid input", async () => {
  expect(
    (
      await request(
        { text: "x" },
        { headers: { origin: "https://example.invalid" } },
      )
    ).status,
  ).toBe(403);
  expect((await request({ text: "x".repeat(6000) })).status).toBe(400);
  expect((await request({ text: "x".repeat(20_001) })).status).toBe(413);
  expect(
    (
      await fetch(`http://127.0.0.1:${port}/api/dependencies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(`http://127.0.0.1:${port}/api/dependencies`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify({ text: "charset" }),
      })
    ).status,
  ).toBe(200);
});
test("reuses one child and keeps only one request in flight", async () => {
  const slow = request({ text: "brief" });
  await Bun.sleep(10);
  const controller = new AbortController();
  const rejected = request({ text: "next" }, { signal: controller.signal });
  controller.abort();
  await rejected.catch(() => undefined);
  expect((await slow).status).toBe(200);
  expect((await request({ text: "again" })).status).toBe(200);
});
test("contains malformed parser output and child failure", async () => {
  expect((await request({ text: "malformed" })).status).toBe(502);
  expect((await request({ text: "exit" })).status).toBe(502);
  expect((await request({ text: "after-exit" })).status).toBe(200);
});
test("returns parser capability and schema failures as errors, then reuses the resident parser", async () => {
  const missing = await request({ text: "model-missing" });
  expect(missing.status).toBe(503);
  expect((await missing.json()).error).toContain("GiNZA model missing");
  expect((await request({ text: "parse-failure" })).status).toBe(502);
  expect((await request({ text: "invalid-dependencies" })).status).toBe(502);
  expect((await request({ text: "duplicate-graph" })).status).toBe(502);
  expect((await request({ text: "emoji-range" })).status).toBe(502);
  expect((await request({ text: "😀x" })).status).toBe(502);
  expect((await request({ text: "cycle-graph" })).status).toBe(502);
  expect((await request({ text: "wrong-id" })).status).toBe(502);
  expect((await request({ text: "primitive-node" })).status).toBe(502);
  expect((await request({ text: "after-parser-error" })).status).toBe(200);
});
test("preserves UTF-8 across fragmented HTTP, parser stdout, and parser restart", async () => {
  const body = Buffer.from(JSON.stringify({ text: "東京😀" }));
  const split = body.indexOf(Buffer.from("東")) + 1;
  const http = await fragmentedRequest(body, split);
  expect(http.status).toBe(200);
  expect(JSON.parse(http.body).dependencies).toEqual([]);

  expect((await request({ text: "partial-then-exit" })).status).toBe(502);
  await Bun.sleep(25);
  const parsed = await request({ text: "unicode-split" });
  expect(parsed.status).toBe(200);
  expect((await parsed.json()).dependencies[0].relation).toBe("分割😀");
});
test("accepts a complete 5,000-node chain without quadratic ancestor walks", async () => {
  const started = performance.now();
  const response = await request({ text: "x".repeat(5000) });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { dependencies: unknown[] };
  expect(payload.dependencies).toHaveLength(5000);
  // This is intentionally generous for a loaded CI worker but catches a
  // per-node ancestor traversal regression at the advertised graph limit.
  expect(performance.now() - started).toBeLessThan(1_500);
});
test("discards timed out and aborted request results before the next job", async () => {
  expect((await request({ text: "slow" })).status).toBe(504);
  await Bun.sleep(220);
  expect((await request({ text: "after-timeout" })).status).toBe(200);
  const controller = new AbortController();
  const aborted = request({ text: "slow" }, { signal: controller.signal });
  await Bun.sleep(10);
  controller.abort();
  await aborted.catch(() => undefined);
  await Bun.sleep(220);
  expect((await request({ text: "after-abort" })).status).toBe(200);
});
test("discards a response older than the current request after tombstone capacity", async () => {
  for (let index = 0; index < 33; index++)
    expect((await request({ text: "sequence" })).status).toBe(200);
  expect((await request({ text: "old-response" })).status).toBe(200);
});
test("bounds an unterminated parser output frame and respawns", async () => {
  expect((await request({ text: "huge-output" })).status).toBe(502);
  await Bun.sleep(25);
  expect((await request({ text: "after-huge-output" })).status).toBe(200);
});

test("bounds and validates local Japanese style requests independently", async () => {
  const valid = await request(
    {
      text: "これはこれはテストです。",
      format: "text",
      rules: ["no-doubled-joshi"],
    },
    {},
    "/api/japanese-style",
  );
  expect(valid.status).toBe(200);
  const validPayload = (await valid.json()) as {
    diagnostics: { message: string }[];
  };
  expect(validPayload.diagnostics).toHaveLength(1);
  expect(validPayload.diagnostics[0]?.message).toBe("分割😀を保持");
  expect(
    (
      await request(
        { text: "x", format: "html", rules: ["no-doubled-joshi"] },
        {},
        "/api/japanese-style",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        { text: "x", format: "text", rules: ["untrusted"] },
        {},
        "/api/japanese-style",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        {
          text: "😀".repeat(2501),
          format: "text",
          rules: ["no-doubled-joshi"],
        },
        {},
        "/api/japanese-style",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        { text: "x", format: "markdown", rules: [] },
        { headers: { origin: "https://example.invalid" } },
        "/api/japanese-style",
      )
    ).status,
  ).toBe(403);
});
