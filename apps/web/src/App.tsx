import { useCallback, useEffect, useRef, useState } from "react";
import { Confirmation } from "./Confirmation";
import { Icon } from "./Icon";
import type { EditorHost, TextDocument } from "./ports";

type Notice = { text: string; error: boolean };
type Pending = { kind: "leave"; proceed(): void } | { kind: "delete" };

function displayTitle(document: TextDocument) {
  return document.title.trim() || "Untitled text";
}

function savedDate(timestamp: number) {
  if (!Number.isFinite(new Date(timestamp).getTime())) return "Saved text";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function App({ host }: { host: EditorHost }) {
  const [documents, setDocuments] = useState(() => host.repository.list());
  const [draft, setDraft] = useState<TextDocument | null>(
    () =>
      [...host.repository.list()].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )[0] ?? null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saved = documents.find((item) => item.id === draft?.id);
  const dirty =
    draft !== null &&
    (!saved || saved.title !== draft.title || saved.body !== draft.body);

  const save = useCallback(() => {
    if (!draft) return true;
    try {
      const document = { ...draft, updatedAt: host.now() };
      host.repository.save(document);
      setDocuments(host.repository.list());
      setDraft(document);
      setNotice({ text: "Text saved in this browser.", error: false });
      return true;
    } catch (error) {
      setNotice({
        text: `Could not save. Your draft is still here. ${errorMessage(error)}`,
        error: true,
      });
      return false;
    }
  }, [draft, host]);

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty && !pending && !busy) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, pending, busy, save]);

  // Focus only on selection changes; typing must preserve caret and IME state.
  const draftId = draft?.id;
  useEffect(() => {
    if (draftId) titleInput.current?.focus();
  }, [draftId]);

  function transition(proceed: () => void) {
    if (dirty) setPending({ kind: "leave", proceed });
    else proceed();
  }

  function open(document: TextDocument | null) {
    setDraft(document);
    setNotice(null);
    setSidebarOpen(false);
  }

  function newText() {
    transition(() =>
      open({ id: host.createId(), title: "", body: "", updatedAt: host.now() }),
    );
  }

  function update(field: "title" | "body", value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : null));
    setNotice(null);
  }

  async function copy() {
    if (!draft) return;
    setBusy(true);
    try {
      await host.clipboard.writeText(draft.body);
      setNotice({ text: "Text copied to clipboard.", error: false });
    } catch {
      setNotice({
        text: "Clipboard access was unavailable. Select the text and use your usual copy shortcut.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    if (!draft || !editor.current) return;
    const id = draft.id;
    const { selectionStart: start, selectionEnd: end } = editor.current;
    setBusy(true);
    try {
      const text = await host.clipboard.readText();
      const current = draftRef.current;
      if (!current || current.id !== id) return;
      update(
        "body",
        current.body.slice(0, start) + text + current.body.slice(end),
      );
      requestAnimationFrame(() => {
        editor.current?.focus();
        editor.current?.setSelectionRange(
          start + text.length,
          start + text.length,
        );
      });
      setNotice({ text: "Text pasted. Save when you’re ready.", error: false });
    } catch {
      setNotice({
        text: "Clipboard access was unavailable. Click the editor and use your usual paste shortcut.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!draft) return;
    try {
      if (saved) host.repository.delete(draft.id);
      const remaining = host.repository.list();
      setDocuments(remaining);
      setPending(null);
      open(remaining.at(-1) ?? null);
      setNotice({ text: "Text deleted.", error: false });
    } catch (error) {
      setPending(null);
      setNotice({
        text: `Could not delete. Your text is still here. ${errorMessage(error)}`,
        error: true,
      });
    }
  }

  const listed = [...documents].sort((a, b) => b.updatedAt - a.updatedAt);
  if (draft && !saved) listed.unshift(draft);
  const characters = draft ? Array.from(draft.body).length : 0;

  return (
    <div className="workspace">
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close text list"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="Text library"
      >
        <button
          type="button"
          className="brand"
          onClick={() => {
            transition(() => open(null));
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            “<span>“</span>
          </span>
          <span>
            quadruple<span className="brand-second">quotes</span>
          </span>
        </button>
        <button
          type="button"
          className="new-text"
          disabled={busy}
          onClick={newText}
        >
          <Icon name="plus" />
          New text<span className="button-hint">↗</span>
        </button>
        <div className="library-heading">
          <span className="eyebrow">YOUR TEXTS</span>
          <span className="count">{documents.length}</span>
        </div>
        <nav className="text-list" aria-label="Your texts">
          {listed.map((document) => {
            const selected = document.id === draft?.id;
            const visible = selected && draft ? draft : document;
            return (
              <button
                type="button"
                key={document.id}
                className={`text-item ${selected ? "selected" : ""}`}
                disabled={busy}
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  if (!selected) transition(() => open(document));
                  else setSidebarOpen(false);
                }}
              >
                <span className="text-item-icon">
                  <Icon name="text" />
                </span>
                <span className="text-item-content">
                  <span className="text-item-title">
                    {displayTitle(visible)}
                  </span>
                  <span className="text-item-excerpt">
                    {visible.body.trim() || "An open space for your words"}
                  </span>
                  <span className="text-item-date">
                    {selected && dirty
                      ? "Unsaved draft"
                      : savedDate(document.updatedAt)}
                  </span>
                </span>
                {selected && dirty && (
                  <span className="dirty-dot" title="Unsaved changes" />
                )}
              </button>
            );
          })}
          {!listed.length && (
            <div className="library-empty">
              <Icon name="text" />
              <p>Your texts will live here.</p>
              <span>A thought, a draft, a little of anything.</span>
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <span className="workspace-avatar">qq</span>
          <div>
            <strong>Personal workspace</strong>
            <span>Saved in this browser</span>
          </div>
          <span className="local-dot" />
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              type="button"
              className="mobile-menu icon-button"
              aria-label="Open text list"
              onClick={() => setSidebarOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>Texts</strong>
          </div>
          <span className="local-badge">
            <span className="local-dot" />
            Local workspace
          </span>
        </header>
        {draft ? (
          <>
            <div className="editor-toolbar">
              <div className="document-state">
                {dirty ? (
                  <>
                    <span className="dirty-dot" />
                    Unsaved changes
                  </>
                ) : (
                  <>
                    <Icon name="check" />
                    All changes saved
                  </>
                )}
              </div>
              <div className="toolbar-actions">
                <button
                  type="button"
                  aria-label="Copy"
                  onClick={copy}
                  disabled={busy || !draft.body}
                >
                  <Icon name="copy" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  aria-label="Paste"
                  onClick={paste}
                  disabled={busy}
                >
                  <Icon name="paste" />
                  <span>Paste</span>
                </button>
                <span className="toolbar-divider" />
                <button
                  type="button"
                  className="primary"
                  onClick={save}
                  disabled={!dirty || busy}
                >
                  <Icon name="save" />
                  Save
                </button>
              </div>
            </div>
            <div className="editor-page">
              <div className="page-kicker">
                <span className="eyebrow">
                  TEXT{" "}
                  {String(
                    Math.max(
                      1,
                      listed.findIndex((item) => item.id === draft.id) + 1,
                    ),
                  ).padStart(2, "0")}
                </span>
                <span className="page-rule" />
              </div>
              <label className="sr-only" htmlFor="text-title">
                Text title
              </label>
              <input
                id="text-title"
                ref={titleInput}
                className="title-input"
                value={draft.title}
                placeholder="Untitled text"
                onChange={(event) => update("title", event.target.value)}
                disabled={busy}
                autoComplete="off"
              />
              <div className="editor-hint">
                A space to think. Make it yours.
              </div>
              <label className="sr-only" htmlFor="text-body">
                Text body
              </label>
              <textarea
                id="text-body"
                ref={editor}
                className="body-input"
                value={draft.body}
                placeholder="Start writing, or paste something you’d like to keep…"
                onChange={(event) => update("body", event.target.value)}
                disabled={busy}
                spellCheck={false}
              />
            </div>
            <footer className="editor-footer">
              <span>
                {characters.toLocaleString()} characters
                <span className="footer-dot">·</span>Plain text
              </span>
              <button
                type="button"
                className="delete-button"
                onClick={() => setPending({ kind: "delete" })}
                disabled={busy}
              >
                <Icon name="trash" />
                Delete text
              </button>
            </footer>
          </>
        ) : (
          <div className="empty-main">
            <div className="empty-art" aria-hidden="true">
              <span>“</span>
              <span>“</span>
              <div className="art-line" />
              <div className="art-line short" />
            </div>
            <span className="eyebrow">ROOM FOR YOUR WORDS</span>
            <h1>A thought starts here.</h1>
            <p>
              Collect your notes, drafts, and fragments.
              <br />A quiet place to write, one text at a time.
            </p>
            <button
              type="button"
              className="primary start-button"
              onClick={newText}
            >
              Create your first text
              <Icon name="arrow" />
            </button>
            <div className="empty-note">
              Your texts stay in this browser. You’re in control.
            </div>
          </div>
        )}
        <div
          className={`notice ${notice?.error ? "notice-error" : ""}`}
          role={notice?.error ? "alert" : "status"}
          aria-live="polite"
        >
          {notice?.text}
        </div>
      </main>
      {pending && (
        <Confirmation
          kind={pending.kind}
          title={draft ? displayTitle(draft) : ""}
          onCancel={() => setPending(null)}
          onDiscard={() => {
            if (pending.kind === "delete") remove();
            else {
              pending.proceed();
              setPending(null);
            }
          }}
          onSave={() => {
            if (pending.kind === "leave" && save()) {
              pending.proceed();
              setPending(null);
            }
          }}
        />
      )}
    </div>
  );
}
