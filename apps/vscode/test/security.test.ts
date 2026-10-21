import { expect, mock, test } from "bun:test";
import manifest from "../package.json";

const source = await Bun.file(
  new URL("../src/extension.ts", import.meta.url),
).text();

test("manifest exposes only an explicit executable configuration", () => {
  const property =
    manifest.contributes.configuration.properties["quadrupleQuotes.serverPath"];
  expect(property.default).toBe("quadruple-quotes-lsp");
  expect(manifest.activationEvents).toEqual([
    "onLanguage:plaintext",
    "onLanguage:markdown",
  ]);
  expect(manifest.capabilities.untrustedWorkspaces).toEqual({
    supported: false,
  });
});

test("client supplies nested initial settings and keeps untrusted paths fixed", () => {
  expect(source).toContain("initializationOptions: initialSettings()");
  expect(source).toContain("quadrupleQuotes");
  expect(source).toContain("rules: c.get<Record<string, boolean>>");
  expect(source).toContain('allowedWords: c.get<string[]>("allowedWords", [])');
  expect(source).not.toContain("serverPath: c.get");
  expect(source).toContain(
    'workspace.isTrusted ? value : "quadruple-quotes-lsp"',
  );
});

test("manifest sends a valid empty allowed-words default", () => {
  const property =
    manifest.contributes.configuration.properties[
      "quadrupleQuotes.allowedWords"
    ];
  expect(property.default).toEqual([]);
  expect(property.items).toEqual({ type: "string" });
  expect(manifest.repository.url).toBe(
    "https://github.com/kitsuyui/quadruple-quotes.git",
  );
  expect(manifest.license).toBe("MIT");
  expect("files" in manifest).toBe(false);
});

test("untrusted activation never constructs or starts a language client", async () => {
  let constructed = 0;
  let started = 0;
  mock.module("vscode", () => ({
    workspace: {
      isTrusted: false,
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) =>
          "untrusted-workspace/quadruple-quotes-lsp.exe" ?? fallback,
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
  }));
  mock.module("vscode-languageclient/node", () => ({
    TransportKind: { stdio: 0 },
    LanguageClient: class {
      constructor() {
        constructed += 1;
      }
      async start() {
        started += 1;
      }
      async stop() {}
    },
  }));
  const extension = await import("../src/extension.ts?untrusted-workspace");
  const subscriptions: { dispose(): void }[] = [];
  await extension.activate({ subscriptions } as never);
  expect(constructed).toBe(0);
  expect(started).toBe(0);
  expect(subscriptions).toHaveLength(0);
});

test("activation sends a filtered dynamic configuration payload", async () => {
  let changed:
    | ((event: { affectsConfiguration(key: string): boolean }) => void)
    | undefined;
  const sent: unknown[] = [];
  mock.module("vscode", () => ({
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "rules"
            ? { typo: false }
            : key === "allowedWords"
              ? ["keep"]
              : fallback,
      }),
      onDidChangeConfiguration: (callback: typeof changed) => {
        changed = callback;
        return { dispose() {} };
      },
    },
  }));
  mock.module("vscode-languageclient/node", () => ({
    TransportKind: { stdio: 0 },
    LanguageClient: class {
      async start() {}
      async stop() {}
      async sendNotification(_method: string, payload: unknown) {
        sent.push(payload);
      }
    },
  }));
  const extension = await import("../src/extension.ts");
  const subscriptions: { dispose(): void }[] = [];
  await extension.activate({ subscriptions } as never);
  changed?.({ affectsConfiguration: (key) => key === "quadrupleQuotes.rules" });
  expect(sent).toEqual([
    {
      settings: {
        quadrupleQuotes: { rules: { typo: false }, allowedWords: ["keep"] },
      },
    },
    {
      settings: {
        quadrupleQuotes: { rules: { typo: false }, allowedWords: ["keep"] },
      },
    },
  ]);
  expect(subscriptions).toHaveLength(2);
});

test("activation catches up with the latest settings changed while start is pending", async () => {
  let releaseStart: (() => void) | undefined;
  let latestRules: Record<string, boolean> = { typo: true };
  let latestWords = ["before"];
  let changed:
    | ((event: { affectsConfiguration(key: string): boolean }) => void)
    | undefined;
  const sent: unknown[] = [];
  mock.module("vscode", () => ({
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "rules"
            ? latestRules
            : key === "allowedWords"
              ? latestWords
              : fallback,
      }),
      onDidChangeConfiguration: (callback: typeof changed) => {
        changed = callback;
        return { dispose() {} };
      },
    },
  }));
  mock.module("vscode-languageclient/node", () => ({
    TransportKind: { stdio: 0 },
    LanguageClient: class {
      start() {
        return new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
      }
      async stop() {}
      async sendNotification(_method: string, payload: unknown) {
        sent.push(payload);
      }
    },
  }));
  const extension = await import("../src/extension.ts?pending-start");
  const activation = extension.activate({ subscriptions: [] } as never);
  await Promise.resolve();
  latestRules = { typo: false };
  latestWords = ["after"];
  changed?.({ affectsConfiguration: (key) => key === "quadrupleQuotes.rules" });
  releaseStart?.();
  await activation;
  expect(sent).toEqual([
    {
      settings: {
        quadrupleQuotes: { rules: { typo: false }, allowedWords: ["after"] },
      },
    },
  ]);
});
