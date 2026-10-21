import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
export function configuredServerPath(): string {
  const value = vscode.workspace
    .getConfiguration("quadrupleQuotes")
    .get<string>("serverPath", "quadruple-quotes-lsp");
  return vscode.workspace.isTrusted ? value : "quadruple-quotes-lsp";
}
export function initialSettings(): {
  quadrupleQuotes: { rules: Record<string, boolean>; allowedWords: string[] };
} {
  const c = vscode.workspace.getConfiguration("quadrupleQuotes");
  return {
    quadrupleQuotes: {
      rules: c.get<Record<string, boolean>>("rules", {}),
      allowedWords: c.get<string[]>("allowedWords", []),
    },
  };
}
export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) {
    return;
  }
  const serverOptions: ServerOptions = {
    command: configuredServerPath(),
    transport: TransportKind.stdio,
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "plaintext" },
      { scheme: "file", language: "markdown" },
    ],
    initializationOptions: initialSettings(),
  };
  client = new LanguageClient(
    "quadrupleQuotes",
    "Quadruple Quotes",
    serverOptions,
    clientOptions,
  );
  await client.start();
  const listener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("quadrupleQuotes.rules") ||
      event.affectsConfiguration("quadrupleQuotes.allowedWords")
    ) {
      void client?.sendNotification("workspace/didChangeConfiguration", {
        settings: initialSettings(),
      });
    }
  });
  context.subscriptions.push(listener, { dispose: () => void client?.stop() });
  await client.sendNotification("workspace/didChangeConfiguration", {
    settings: initialSettings(),
  });
}
export async function deactivate() {
  await client?.stop();
}
