# Architecture

Quadruple Quotes is a text management and proofreading tool. It provides local document management and opt-in proofreading. All components live in this repository.

```text
React editor → EditorHost ports → browser adapter → WASM transport → Rust core
                                     ↓
                               browser storage
```

| Component | Responsibility | Status |
| --- | --- | --- |
| `crates/core` | Documents, save/duplicate/archive/delete rules, validation, versioned snapshots | Implemented |
| `crates/wasm` | Thin JSON transport to the same core | Implemented |
| `apps/web` | Editor, sidebar, draft lifecycle, browser storage, clipboard, and analysis worker | Implemented |
| Proofreading plugins | Rust analysis, bundled Markdown/textlint rules, and opt-in local dependency analysis | Implemented |
| LSP | Native core adapter for document synchronization, core text-health and typos diagnostics, and explicit typo quick fixes | Implemented; JavaScript adapters and hover are unavailable |
| VSCode extension | LSP client and editor integration | Implemented for the supported LSP surface |
| Desktop | Reuse the React editor with a Tauri host adapter | Implemented baseline; user-mediated file and clipboard commands only |

## Dependency direction

The core accepts document IDs and timestamps from its host, holds documents in memory, and reads/writes a versioned JSON snapshot. Its analysis uses Unicode and spelling libraries, with no IO or platform clock. A native LSP or desktop host can use this crate without WebAssembly or React.

The WASM crate translates errors and JSON across the browser boundary. It delegates mutations and snapshot validation to the core. No text management behavior is implemented a second time in TypeScript.

The React editor depends on `EditorHost`, not the browser adapter. `TextRepository`, `ClipboardPort`, `FilePort`, `RecoveryPort`, ID creation, and the clock are replaceable host capabilities. The Tauri adapter reuses browser storage and exposes only user-mediated native file selection, save dialogs, and clipboard commands. It has no arbitrary filesystem, shell, process, remote-navigation, or native-analysis capability.

## Persistence and drafts

The browser stores one snapshot under the stable key `quadruple-quotes.workspace.v1` in localStorage. Snapshot version 2 adds an `archived` boolean, and version 3 adds per-document `format` (`text` or `markdown`). The Rust core reads versions 1 and 2 with defaults (`archived: false`, `format: text`) and exports version 3; legacy storage is only rewritten after a successful mutation. Older builds reject the new version rather than interpreting it as empty data.

A draft changes the saved workspace only through Save (or Cmd/Ctrl+S). A separate recovery copy captures title, body and format without changing that snapshot. Navigation asks whether to save, discard, or cancel; closing/reloading with edits uses the browser's beforeunload prompt. Deletion requires confirmation naming the target. Each sidebar row has separate open and action controls, so a command targets that row even while another document has unsaved edits.

Archive and restore are core mutations that only change the archive flag, keeping body, title, ID, and edit timestamp intact. The UI filters active/archived lists, and protects unsaved edits before archiving or restoring the current text. A new unsaved draft must be saved before archive is enabled. Archived texts remain editable and deletable. Removing another text does not discard the current draft.

Duplicate is a core mutation that copies a saved text's exact body into a new ID supplied by the host, adds “(copy)” to its title (using “Untitled text” for blank titles), and sets a new host timestamp. The copy is active even when the source is archived. Existing IDs are rejected rather than replaced. The UI opens the persisted copy for editing, asking whether to save, discard, or cancel any current draft first. Saving that draft updates the source before copying if it is the source; discarding copies its last saved contents. A new unsaved text must be saved before duplication is enabled.

The browser adapter creates a candidate core workspace, performs the mutation, persists its snapshot, and only then replaces the active core. Quota/permission failures leave both the saved documents and draft available. Invalid or unsupported snapshots are rejected without clearing storage. Each mutation compares the loaded snapshot with current storage to reject stale tabs. This is a best-effort conflict check, not a transactional multi-writer store; collaborative editing remains out of scope.

Saving is local to the current browser profile and origin. It is not a file download or cloud backup; clearing browser data removes stored texts. Clipboard buttons require browser permission and a secure context (including localhost). Native copy/paste shortcuts remain available in the textarea.

### File transfer and recovery

The host's file reader enforces byte limits before decoding strict UTF-8, retaining a BOM. Downloads use UTF-8 blobs and sanitized filenames, without changing saved or recovery state. Text imports become drafts; JSON exports contain the saved core snapshot only. The core validates JSON imports and host-provided fresh IDs before appending all documents to a candidate workspace. The browser persists that candidate in a single workspace-key write before swapping its active core. ID collisions, invalid data, storage quota failures and stale writers cannot partially import or replace existing documents. Formats and archive flags are preserved; document exceptions are not copied.

