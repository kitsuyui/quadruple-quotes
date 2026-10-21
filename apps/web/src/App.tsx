import { useCallback, useEffect, useRef, useState } from "react";
import {
  adjacentDiagnostic,
  diagnosticKey,
} from "../../../packages/analysis/src/diagnostic-navigation";
import { trackDiagnostics } from "../../../packages/analysis/src/diagnostic-tracking";
import { applyDiagnosticFix } from "../../../packages/analysis/src/fixes";
import { allowWord, ignoreRule } from "../../../packages/analysis/src/settings";
import type {
  AnalysisResult,
  AnalysisSettings,
  DependencyAnalysisResult,
  Diagnostic,
  DiagnosticFix,
  PluginDescriptor,
  Range,
  SavedAnalysisPreset,
} from "../../../packages/analysis/src/types";
import {
  ANALYSIS_SETTINGS_KEY,
  resetAnalysisSettings,
  safelyLoadAnalysisSettings,
  saveAnalysisSettings,
} from "./analysis-settings";
import { BodyEditor } from "./BodyEditor";
import { type BodyEdit, BodyHistory } from "./body-history";
import { Confirmation } from "./Confirmation";
import type { ExceptionAction } from "./DiagnosticExceptionButtons";
import { FilesAndRecovery } from "./FilesAndRecovery";
import { Icon } from "./Icon";
import { ProofreadingPanel } from "./ProofreadingPanel";
import type { EditorHost, RecoveryEntry, TextDocument } from "./ports";
import { RECOVERY_PREFIX, recoveryDocument } from "./recovery";
import { TextActions } from "./TextActions";

type Notice = { text: string; error: boolean };
type DiagnosticDisplay = {
  documentId: string;
  analyzedRevision: number;
  revision: number;
  diagnostics: Diagnostic[];
};
type Pending =
  | { kind: "leave"; proceed(): void }
  | { kind: "delete"; document: TextDocument };
