import { useEffect, useRef, useState } from "react";
import {
  MAX_TEXT_FILE_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  textFilename,
} from "./browser-files";
import type { EditorHost, RecoveryEntry, TextDocument } from "./ports";

type ImportPreview =
  | { kind: "text"; document: TextDocument; name: string }
  | {
      kind: "workspace";
      json: string;
      documents: TextDocument[];
      name: string;
    };

export function FilesAndRecovery({
  host,
  draft,
  entries,
  errors,
  disabled,
  onClose,
  onText,
  onWorkspace,
  onRecover,
  onDiscard,
  onRefresh,
}: {
  host: EditorHost;
  draft: TextDocument | null;
  entries: RecoveryEntry[];
  errors: string[];
  disabled: boolean;
  onClose(): void;
  onText(document: TextDocument): void;
  onWorkspace(json: string, count: number): void;
  onRecover(entry: RecoveryEntry): void;
  onDiscard(entry: RecoveryEntry): void;
  onRefresh(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const readToken = useRef(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [discard, setDiscard] = useState<RecoveryEntry | null>(null);
  useEffect(() => {
    live.current = true;
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      live.current = false;
      readToken.current += 1;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  function action(run: () => void) {
    try {
      run();
      setError(null);
    } catch (failure) {
      setError(String(failure instanceof Error ? failure.message : failure));
    }
  }

  async function read(file: File) {
    const token = ++readToken.current;
    setReading(true);
    setError(null);
    setPreview(null);
    try {
      const extension = file.name.toLowerCase().split(".").at(-1);
      if (!["txt", "md", "json"].includes(extension ?? ""))
        throw new Error("Choose a .txt, .md, or workspace .json file.");
      const text = await host.files.read(
        file,
        extension === "json" ? MAX_WORKSPACE_FILE_BYTES : MAX_TEXT_FILE_BYTES,
      );
      if (!live.current || token !== readToken.current) return;
      if (extension === "json") {
        setPreview({
          kind: "workspace",
          json: text,
          documents: host.repository.inspectImport(text),
          name: file.name,
        });
      } else {
        setPreview({
          kind: "text",
          name: file.name,
          document: {
            id: host.createId(),
            title: file.name.replace(/\.(txt|md)$/i, ""),
            body: text,
            updatedAt: host.now(),
            archived: false,
            format: extension === "md" ? "markdown" : "text",
          },
        });
      }
    } catch (failure) {
      if (live.current && token === readToken.current)
        setError(String(failure instanceof Error ? failure.message : failure));
    } finally {
      if (live.current && token === readToken.current) setReading(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirmation files-dialog"
      aria-labelledby="files-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!reading && !disabled) onClose();
      }}
    >
      <header className="files-header">
        <h2 id="files-heading">Files and recovery</h2>
        <button
          type="button"
          aria-label="Close files and recovery"
          disabled={reading || disabled}
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <section aria-labelledby="export-heading">
        <h3 id="export-heading">Take your texts with you</h3>
        <p>
          Download the current draft as UTF-8 .txt or .md. A workspace JSON
          contains saved texts, including formats and archived texts.
          Proofreading settings and recovery drafts stay separate.
        </p>
        <div className="file-actions">
          <button
            type="button"
            disabled={!draft || disabled}
            onClick={() =>
              action(() => {
                if (draft)
                  host.files.download(
                    textFilename(draft.title, draft.format ?? "text"),
                    draft.body,
                    "text/plain;charset=utf-8",
                  );
              })
            }
          >
            Download current text
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              action(() =>
                host.files.download(
                  "quadruple-quotes-workspace.json",
                  host.repository.snapshot(),
                  "application/json",
                ),
              )
            }
          >
            Download workspace JSON
          </button>
        </div>
      </section>
      <section aria-labelledby="import-heading">
        <h3 id="import-heading">Import a file</h3>
        <p>
          Text files open as unsaved drafts. Workspace imports add independent
          copies and keep all existing texts. Limits: 5 MiB per text file; 10
          MiB and 1,000 texts per workspace.
        </p>
        <label className="file-picker">
          Import file
          <input
            type="file"
            accept=".txt,.md,.json"
            disabled={reading || disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file);
            }}
          />
        </label>
        {reading && <p role="status">Reading file…</p>}
        {preview && (
          <div className="import-preview">
            <strong>{preview.name}</strong>
            <p>
              {preview.kind === "text"
                ? `${preview.document.body.length.toLocaleString()} UTF-16 units · ${preview.document.format === "markdown" ? "Markdown" : "Plain text"}`
                : `${preview.documents.length} saved text${preview.documents.length === 1 ? "" : "s"} · ${preview.documents.filter((d) => d.archived).length} archived`}
            </p>
            <button
              type="button"
              className="primary"
              disabled={
                disabled ||
                (preview.kind === "workspace" && !preview.documents.length)
              }
              onClick={() =>
                action(() => {
                  if (preview.kind === "text") onText(preview.document);
                  else {
                    onWorkspace(preview.json, preview.documents.length);
                    setPreview(null);
                  }
                })
              }
            >
              {preview.kind === "text"
                ? "Open as unsaved text"
                : `Add ${preview.documents.length} texts`}
            </button>
            <button type="button" onClick={() => setPreview(null)}>
              Cancel import
            </button>
          </div>
        )}
      </section>
      <section aria-labelledby="recovery-heading">
        <div className="files-section-header">
          <h3 id="recovery-heading">Recover unsaved drafts</h3>
          <button type="button" onClick={onRefresh}>
            Refresh recovery list
          </button>
        </div>
        <p>
          Recovery copies never update saved texts. Recover to continue editing,
          then Save explicitly. If the saved text changed or disappeared,
          recovery opens a new copy. Undo history starts fresh.
        </p>
        {!entries.length && <p>No recovery drafts to review.</p>}
        <ul className="recovery-list">
          {entries.map((entry) => {
            const title = entry.record.document.title || "Untitled text";
            return (
              <li key={entry.key}>
                <strong>{title}</strong>
                <span>{new Date(entry.record.updatedAt).toLocaleString()}</span>
                <div className="file-actions">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => action(() => onRecover(entry))}
                  >
                    Recover {title}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setDiscard(entry)}
                  >
                    Discard recovery for {title}
                  </button>
                </div>
                {discard?.key === entry.key && (
                  <fieldset
                    className="recovery-discard"
                    aria-label={`Confirm discard recovery for ${title}`}
                  >
                    <p>
                      Discard this recovery copy? The saved text will remain
                      unchanged.
                    </p>
                    <button type="button" onClick={() => setDiscard(null)}>
                      Keep recovery
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() =>
                        action(() => {
                          onDiscard(entry);
                          setDiscard(null);
                        })
                      }
                    >
                      Confirm discard recovery
                    </button>
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
        {errors.map((message) => (
          <p key={message} role="alert">
            {message}
          </p>
        ))}
        <button
          type="button"
          onClick={() =>
            action(() =>
              host.files.download(
                "quadruple-quotes-recovery-raw.json",
                host.recovery.rawBackup(),
                "application/json",
              ),
            )
          }
        >
          Download raw recovery data
        </button>
      </section>
      {error && (
        <p className="confirmation-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
