# Architecture

Quadruple Quotes is a text management and proofreading tool. The first stage implements plain-text management only. All components live in this repository.

```text
React editor → EditorHost ports → browser adapter → WASM transport → Rust core
                                     ↓
                               browser storage
```

| Component | Responsibility | Status |
| --- | --- | --- |
| `crates/core` | Documents, save/duplicate/archive/delete rules, validation, versioned snapshots | Implemented |
| `crates/wasm` | Thin JSON transport to the same core | Implemented |
| `apps/web` | Editor, sidebar, draft lifecycle, browser storage and clipboard | Implemented |
| Proofreading plugins | Analysis capabilities and opt-in suggestions | WIP; no implementation |
| LSP | Native core adapter for document synchronization and diagnostics | WIP; no implementation |
| VSCode extension | LSP client and editor integration | WIP; no implementation |
| Desktop | Reuse the React editor with a Tauri host adapter | WIP; no implementation |

## Dependency direction

The core depends only on serialization libraries. It accepts document IDs and timestamps from its host, holds documents in memory, and reads/writes a versioned JSON snapshot. It has no IO or platform clock. A native LSP or desktop host can use this crate without WebAssembly or React.

The WASM crate translates errors and JSON across the browser boundary. It delegates mutations and snapshot validation to the core. No text management behavior is implemented a second time in TypeScript.

The React editor depends on `EditorHost`, not the browser adapter. `TextRepository`, `ClipboardPort`, ID creation, and the clock are replaceable host capabilities. A future Tauri adapter can use native commands for persistence and clipboard while reusing the editor. No Tauri-specific code is required yet.

## Persistence and drafts

The browser stores one snapshot under the stable key `quadruple-quotes.workspace.v1` in localStorage. Snapshot version 2 adds an `archived` boolean to each document. The Rust core reads version 1 documents with `archived: false` and exports version 2; legacy storage is only rewritten after a successful mutation. Older builds reject the new version rather than interpreting it as empty data.

A draft stays in React until Save (or Cmd/Ctrl+S). Navigation asks whether to save, discard, or cancel; closing/reloading with edits uses the browser's beforeunload prompt. Deletion requires confirmation naming the target. Each sidebar row has separate open and action controls, so a command targets that row even while another document has unsaved edits.

Archive and restore are core mutations that only change the archive flag, keeping body, title, ID, and edit timestamp intact. The UI filters active/archived lists, and protects unsaved edits before archiving or restoring the current text. A new unsaved draft must be saved before archive is enabled. Archived texts remain editable and deletable. Removing another text does not discard the current draft.

Duplicate is a core mutation that copies a saved text's exact body into a new ID supplied by the host, adds “(copy)” to its title (using “Untitled text” for blank titles), and sets a new host timestamp. The copy is active even when the source is archived. Existing IDs are rejected rather than replaced. The UI opens the persisted copy for editing, asking whether to save, discard, or cancel any current draft first. Saving that draft updates the source before copying if it is the source; discarding copies its last saved contents. A new unsaved text must be saved before duplication is enabled.

The browser adapter creates a candidate core workspace, performs the mutation, persists its snapshot, and only then replaces the active core. Quota/permission failures leave both the saved documents and draft available. Invalid or unsupported snapshots are rejected without clearing storage. Each mutation compares the loaded snapshot with current storage to reject stale tabs. This is a best-effort conflict check, not a transactional multi-writer store; collaborative editing remains out of scope.

Saving is local to the current browser profile and origin. It is not a file download or cloud backup; clearing browser data removes stored texts. Clipboard buttons require browser permission and a secure context (including localhost). Native copy/paste shortcuts remain available in the textarea.

## Future plugin boundary (WIP)

Separate analysis, storage, transport, and UI contributions instead of a single global plugin object. An analysis plugin should receive an immutable document/revision and return diagnostics or proposed edits; the host should decide when to apply them. Explicit capability registration and versioned interfaces should precede any runtime loading mechanism. Do not introduce dynamic library loading, a plugin registry, or placeholder actions before a concrete plugin is needed.

LSP synchronization can use the native core and its own document-version mapping; protocol capabilities stay in that adapter. A VSCode client depends on the LSP surface rather than Rust internals. Desktop storage stays behind host ports. These boundaries leave room for the next stages without implementing them in this stage.

## Reference patterns

The workspace follows the small Rust crates and WASM adapter pattern used in [rust-playground](https://github.com/kitsuyui/rust-playground) and [hyper-calendar](https://github.com/kitsuyui/hyper-calendar), and the strict TypeScript, React, Vite, Biome, and browser testing patterns used in [ts-playground](https://github.com/kitsuyui/ts-playground) and [react-playground](https://github.com/kitsuyui/react-playground). These are references, not runtime dependencies.
