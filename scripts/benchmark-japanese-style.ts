import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { build, preview } from "vite";

const text = "😀これはこれは日本語の文章です。".repeat(120);
const request = JSON.stringify({
  text,
  format: "text",
  rules: ["no-doubled-joshi"],
});
const runs: number[] = [];
for (let index = 0; index < 11; index += 1) {
  const started = performance.now();
  const child = spawn("bun", ["apps/analysis-host/japanese-style-runner.ts"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.end(request);
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`runner exited ${code}`)),
    );
  });
  JSON.parse(Buffer.concat(chunks).toString());
  runs.push(performance.now() - started);
}
const warm = [...runs.slice(1)].sort((a, b) => a - b);
const percentile = (fraction: number) =>
  warm[Math.min(warm.length - 1, Math.ceil(warm.length * fraction) - 1)];
const hostPort = 4261;
const previewPort = 4262;
const origins = `http://127.0.0.1:${previewPort}`;
process.env.ANALYSIS_HOST_PORT = String(hostPort);
const host = spawn("bun", ["apps/analysis-host/server.ts"], {
  env: {
    ...process.env,
    ANALYSIS_HOST_PORT: String(hostPort),
    ANALYSIS_HOST_ORIGINS: origins,
  },
  stdio: "ignore",
});
const stopHost = () => {
  if (host.exitCode === null) host.kill();
};
process.on("exit", stopHost);
try {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const requestStyle = async (body: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${hostPort}/api/japanese-style`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: origins },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const accepted = await requestStyle({
    text: "は".repeat(5000),
    format: "text",
    rules: ["no-doubled-joshi"],
  });
  const rejected = await requestStyle({
    text: "は".repeat(5001),
    format: "text",
    rules: ["no-doubled-joshi"],
  });
  if (accepted.status !== 200 || rejected.status !== 400)
    throw new Error("Japanese style UTF-16 boundary check failed.");
  const capped = await requestStyle({
    text: "これはこれはテストです。".repeat(100),
    format: "text",
    rules: ["no-doubled-joshi"],
  });
  if (
    capped.status !== 200 ||
    !Array.isArray((capped.body as { diagnostics?: unknown }).diagnostics) ||
    (capped.body as { diagnostics: unknown[] }).diagnostics.length > 200
  )
    throw new Error("Japanese style diagnostic cap check failed.");

  await build({
    configFile: "apps/web/vite.config.ts",
    build: {
      rollupOptions: { input: ["index.html", "analysis-benchmark.html"] },
    },
  });
  const previewServer = await preview({
    configFile: "apps/web/vite.config.ts",
    preview: { host: "127.0.0.1", port: previewPort, strictPort: true },
  });
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${origins}/analysis-benchmark.html`, {
        waitUntil: "networkidle",
      });
      const browserMetrics = await page.evaluate(async () => {
        if (!window.runAnalysisBenchmark)
          throw new Error("Benchmark entry did not load.");
        return window.runAnalysisBenchmark();
      });
      console.log(
        JSON.stringify(
          {
            definition:
              "Every native sample spawns a local runner; warm excludes the first sample and is not a resident helper cache.",
            utf16Units: text.length,
            coldMs: runs[0],
            warmMedianMs: percentile(0.5),
            warmP95Ms: percentile(0.95),
            samplesMs: runs,
            limits: {
              accepted5000Utf16: accepted.status,
              rejected5001Utf16: rejected.status,
              diagnosticCount: (capped.body as { diagnostics: unknown[] })
                .diagnostics.length,
              diagnosticCap: 200,
            },
            browser100kBracket: browserMetrics,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
    }
  } finally {
    await previewServer.close();
  }
} finally {
  stopHost();
  if (host.exitCode === null)
    await Promise.race([
      once(host, "exit"),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
}
