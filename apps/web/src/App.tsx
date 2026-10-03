import { useCallback, useEffect, useRef, useState } from "react";
import { Confirmation } from "./Confirmation";
import { Icon } from "./Icon";
import type { EditorHost, TextDocument } from "./ports";
import { TextActions } from "./TextActions";

type Notice = { text: string; error: boolean };
type Pending =
  | { kind: "leave"; proceed(): void }
  | { kind: "delete"; document: TextDocument };

function inView(documents: TextDocument[], archived: boolean) {
  return documents
    .filter((document) => document.archived === archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

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
    () => inView(host.repository.list(), false)[0] ?? null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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
    transition(() => {
      setShowArchived(false);
      open({
        id: host.createId(),
        title: "",
        body: "",
        updatedAt: host.now(),
        archived: false,
      });
    });
  }

  function changeView(archived: boolean) {
    transition(() => {
      setShowArchived(archived);
      open(inView(host.repository.list(), archived)[0] ?? null);
    });
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

  function remove(document: TextDocument) {
    try {
      if (documents.some((item) => item.id === document.id))
        host.repository.delete(document.id);
      const remaining = host.repository.list();
      setDocuments(remaining);
      setPending(null);
      if (draft?.id === document.id)
        open(inView(remaining, showArchived)[0] ?? null);
      setNotice({ text: "Text deleted.", error: false });
    } catch (error) {
      setPending(null);
      setNotice({
        text: `Could not delete. Your text is still here. ${errorMessage(error)}`,
        error: true,
      });
    }
  }

  function archive(id: string, archived: boolean) {
    try {
      host.repository.setArchived(id, archived);
      const next = host.repository.list();
      setDocuments(next);
      if (draft?.id === id) open(inView(next, showArchived)[0] ?? null);
      setNotice({
        text: archived
          ? "Text archived. Find it in Archived texts."
          : "Text restored to your texts.",
        error: false,
      });
    } catch (error) {
      setNotice({
        text: `Could not ${archived ? "archive" : "restore"}. Your text is still here. ${errorMessage(error)}`,
        error: true,
      });
    }
  }

  function requestArchive(document: TextDocument) {
    setNotice(null);
    const proceed = () => archive(document.id, !document.archived);
    if (document.id === draft?.id && dirty) transition(proceed);
    else proceed();
  }

  function requestDelete(document: TextDocument) {
    setNotice(null);
    setPending({ kind: "delete", document });
  }

  function duplicate(id: string) {
    try {
      const copy = host.repository.duplicate(id, host.createId(), host.now());
      setDocuments(host.repository.list());
      setShowArchived(false);
      open(copy);
      setNotice({
        text: "Text duplicated. You’re editing the copy.",
        error: false,
      });
    } catch (error) {
      setNotice({
        text: `Could not duplicate. Your text and draft are still here. ${errorMessage(error)}`,
        error: true,
      });
    }
  }

  function requestDuplicate(document: TextDocument) {
    setNotice(null);
    transition(() => duplicate(document.id));
  }

  const archivedCount = documents.filter(
    (document) => document.archived,
  ).length;
  const listed = inView(documents, showArchived);
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
            transition(() => {
              setShowArchived(false);
              open(null);
            });
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
          New text
          <span className="button-hint" aria-hidden="true">
            ↗
          </span>
        </button>
        <div className="library-heading">
          <span className="eyebrow">
            {showArchived ? "ARCHIVED TEXTS" : "YOUR TEXTS"}
          </span>
          <span className="count">
            {showArchived ? archivedCount : documents.length - archivedCount}
          </span>
        </div>
        <nav
          className="text-list"
          aria-label={showArchived ? "Archived texts" : "Your texts"}
        >
          {listed.map((document) => {
            const selected = document.id === draft?.id;
            const visible = selected && draft ? draft : document;
            return (
              <div
                key={document.id}
                className={`text-row ${selected ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className="text-item"
                  aria-label={`Open ${displayTitle(visible)}`}
                  disabled={busy}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => {
                    if (!selected) transition(() => open(document));
                    else setSidebarOpen(false);
                  }}
                >
                  <span className="text-item-icon">
                    <Icon name={document.archived ? "archive" : "text"} />
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
                <TextActions
                  title={displayTitle(visible)}
                  archived={document.archived}
                  saved={documents.some((item) => item.id === document.id)}
                  disabled={busy}
                  onDuplicate={() => requestDuplicate(document)}
                  onArchive={() => requestArchive(document)}
                  onDelete={() => requestDelete(visible)}
                />
              </div>
            );
          })}
          {!listed.length && (
            <div className="library-empty">
              <Icon name="text" />
              <p>
                {showArchived
                  ? "No archived texts yet."
                  : "Your texts will live here."}
              </p>
              <span>
                {showArchived
                  ? "Finished for now. Kept for later."
                  : "A thought, a draft, a little of anything."}
              </span>
            </div>
          )}
        </nav>
        <button
          type="button"
          className={`archive-view ${showArchived ? "active" : ""}`}
          aria-label={showArchived ? "Back to texts" : "Archived texts"}
          disabled={busy}
          onClick={() => changeView(!showArchived)}
        >
          <Icon name={showArchived ? "text" : "archive"} />
          {showArchived ? "Back to texts" : "Archived texts"}
          <span className="count">
            {showArchived ? documents.length - archivedCount : archivedCount}
          </span>
        </button>
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
            <strong>{showArchived ? "Archive" : "Texts"}</strong>
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
                  {draft.archived ? "ARCHIVED TEXT" : "TEXT"}{" "}
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
                onClick={() => requestDelete(draft)}
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
            <span className="eyebrow">
              {showArchived ? "KEPT FOR LATER" : "ROOM FOR YOUR WORDS"}
            </span>
            <h1>
              {showArchived
                ? "A home for finished thoughts."
                : "A thought starts here."}
            </h1>
            <p>
              {showArchived ? (
                <>
                  Archive a text from its sidebar menu.
                  <br />
                  It stays here until you need it again.
                </>
              ) : (
                <>
                  Collect your notes, drafts, and fragments.
                  <br />A quiet place to write, one text at a time.
                </>
              )}
            </p>
            <button
              type="button"
              className="primary start-button"
              onClick={() => {
                if (showArchived) changeView(false);
                else newText();
              }}
            >
              {showArchived
                ? "Back to texts"
                : documents.length
                  ? "Create a text"
                  : "Create your first text"}
              <Icon name="arrow" />
            </button>
            <div className="empty-note">
              Your texts stay in this browser. You’re in control.
            </div>
          </div>
        )}
        <div
          className={`notice ${notice?.error ? "notice-error" : ""}`}
          role={notice?.error && !pending ? "alert" : "status"}
          aria-live="polite"
        >
          {pending ? null : notice?.text}
        </div>
      </main>
      {pending && (
        <Confirmation
          kind={pending.kind}
          title={
            pending.kind === "delete" ? displayTitle(pending.document) : ""
          }
          discardChanges={
            pending.kind === "delete" &&
            pending.document.id === draft?.id &&
            dirty
          }
          error={notice?.error ? notice.text : undefined}
          onCancel={() => setPending(null)}
          onDiscard={() => {
            if (pending.kind === "delete") remove(pending.document);
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