Recovery uses independent `quadruple-quotes.draft.v1.*` records with a version, draft document, exact saved base (or null) and host timestamp. The host validates document payloads through the Rust codec. Each write/removal compares its exact inspected raw entry; different tabs create independent records instead of sharing an automatically adopted draft. Invalid/future entries remain intact and can be exported as raw data. Limits are 50 records and 10 MiB per record, subject to browser quota. A 500 ms timer and pagehide/visibility/beforeunload flush reduce loss without promising persistence after abrupt termination. Recovery is explicitly selected; unchanged bases retain their identity, while changed/deleted bases become new active copies. Saving/discarding clears only the active inspected recovery record, and failure to clean it reports that it was kept. Recovery history is not serialized, and the initial Undo stack is empty.

Workspace snapshots, proofreading configuration and recovery records have separate write boundaries. A backup import does not overwrite settings or recovery records. The same best-effort stale-value checks apply; these localStorage operations are not cross-key or multi-writer transactions. Damaged startup storage exposes raw downloads instead of auto-resetting data.

## Proofreading boundary

Separate analysis, storage, transport, and UI contributions instead of a single global plugin object. The analysis worker receives an immutable document/revision and returns diagnostics or proposed edits; the host decides when to apply them. Its trusted adapter catalog contains only bundled modules, loaded only when enabled. It does not load user-provided code or a remote plugin registry.

Realtime analysis follows the current draft independently of the Proofreading panel. Updates cancel prior worker work and schedule a new request after 350 ms; composition suspends scheduling. Confirmed results require the current document and revision. A separate provisional display maps unaffected diagnostics through UTF-16 edit differences and removes diagnostics whose declared word, sentence, paragraph, or document context changed. Missing scope metadata invalidates on any edit. Retained hover cards indicate `Rechecking…`; composition preserves unaffected marks while suppressing cards. A current result replaces provisional display as a whole, while document, format, and rule-setting changes clear it. Panel metrics and dependency trees require a current confirmed result. The catalog remains lazy until the panel opens, and native dependency runs remain gated by an explicit request and an open panel. See [diagnostic tracking](proofreading-roadmap.md#tracking-diagnostics-during-editing) for boundary behavior and performance evidence.

`BodyEditor` retains a native textarea for editing, clipboard shortcuts, selection, and IME. An aria-hidden, noninteractive mirror renders only wavy decorations, sharing typography, padding, wrapping, width, and scroll offsets with the textarea. Display ranges expand to whole graphemes and provide nearby anchors for invisible or insertion diagnostics; original UTF-16 ranges remain unchanged for panel selection and future host adapters. Overlapping ranges render the strongest severity without duplicating text. No mirror text is rendered when there are no diagnostics or input exceeds the analysis limit; display work is capped at 200 diagnostics. The footer provides a keyboard-accessible path to messages and rule controls.

Each display segment retains the indices of all diagnostics covering it. Adjacent segments merge only when their severity and diagnostic membership match, so hover messages stay attached to their own ranges. The textarea performs pointer hit testing against cached, visible mirror rectangles; font changes, resizing, scrolling, and new segments invalidate that cache. Keyboard selection and touch expose the same messages through an aria-described nonmodal details dialog. Its card stays inside the viewport, remains hoverable, and supports Escape dismissal. Fix buttons apply only explicit, validated edits to the current draft. Provisional diagnostics cannot apply fixes. Body history and navigation remain editor-host concerns; see [fixes and navigation](proofreading-roadmap.md#applying-fixes-and-navigating-issues) for their contracts.

The shared settings contract separates rule policy from exceptions. Named presets contain rule switches, severities and a character limit, while allowed spelling words and document-scoped rule exceptions remain independent. The core resolves document exceptions before an engine runs and applies severity overrides to diagnostics. The analysis WASM exposes those same policy functions to the worker's bundled adapters, so frontend engines do not implement a second suppression policy. The spelling dictionary checks its allowlist before the diagnostic budget is consumed.

Browser settings use envelope version 2 at the stable `quadruple-quotes.proofreading-settings.v1` key. Version 1 is read without writing and upgraded only by an explicit settings change. Host validation checks bounded configuration, rejects unknown fields/versions rather than dropping them, and compares the inspected raw value before every write. This is a best-effort stale-tab check, not transactional multi-writer storage. A storage event invalidates diagnostics immediately; settings-only reload preserves draft/history. Saved preset metadata is not sent to analysis. See [settings and exceptions](proofreading-roadmap.md#settings-presets-and-exceptions) for scopes and limits.

The LSP owns document-version mapping and translates core text-health and typos diagnostics, including explicit typo quick fixes. It has no hover provider and does not execute JavaScript rules, markdownlint, textlint, GiNZA, plugins, or cloud services. The VSCode client depends only on that LSP surface. Desktop storage stays behind host ports; its analysis uses the browser-safe WASM lanes and marks separately served Japanese helpers unavailable.

## Reference patterns

The workspace follows the small Rust crates and WASM adapter pattern used in [rust-playground](https://github.com/kitsuyui/rust-playground) and [hyper-calendar](https://github.com/kitsuyui/hyper-calendar), and the strict TypeScript, React, Vite, Biome, and browser testing patterns used in [ts-playground](https://github.com/kitsuyui/ts-playground) and [react-playground](https://github.com/kitsuyui/react-playground). These are references, not runtime dependencies.
