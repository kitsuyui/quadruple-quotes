import { afterAll, beforeAll, expect, test } from "bun:test";

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
  expect((await request({ text: "wrong-id" })).status).toBe(502);
  expect((await request({ text: "after-parser-error" })).status).toBe(200);
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
  expect((await valid.json()).diagnostics).toHaveLength(1);
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
