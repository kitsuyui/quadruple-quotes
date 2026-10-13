import type { FilePort } from "./ports";

export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024;

export const browserFiles: FilePort = {
  async read(file, maxBytes) {
    if (file.size > maxBytes)
      throw new Error("The file exceeds the import size limit.");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > maxBytes)
      throw new Error("The file exceeds the import size limit.");
    try {
      // Keep a UTF-8 BOM as text, rather than silently dropping an input character.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw new Error(
        "This file is not valid UTF-8. Export it as UTF-8 and try again.",
      );
    }
  },
  download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};

export function textFilename(title: string, format: "text" | "markdown") {
  const stem = title
    .trim()
    .replace(/[\p{C}<>:"/\\|?*]/gu, "_")
    .replace(/[. ]+$/u, "")
    .slice(0, 100);
  return `${stem || "Untitled text"}.${format === "markdown" ? "md" : "txt"}`;
}
