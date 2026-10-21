import type {
  AnalysisPort,
  AnalysisRequest,
  DependencyAnalysisResult,
  JapaneseStyleAnalysisResult,
  PluginDescriptor,
} from "../../../packages/analysis/src/types";
import type { ClipboardPort, EditorHost, FilePort, FileSource } from "./ports";

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type NativeFile = { name: string; bytes: number[] };

export function isDesktopRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function desktopFiles(invoke: Invoke): FilePort {
  return {
    async read(file, maxBytes) {
      if (file.size > maxBytes)
        throw new Error("The file exceeds the import size limit.");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > maxBytes)
        throw new Error("The file exceeds the import size limit.");
      try {
        return new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw new Error(
          "This file is not valid UTF-8. Export it as UTF-8 and try again.",
        );
      }
    },
    async download(name, text, mime) {
      await invoke("save_file", { name, text, mime }).catch((error) => {
        throw new Error(`Could not save the file: ${errorMessage(error)}`);
      });
    },
    async pick() {
      const selected = (await invoke("pick_file").catch((error) => {
        throw new Error(`Could not open the file: ${errorMessage(error)}`);
      })) as NativeFile | null;
      if (!selected) return null;
      const bytes = Uint8Array.from(selected.bytes);
      const source: FileSource = {
        name: selected.name,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.slice().buffer,
      };
      return source;
    },
  };
}

export function desktopClipboard(invoke: Invoke): ClipboardPort {
  return {
    async readText() {
      return (await invoke("read_clipboard").catch((error) => {
        throw new Error(`Could not read the clipboard: ${errorMessage(error)}`);
      })) as string;
    },
    async writeText(text) {
      await invoke("write_clipboard", { text }).catch((error) => {
        throw new Error(
          `Could not write the clipboard: ${errorMessage(error)}`,
        );
      });
    },
  };
}

const DESKTOP_MANUAL_UNAVAILABLE =
  "Unavailable in the desktop app. This local helper is not bundled with the native host.";

function desktopCatalog(catalog: PluginDescriptor[]) {
  return catalog.map((plugin) =>
    plugin.id === "ginza" || plugin.id === "textlint-ja-morphology"
      ? {
          ...plugin,
          defaultEnabled: false,
          description: `${plugin.description} ${DESKTOP_MANUAL_UNAVAILABLE}`,
        }
      : plugin,
  );
}

/** The desktop host keeps browser-safe core/WASM and adapter lanes local, while
 * explicitly declining the two helpers that require a separately served native process. */
export function desktopAnalysis(analysis: AnalysisPort): AnalysisPort {
  const unavailable = (request: AnalysisRequest, pluginId: string) => ({
    documentId: request.documentId,
    revision: request.revision,
    status: {
      pluginId,
      status: "disabled" as const,
      message: DESKTOP_MANUAL_UNAVAILABLE,
    },
  });
  return {
    catalog: async () => desktopCatalog(await analysis.catalog()),
    analyze: (request) => analysis.analyze(request),
    analyzeDependencies: async (
      request,
    ): Promise<DependencyAnalysisResult> => ({
      ...unavailable(request, "ginza"),
      dependencies: [],
      diagnostics: [],
    }),
    analyzeJapaneseStyle: async (
      request,
    ): Promise<JapaneseStyleAnalysisResult> => ({
      ...unavailable(request, "textlint-ja-morphology"),
      diagnostics: [],
    }),
    cancel: () => analysis.cancel(),
    dispose: () => analysis.dispose(),
  };
}

export async function createDesktopHost(): Promise<EditorHost> {
  const { createBrowserHost } = await import("./browser-host");
  const browserHost = await createBrowserHost();
  // This import remains inside the desktop-only factory so ordinary browsers never
  // evaluate Tauri bindings.
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    ...browserHost,
    analysis: desktopAnalysis(browserHost.analysis),
    files: desktopFiles(invoke),
    clipboard: desktopClipboard(invoke),
  };
}
