import { expect, test } from "bun:test";
import {
  desktopAnalysis,
  desktopClipboard,
  desktopFiles,
} from "../apps/web/src/desktop-host";
import type {
  AnalysisPort,
  AnalysisRequest,
} from "../packages/analysis/src/types";

const request: AnalysisRequest = {
  documentId: "desktop-document",
  revision: 1,
  text: "Japanese text",
  format: "text",
  settings: { plugins: {}, rules: {} },
};

test("desktop files preserve UTF-8 BOM, whitespace, and Unicode", async () => {
  const files = desktopFiles(async () => null);
  const input = new TextEncoder().encode("\ufeff  日本語\n");
  const value = await files.read(
    {
      name: "draft.txt",
      size: input.byteLength,
      arrayBuffer: async () => input.buffer,
    },
    1024,
  );
  expect(value).toBe("\ufeff  日本語\n");
});

test("desktop selection is cancel-safe and save delegates only to the trusted command", async () => {
  const calls: Array<{ command: string; arguments?: Record<string, unknown> }> =
    [];
  const files = desktopFiles(async (command, arguments_) => {
    calls.push({ command, arguments: arguments_ });
    return null;
  });
  expect(await files.pick?.()).toBeNull();
  await files.download("draft.txt", " text ", "text/plain;charset=utf-8");
  expect(calls).toEqual([
    { command: "pick_file", arguments: undefined },
    {
      command: "save_file",
      arguments: {
        name: "draft.txt",
        text: " text ",
        mime: "text/plain;charset=utf-8",
      },
    },
  ]);
});

test("desktop file errors and clipboard commands remain explicit", async () => {
  const files = desktopFiles(async () => {
    throw new Error("denied");
  });
  await expect(files.pick?.()).rejects.toThrow(
    "Could not open the file: denied",
  );
  const clipboard = desktopClipboard(async (command) =>
    command === "read_clipboard" ? "copied" : undefined,
  );
  expect(await clipboard.readText()).toBe("copied");
  await clipboard.writeText("written");
});

test("desktop marks native helpers unavailable without contacting their hosts", async () => {
  let dependencyCalls = 0;
  let japaneseCalls = 0;
  const browser: AnalysisPort = {
    catalog: async () => [
      {
        id: "core",
        name: "Core",
        description: "Local core",
        defaultEnabled: true,
        runPolicy: "realtime",
        rules: [],
      },
      {
        id: "ginza",
        name: "GiNZA",
        description: "Local parser",
        defaultEnabled: true,
        runPolicy: "manual",
        rules: [],
      },
      {
        id: "textlint-ja-morphology",
        name: "Japanese style",
        description: "Local helper",
        defaultEnabled: true,
        runPolicy: "manual",
        rules: [],
      },
    ],
    analyze: async () => {
      throw new Error("not used by this test");
    },
    analyzeDependencies: async () => {
      dependencyCalls += 1;
      throw new Error("must not run");
    },
    analyzeJapaneseStyle: async () => {
      japaneseCalls += 1;
      throw new Error("must not run");
    },
    cancel() {},
    dispose() {},
  };
  const desktop = desktopAnalysis(browser);
  const catalog = await desktop.catalog();
  expect(
    catalog.find((plugin) => plugin.id === "ginza")?.description,
  ).toContain("Unavailable in the desktop app");
  expect(
    catalog.find((plugin) => plugin.id === "textlint-ja-morphology")
      ?.defaultEnabled,
  ).toBeFalse();
  await expect(desktop.analyzeDependencies(request)).resolves.toMatchObject({
    status: { pluginId: "ginza", status: "disabled" },
    dependencies: [],
  });
  await expect(desktop.analyzeJapaneseStyle(request)).resolves.toMatchObject({
    status: { pluginId: "textlint-ja-morphology", status: "disabled" },
    diagnostics: [],
  });
  expect({ dependencyCalls, japaneseCalls }).toEqual({
    dependencyCalls: 0,
    japaneseCalls: 0,
  });
});
