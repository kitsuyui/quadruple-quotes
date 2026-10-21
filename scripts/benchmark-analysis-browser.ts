import { chromium } from "@playwright/test";
import { build, preview } from "vite";

const output = ".tmp/remaining-roadmap/priority4-performance.json";
await build({
  configFile: "apps/web/vite.config.ts",
  build: {
    rollupOptions: { input: ["index.html", "analysis-benchmark.html"] },
  },
});
const server = await preview({
  configFile: "apps/web/vite.config.ts",
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});

try {
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("Vite did not publish a local benchmark URL.");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}analysis-benchmark.html`, {
      waitUntil: "networkidle",
    });
    const metrics = await page.evaluate(async () => {
      if (!window.runAnalysisBenchmark)
        throw new Error("Benchmark entry did not load.");
      return window.runAnalysisBenchmark();
    });
    const report = {
      measuredAt: new Date().toISOString(),
      command: "bun run scripts/benchmark-analysis-browser.ts",
      environment: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
      metrics,
    };
    await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
