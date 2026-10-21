import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const workerEntityDecoder = fileURLToPath(
  new URL(
    "../../node_modules/decode-named-character-reference/index.js",
    import.meta.url,
  ),
);

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  resolve: {
    alias: {
      assert: "/src/browser-assert.cjs",
      "node:assert": "/src/browser-assert.cjs",
      "decode-named-character-reference": workerEntityDecoder,
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api/dependencies": {
        target: `http://127.0.0.1:${process.env.ANALYSIS_HOST_PORT ?? 4180}`,
        changeOrigin: true,
      },
      "/api/japanese-style": {
        target: `http://127.0.0.1:${process.env.ANALYSIS_HOST_PORT ?? 4180}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    proxy: {
      "/api/dependencies": {
        target: `http://127.0.0.1:${process.env.ANALYSIS_HOST_PORT ?? 4180}`,
        changeOrigin: true,
      },
      "/api/japanese-style": {
        target: `http://127.0.0.1:${process.env.ANALYSIS_HOST_PORT ?? 4180}`,
        changeOrigin: true,
      },
    },
  },
});