type ManualDependencyIntent = {
  kind: "dependencies" | "japanese-style";
  documentId: string;
  revision: number;
  text: string;
  format: TextDocument["format"];
  settings: AnalysisSettings;
  generation: number;
};

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
  const [proofreadingOpen, setProofreadingOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [recoveryList, setRecoveryList] = useState(() => host.recovery.list());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const activeRecovery = useRef<RecoveryEntry | null>(null);
  const recoveryBase = useRef<TextDocument | null>(draft);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );
  const [catalog, setCatalog] = useState<PluginDescriptor[]>([]);
  const [diagnosticDisplay, setDiagnosticDisplay] =
    useState<DiagnosticDisplay | null>(null);
  const [revision, setRevision] = useState(0);
  const [composing, setComposing] = useState(false);
  const [bodyHistory] = useState(() => new BodyHistory());
  const composition = useRef<{ text: string; selection: Range } | null>(null);
  const [selectionRequest, setSelectionRequest] = useState<Range | null>(null);
  const selectedIssue = useRef<string | null>(null);
  const [issueAnnouncement, setIssueAnnouncement] = useState("");
  const format = draft?.format ?? "text";
  const [manualIntent, setManualIntent] =
    useState<ManualDependencyIntent | null>(null);
  const manualIntentRef = useRef<ManualDependencyIntent | null>(manualIntent);
  const [initialAnalysisSettings] = useState(() =>
    safelyLoadAnalysisSettings(window.localStorage),
  );
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings>(
    initialAnalysisSettings.settings,
  );
  const [savedPresets, setSavedPresets] = useState(
    initialAnalysisSettings.presets,
  );
  const [analysisError, setAnalysisError] = useState(
    initialAnalysisSettings.error,
  );
  const analysisSettingsRaw = useRef(initialAnalysisSettings.raw);
  const editor = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const revisionRef = useRef(revision);
  const analysisRef = useRef(analysisResult);
  const dependencyResultRef = useRef<DependencyAnalysisResult | null>(null);
  draftRef.current = draft;
  revisionRef.current = revision;
  analysisRef.current = analysisResult;
  manualIntentRef.current = manualIntent;
  const saved = documents.find((item) => item.id === draft?.id);
  const dirty =
    draft !== null &&
    (!saved ||
      saved.title !== draft.title ||
      saved.body !== draft.body ||
      (saved.format ?? "text") !== format);

  const refreshRecovery = useCallback(() => {
    const loaded = host.recovery.list();
    setRecoveryList({
      ...loaded,
      entries: loaded.entries.filter(
        (entry) => entry.key !== activeRecovery.current?.key,
      ),
    });
  }, [host]);

  const clearRecovery = useCallback(() => {
    if (activeRecovery.current) host.recovery.remove(activeRecovery.current);
    activeRecovery.current = null;
    setRecoveryError(null);
    refreshRecovery();
  }, [host, refreshRecovery]);

  function flushRecovery() {
    const current = draftRef.current;
    if (!current) return;
    const original = documentsRef.current.find(
      (item) => item.id === current.id,
    );
    const changed =
      !original ||
      original.title !== current.title ||
      original.body !== current.body ||
      (original.format ?? "text") !== (current.format ?? "text");
    try {
      if (!changed) {
        if (activeRecovery.current) clearRecovery();
        return;
      }
      activeRecovery.current = host.recovery.write(
        {
          schemaVersion: 1,
          document: current,
          base: recoveryBase.current,
          updatedAt: host.now(),
        },
        activeRecovery.current,
      );
      setRecoveryError(null);
    } catch (failure) {
      setRecoveryError(
        `Draft recovery could not be updated. Keep this tab open or download your draft. ${errorMessage(failure)}`,
      );
    }
  }

  const flushRecoveryRef = useRef(flushRecovery);
  flushRecoveryRef.current = flushRecovery;
  useEffect(() => {
    if (!draft) return;
    const savedDocument = documents.find((item) => item.id === draft.id);
    const changed =
      !savedDocument ||
      savedDocument.title !== draft.title ||
      savedDocument.body !== draft.body ||
      (savedDocument.format ?? "text") !== (draft.format ?? "text");
    if (!changed) {
      flushRecoveryRef.current();
      return;
    }
    const timer = window.setTimeout(() => flushRecoveryRef.current(), 500);
    return () => window.clearTimeout(timer);
  }, [draft, documents]);
  useEffect(() => {
    const flush = () => flushRecoveryRef.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        (!event.key || event.key.startsWith(RECOVERY_PREFIX))
      )
        refreshRecovery();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("storage", changed);
    };
  }, [refreshRecovery]);

  const save = useCallback(() => {
    if (!draft) return true;
    try {
      const document = { ...draft, updatedAt: host.now() };
      host.repository.save(document);
      setDocuments(host.repository.list());
      documentsRef.current = host.repository.list();
      draftRef.current = document;
      recoveryBase.current = document;
      setDraft(document);
      try {
        clearRecovery();
      } catch (failure) {
        setRecoveryError(
          `Text saved, but its recovery copy was kept. ${errorMessage(failure)}`,
        );
      }
      setNotice({ text: "Text saved in this browser.", error: false });
      return true;
    } catch (error) {
      setNotice({
        text: `Could not save. Your draft is still here. ${errorMessage(error)}`,
        error: true,
      });
      return false;
    }
  }, [draft, host, clearRecovery]);

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

  useEffect(() => {
    if (!proofreadingOpen || analysisError) return;
    void host.analysis
      .catalog()
      .then(setCatalog)
      .catch((error: unknown) => setAnalysisError(errorMessage(error)));
  }, [host, proofreadingOpen, analysisError]);

  useEffect(() => () => host.analysis.dispose(), [host]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage ||
        (event.key !== ANALYSIS_SETTINGS_KEY && event.key !== null) ||
        event.newValue === analysisSettingsRaw.current
      )
        return;
      setAnalysisError(
        "Proofreading settings changed in another tab. Reload proofreading settings to use them.",
      );
      revisionRef.current += 1;
      setRevision(revisionRef.current);
      setDiagnosticDisplay(null);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  useEffect(() => {
    if (!proofreadingOpen) setManualIntent(null);
  }, [proofreadingOpen]);

  useEffect(() => {
    if (!proofreadingOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProofreadingOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [proofreadingOpen]);

  const draftId = draft?.id;
  const body = draft?.body;
  useEffect(() => {
    if (!draftId || body === undefined || composing || analysisError) return;
    const documentId = draftId;
    const expectedRevision = revision;
    const timer = window.setTimeout(() => {
      void host.analysis
        .analyze({
          documentId,
          revision: expectedRevision,
          text: body,
          format,
          settings: analysisSettings,
          manual: false,
        })
        .then((result) => {
          if (
            draftRef.current?.id === documentId &&
            revisionRef.current === expectedRevision &&
            result.documentId === documentId &&
            result.revision === expectedRevision
          ) {
            setAnalysisResult((current) => {
              const dependency = dependencyResultRef.current;
              if (
                !current ||
                current.documentId !== documentId ||
                current.revision !== expectedRevision
              )
                return dependency?.documentId === documentId &&
                  dependency.revision === expectedRevision
                  ? {
                      ...result,
                      dependencies: dependency.dependencies,
                      diagnostics: [
                        ...result.diagnostics,
                        ...dependency.diagnostics,
                      ],
                      statuses: [...result.statuses, dependency.status],
                    }
                  : result;
              const ginza = current.statuses.find(
                (status) => status.pluginId === "ginza",
              );
              return ginza
                ? {
                    ...result,
                    dependencies: current.dependencies,
                    diagnostics: [
                      ...result.diagnostics,
                      ...(dependencyResultRef.current?.diagnostics ?? []),
                    ],
                    statuses: [...result.statuses, ginza],
                  }
                : result;
            });
            const dependency = dependencyResultRef.current;
            setDiagnosticDisplay({
              documentId,
              analyzedRevision: expectedRevision,
              revision: expectedRevision,
              diagnostics:
                dependency?.documentId === documentId &&
                dependency.revision === expectedRevision
                  ? [...result.diagnostics, ...dependency.diagnostics]
                  : result.diagnostics,
            });
          }
        })
        .catch((error: unknown) => {
          if (
            draftRef.current?.id === documentId &&
            revisionRef.current === expectedRevision
          )
            setAnalysisError(errorMessage(error));
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      host.analysis.cancel();
    };
  }, [
    draftId,
    body,
    composing,
    revision,
    format,
    host,
    analysisSettings,
    analysisError,
  ]);

  useEffect(() => {
    if (
      !manualIntent ||
      !proofreadingOpen ||
      !draftId ||
      body === undefined ||
      composing ||
      analysisError
    )
      return;
    if (
      manualIntent.documentId !== draftId ||
      manualIntent.revision !== revision ||
      manualIntent.text !== body ||
      manualIntent.format !== format ||
      JSON.stringify(manualIntent.settings) !== JSON.stringify(analysisSettings)
    ) {
      setManualIntent(null);
      return;
    }
    const documentId = draftId;
    const expectedRevision = revision;
    const intentGeneration = manualIntent.generation;
    if (manualIntent.kind === "dependencies")
      void host.analysis
        .analyzeDependencies({
          documentId,
          revision: expectedRevision,
          text: manualIntent.text,
          format: manualIntent.format,
          settings: manualIntent.settings,
          manual: true,
        })
        .then((dependencyResult) => {
          if (
            draftRef.current?.id !== documentId ||
            revisionRef.current !== expectedRevision ||
            manualIntentRef.current?.generation !== intentGeneration ||
            dependencyResult.documentId !== documentId ||
            dependencyResult.revision !== expectedRevision
          )
            return;
          dependencyResultRef.current = dependencyResult;
          setDiagnosticDisplay((current) =>
            current &&
            current.documentId === documentId &&
            current.analyzedRevision === expectedRevision
              ? {
                  ...current,
                  diagnostics: [
                    ...current.diagnostics.filter(
                      (item) => item.ruleId !== "ginza.long-dependency",
                    ),
                    ...dependencyResult.diagnostics,
                  ],
                }
              : current,
          );
          setAnalysisResult((current) => {
            if (
              !current ||
              current.documentId !== documentId ||
              current.revision !== expectedRevision
            )
              return current;
            return {
              ...current,
              dependencies: dependencyResult.dependencies,
              diagnostics: [
                ...current.diagnostics.filter(
                  (item) => item.ruleId !== "ginza.long-dependency",
                ),
                ...dependencyResult.diagnostics,
              ],
              statuses: [
                ...current.statuses.filter(
                  (status) => status.pluginId !== "ginza",
                ),
                dependencyResult.status,
              ],
            };
          });
        })
        .catch((error: unknown) => {
          if (
            draftRef.current?.id === documentId &&
            revisionRef.current === expectedRevision &&
            manualIntentRef.current?.generation === intentGeneration
          )
            setAnalysisError(errorMessage(error));
        });
    if (manualIntent.kind === "japanese-style")
      void host.analysis
        .analyzeJapaneseStyle({
          documentId,
          revision: expectedRevision,
          text: manualIntent.text,
          format: manualIntent.format,
          settings: manualIntent.settings,
          manual: true,
        })
        .then((japaneseResult) => {
          if (
            draftRef.current?.id !== documentId ||
            revisionRef.current !== expectedRevision ||
            manualIntentRef.current?.generation !== intentGeneration ||
            japaneseResult.documentId !== documentId ||
            japaneseResult.revision !== expectedRevision
          )
            return;
          setAnalysisResult((current) => {
            if (
              !current ||
              current.documentId !== documentId ||
              current.revision !== expectedRevision
            )
              return current;
            return {
              ...current,
              diagnostics: [
                ...current.diagnostics.filter(
                  (item) => item.pluginId !== "textlint-ja-morphology",
                ),
                ...japaneseResult.diagnostics,
              ],
              statuses: [
                ...current.statuses.filter(
                  (status) => status.pluginId !== "textlint-ja-morphology",
                ),
                japaneseResult.status,
              ],
            };
          });
        })
        .catch((error: unknown) => {
          if (manualIntentRef.current?.generation === intentGeneration)
            setAnalysisError(errorMessage(error));
        });
  }, [
    manualIntent,
    proofreadingOpen,
    draftId,
    body,
    composing,
    revision,
    format,
    host,
    analysisSettings,
    analysisError,
  ]);

  // Focus only on selection changes; typing must preserve caret and IME state.
  useEffect(() => {
    if (draftId) titleInput.current?.focus();
  }, [draftId]);

  function transition(proceed: () => void) {
    if (dirty) setPending({ kind: "leave", proceed });
    else proceed();
  }

  function open(document: TextDocument | null) {
    activeRecovery.current = null;
    recoveryBase.current =
      host.repository.list().find((item) => item.id === document?.id) ?? null;
    bodyHistory.clear();
    composition.current = null;
    setComposing(false);
    setSelectionRequest(null);
    selectedIssue.current = null;
    setIssueAnnouncement("");
    draftRef.current = document;
    setDraft(document);
    setManualIntent(null);
    advanceRevision();
    setAnalysisResult(null);
    setDiagnosticDisplay(null);
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
        format: "text",
      });
    });
  }

  function changeView(archived: boolean) {
    transition(() => {
      setShowArchived(archived);
      open(inView(host.repository.list(), archived)[0] ?? null);
    });
  }

  function update(
    field: "title" | "body" | "format",
    value: string,
    edit?: BodyEdit,
  ) {
    const current = draftRef.current;
    if (!current || current[field] === value) return;
    if (field === "body" && edit && !composition.current)
      bodyHistory.record(current.body, value, edit);
    draftRef.current = { ...current, [field]: value } as TextDocument;
    setDraft(draftRef.current);
    if (field === "body" || field === "format") setManualIntent(null);
    if (field === "body") {
      const previousRevision = revisionRef.current;
      const nextRevision = advanceRevision();
      setIssueAnnouncement("");
      setDiagnosticDisplay((display) =>
        display?.documentId === current.id &&
        display.revision === previousRevision
          ? {
              ...display,
              revision: nextRevision,
              diagnostics: trackDiagnostics(
                current.body,
                value,
                display.diagnostics,
              ),
            }
          : null,
      );
    }
    if (field === "format") invalidateAnalysis();
    setNotice(null);
  }

  function advanceRevision() {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    return revisionRef.current;
  }

  function recheck() {
    const nextRevision = advanceRevision();
    setDiagnosticDisplay((display) =>
      display ? { ...display, revision: nextRevision } : null,
    );
  }

  function invalidateAnalysis() {
    advanceRevision();
    setDiagnosticDisplay(null);
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
        {
          before: { start, end },
          after: { start: start + text.length, end: start + text.length },
          kind: "paste",
        },
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
      if (draft?.id === document.id) {
        try {
          clearRecovery();
        } catch (failure) {
          setRecoveryError(errorMessage(failure));
        }
        open(inView(remaining, showArchived)[0] ?? null);
      }
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

  function recover(entry: RecoveryEntry) {
    const available = host.recovery
      .list()
      .entries.find((item) => item.key === entry.key);
    if (available?.raw !== entry.raw)
      throw new Error("This recovery changed. Refresh the recovery list.");
    setFilesOpen(false);
    transition(() => {
      // Recheck after an unsaved-draft confirmation, since another tab can edit meanwhile.
      const latest = host.recovery
        .list()
        .entries.find((item) => item.key === entry.key);
      if (latest?.raw !== entry.raw) {
        setNotice({
          text: "This recovery changed. Refresh the recovery list.",
          error: true,
        });
        return;
      }
      const document = recoveryDocument(
        entry.record,
        host.repository
          .list()
          .find((item) => item.id === entry.record.document.id),
        host.createId(),
      );
      setShowArchived(document.archived);
      open(document);
      activeRecovery.current = entry;
      recoveryBase.current =
        host.repository.list().find((item) => item.id === document.id) ?? null;
      refreshRecovery();
      setNotice({
        text: "Draft recovered. Save when you’re ready.",
        error: false,
      });
    });
  }

  const archivedCount = documents.filter(
    (document) => document.archived,
  ).length;
  const listed = inView(documents, showArchived);
  if (draft && !saved) listed.unshift(draft);
  const unicodeScalars = draft ? Array.from(draft.body).length : 0;
  const currentAnalysis =
    !composing &&
    !analysisError &&
    analysisResult?.documentId === draftId &&
    analysisResult?.revision === revision
      ? analysisResult
      : null;
  const displayedDiagnostics =
    !analysisError &&
    diagnosticDisplay &&
    diagnosticDisplay.documentId === draftId &&
    diagnosticDisplay.revision === revision
      ? diagnosticDisplay.diagnostics
      : [];

  function changeSettings(
    settings: AnalysisSettings,
    presets: SavedAnalysisPreset[] = savedPresets,
  ) {
    try {
      analysisSettingsRaw.current = saveAnalysisSettings(
        window.localStorage,
        settings,
        analysisSettingsRaw.current,
        presets,
      );
      const changed =
        JSON.stringify(settings) !== JSON.stringify(analysisSettings);
      setAnalysisSettings(settings);
      setSavedPresets(presets);
      setAnalysisError(null);
      if (changed) {
        setManualIntent(null);
        invalidateAnalysis();
      }
      return true;
    } catch (error) {
      setAnalysisError(errorMessage(error));
      return false;
    }
  }

  function addException(diagnostic: Diagnostic, action: ExceptionAction) {
    if (action === "allow-word" && diagnostic.ruleId !== "typos.spelling")
      return;
    const current = draftRef.current;
    const result = analysisRef.current;
    if (
      !current ||
      !result ||
      composition.current ||
      busy ||
      pending ||
      analysisError ||
      result.documentId !== current.id ||
      result.revision !== revisionRef.current ||
      !result.diagnostics.includes(diagnostic)
    )
      return;
    try {
      const settings =
        action === "allow-word" && diagnostic.ruleId === "typos.spelling"
          ? allowWord(
              analysisSettings,
              current.body.slice(diagnostic.range.start, diagnostic.range.end),
            )
          : ignoreRule(analysisSettings, current.id, diagnostic.ruleId);
      if (changeSettings(settings)) {
        setNotice({
          text:
            action === "allow-word"
              ? "Spelling word allowed in all texts. Manage it under Exceptions."
              : "Rule excluded for this document. Manage it under Exceptions.",
          error: false,
        });
        editor.current?.focus({ preventScroll: true });
      }
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    }
  }

  function selectRange(range: Range, diagnostic?: Diagnostic) {
    const current = draftRef.current;
    if (
      !current ||
      composition.current ||
      busy ||
      pending ||
      range.start < 0 ||
      range.end > current.body.length
    )
      return;
    selectedIssue.current = diagnostic ? diagnosticKey(diagnostic) : null;
    setSelectionRequest({ ...range });
    if (diagnostic) setIssueAnnouncement(diagnostic.message);
  }

  function applyFix(diagnostic: Diagnostic, fix: DiagnosticFix) {
    const current = draftRef.current;
    const result = analysisRef.current;
    if (
      !current ||
      !result ||
      composition.current ||
      busy ||
      pending ||
      analysisError ||
      !result.diagnostics.includes(diagnostic) ||
      !diagnostic.fixes?.includes(fix)
    )
      return;
    const applied = applyDiagnosticFix(
      {
        documentId: current.id,
        revision: revisionRef.current,
        text: current.body,
      },
      result,
      fix,
    );
    if (!applied) {
      setNotice({
        text: "This fix is no longer current. Wait for proofreading to finish.",
        error: true,
      });
      return;
    }
    const input = editor.current;
    update("body", applied.text, {
      before: input
        ? { start: input.selectionStart, end: input.selectionEnd }
        : diagnostic.range,
      after: applied.selection,
      kind: "fix",
    });
    selectRange(applied.selection);
    setNotice({
      text: "Fix applied to your draft. Undo to restore it; Save to keep it.",
      error: false,
    });
  }

  function moveHistory(redo: boolean) {
    const current = draftRef.current;
    if (!current || composition.current || busy || pending) return;
    const change = redo
      ? bodyHistory.redo(current.body)
      : bodyHistory.undo(current.body);
    if (!change) return;
    update("body", change.text);
    selectRange(change.selection);
  }

  function navigateIssue(direction: 1 | -1) {
    const input = editor.current;
    if (!input || composition.current || busy || pending) return;
    const diagnostic = adjacentDiagnostic(
      displayedDiagnostics,
      { start: input.selectionStart, end: input.selectionEnd },
      direction,
      selectedIssue.current,
    );
    if (diagnostic) selectRange(diagnostic.range, diagnostic);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !draftRef.current ||
        pending ||
        busy ||
        composition.current ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      if (
        event.key === "F8" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        navigateIssue(event.shiftKey ? -1 : 1);
      } else if (
        event.target === editor.current &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey)
      ) {
        const key = event.key.toLowerCase();
        if (key === "z" || (key === "y" && event.ctrlKey)) {
          event.preventDefault();
          moveHistory(key === "y" || event.shiftKey);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
          <div className="workspace-tools">
            <button
              type="button"
              disabled={busy || composing || !!pending}
              onClick={() => {
                refreshRecovery();
                setFilesOpen(true);
              }}
            >
              Files & recovery
            </button>
            {recoveryList.entries.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  refreshRecovery();
                  setFilesOpen(true);
                }}
              >
                Recover drafts ({recoveryList.entries.length})
              </button>
            )}
            <span className="local-badge">
              <span className="local-dot" />
              Local workspace
            </span>
          </div>
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
                  aria-pressed={proofreadingOpen}
                  onClick={() => setProofreadingOpen((open) => !open)}
                >
                  Proofreading
                </button>
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
              <div className="format-control">
                <label htmlFor="text-format">Format</label>
                <select
                  id="text-format"
                  value={format}
                  onChange={(event) => {
                    update("format", event.target.value);
                  }}
                >
                  <option value="text">Plain text</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>
              <fieldset
                className="proofreading-actions"
                aria-label="Editing and proofreading actions"
              >
                <div className="body-history-actions">
                  <button
                    type="button"
                    disabled={
                      !bodyHistory.canUndo || composing || busy || !!pending
                    }
                    onClick={() => moveHistory(false)}
                    aria-label="Undo body edit"
                    title="Undo (Ctrl/Cmd+Z)"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    disabled={
                      !bodyHistory.canRedo || composing || busy || !!pending
                    }
                    onClick={() => moveHistory(true)}
                    aria-label="Redo body edit"
                    title="Redo (Ctrl/Cmd+Shift+Z)"
                  >
                    Redo
                  </button>
                </div>
                <fieldset
                  className="proofreading-navigation"
                  aria-label="Navigate proofreading issues"
                >
                  <button
                    type="button"
                    disabled={
                      !displayedDiagnostics.length ||
                      composing ||
                      busy ||
                      !!pending
                    }
                    onClick={() => navigateIssue(-1)}
                    aria-keyshortcuts="Shift+F8"
                    title="Previous issue (Shift+F8)"
                  >
                    ← Previous issue
                  </button>
                  <button
                    type="button"
                    disabled={
                      !displayedDiagnostics.length ||
                      composing ||
                      busy ||
                      !!pending
                    }
                    onClick={() => navigateIssue(1)}
                    aria-keyshortcuts="F8"
                    title="Next issue (F8)"
                  >
                    Next issue →
                  </button>
                </fieldset>
              </fieldset>
              <span className="sr-only" role="status" aria-live="polite">
                {issueAnnouncement}
              </span>
              <label className="sr-only" htmlFor="text-body">
                Text body
              </label>
              <BodyEditor
                key={draft.id}
                inputRef={editor}
                value={draft.body}
                diagnostics={displayedDiagnostics}
                onException={addException}
                pending={
                  composing || diagnosticDisplay?.analyzedRevision !== revision
                }
                composing={composing}
                onChange={(value, edit) => update("body", value, edit)}
                onApply={applyFix}
                selectionRequest={selectionRequest}
                onCompositionStart={(selection) => {
                  composition.current = {
                    text: draftRef.current?.body ?? "",
                    selection,
                  };
                  setComposing(true);
                  recheck();
                }}
                onCompositionEnd={(value, selection) => {
                  update("body", value);
                  const started = composition.current;
                  if (started)
                    bodyHistory.record(started.text, value, {
                      before: started.selection,
                      after: selection,
                      kind: "composition",
                    });
                  composition.current = null;
                  setComposing(false);
                  recheck();
                }}
                disabled={busy}
              />
            </div>
            <footer className="editor-footer">
              <span>
                {unicodeScalars.toLocaleString()} Unicode scalars
                <span className="footer-dot">·</span>
                {format === "markdown" ? "Markdown" : "Plain text"}
              </span>
              <button
                type="button"
                id="inline-proofreading-summary"
                className="inline-proofreading-summary"
                onClick={() => setProofreadingOpen(true)}
                aria-label="Open proofreading issues"
              >
                {analysisError
                  ? "Proofreading unavailable"
                  : currentAnalysis
                    ? draft.body.length > 100_000
                      ? "Checks skipped: text too long"
                      : `Checks: ${currentAnalysis.diagnostics.length}${currentAnalysis.truncated ? "+" : ""} issue${currentAnalysis.diagnostics.length === 1 ? "" : "s"}`
                    : composing
                      ? "Checks paused while typing"
                      : displayedDiagnostics.length
                        ? `Checking… ${displayedDiagnostics.length} previous issue${displayedDiagnostics.length === 1 ? "" : "s"}`
                        : "Checking…"}
              </button>
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
      {recoveryError && (
        <div className="recovery-warning" role="alert">
          {recoveryError}{" "}
          <button
            type="button"
            onClick={() => {
              refreshRecovery();
              setFilesOpen(true);
            }}
          >
            Review recovery
          </button>
        </div>
      )}
      {recoveryList.errors.length > 0 && (
        <div className="recovery-warning" role="alert">
          Some recovery data could not be read and has been kept.{" "}
          <button
            type="button"
            onClick={() => {
              refreshRecovery();
              setFilesOpen(true);
            }}
          >
            Review recovery
          </button>
        </div>
      )}
      {filesOpen && (
        <FilesAndRecovery
          host={host}
          draft={draft}
          entries={recoveryList.entries}
          errors={recoveryList.errors}
          disabled={busy || composing || !!pending}
          onClose={() => setFilesOpen(false)}
          onRefresh={refreshRecovery}
          onText={(document) => {
            setFilesOpen(false);
            transition(() => {
              setShowArchived(false);
              open(document);
            });
          }}
          onWorkspace={(json, count) => {
            host.repository.importSnapshot(
              json,
              Array.from({ length: count }, () => host.createId()),
            );
            setDocuments(host.repository.list());
            setNotice({
              text: `${count} texts added. Existing texts and your draft were kept.`,
              error: false,
            });
          }}
          onRecover={recover}
          onDiscard={(entry) => {
            host.recovery.remove(entry);
            refreshRecovery();
          }}
        />
      )}
      <ProofreadingPanel
        open={proofreadingOpen}
        result={currentAnalysis}
        catalog={catalog}
        disabled={busy || composing || !!pending}
        onApply={applyFix}
        onClose={() => setProofreadingOpen(false)}
        onSelect={(start, end, diagnostic) =>
          selectRange({ start, end }, diagnostic)
        }
        settings={analysisSettings}
        presets={savedPresets}
        document={draft}
        documents={documents}
        text={draft?.body ?? ""}
        onException={addException}
        onSettings={changeSettings}
        onDependencies={() => {
          const currentDraft = draftRef.current;
          if (!currentDraft) return;
          setManualIntent((current) => ({
            kind: "dependencies",
            documentId: currentDraft.id,
            revision: revisionRef.current,
            text: currentDraft.body,
            format: currentDraft.format ?? "text",
            settings: analysisSettings,
            generation: (current?.generation ?? 0) + 1,
          }));
        }}
        onJapaneseStyle={() => {
          const currentDraft = draftRef.current;
          if (!currentDraft) return;
          setManualIntent((current) => ({
            kind: "japanese-style",
            documentId: currentDraft.id,
            revision: revisionRef.current,
            text: currentDraft.body,
            format: currentDraft.format ?? "text",
            settings: analysisSettings,
            generation: (current?.generation ?? 0) + 1,
          }));
        }}
      />
      {analysisError && (
        <div className="notice notice-error" role="alert">
          Proofreading is disabled: {analysisError}{" "}
          <button
            type="button"
            onClick={() => {
              const loaded = safelyLoadAnalysisSettings(window.localStorage);
              analysisSettingsRaw.current = loaded.raw;
              setAnalysisSettings(loaded.settings);
              setSavedPresets(loaded.presets);
              setAnalysisError(loaded.error);
              setManualIntent(null);
              invalidateAnalysis();
            }}
          >
            Reload proofreading settings
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              try {
                const settings = resetAnalysisSettings(
                  window.localStorage,
                  analysisSettingsRaw.current,
                );
                analysisSettingsRaw.current = window.localStorage.getItem(
                  "quadruple-quotes.proofreading-settings.v1",
                );
                setAnalysisSettings(settings);
                setSavedPresets([]);
                setManualIntent(null);
                setAnalysisError(null);
                invalidateAnalysis();
              } catch (error) {
                setAnalysisError(errorMessage(error));
              }
            }}
          >
            Reset proofreading settings
          </button>
        </div>
      )}
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
              try {
                clearRecovery();
                pending.proceed();
                setPending(null);
              } catch (failure) {
                setNotice({
                  text: `Could not discard recovery. Your draft is still here. ${errorMessage(failure)}`,
                  error: true,
                });
              }
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
