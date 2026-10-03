# Quadruple Quotes

A quiet workspace for your words. A text management and proofreading tool with a Rust core and a TypeScript/React UI in one repository.

The first stage provides a minimal plain-text workspace: create, edit, copy, paste, save, duplicate, archive, restore, and delete. Your saved texts appear in a left sidebar; the rest of the screen is an editor. Texts are saved **in the current browser**, persist across reloads, and are never sent to a server.

## Run locally

Install [Rust](https://rustup.rs/), [wasm-pack](https://wasm-bindgen.github.io/wasm-pack/installer/), [Bun](https://bun.sh/), and [Just](https://just.systems/). Use Node.js 22.12+ if running Vite through Node. Then:

```sh
just setup
just dev
```

Open the local URL printed by Vite. `bun run dev` builds the Rust WASM adapter before starting the UI. Restart it after changing Rust; React changes reload automatically. The generated WASM files are ignored and rebuilt locally.

Use **New text** to start a draft. Paste using the toolbar or your usual shortcut, then **Save** (Cmd/Ctrl+S). Copy copies the entire body. The Paste button inserts at the cursor or replaces the selected range. Unsaved navigation and deletion ask for confirmation. Browser clipboard buttons require permission; keyboard shortcuts work directly in the editor.

Each sidebar text has a **…** menu with **Duplicate text**, **Archive text**, and **Delete text**. Duplicate saves an independent copy with “(copy)” added to its title and opens it for editing; the original stays intact. Duplicating an archived text creates an active copy. Save a new draft before duplicating it. Unsaved changes ask whether to save, discard, or cancel before opening the copy.

Archive removes a saved text from the active list without losing its contents; **Archived texts** opens the archive, where **Restore text** brings it back. Save a new draft before archiving it. Archiving/restoring the current unsaved text asks whether to save, discard, or cancel. Deleting another sidebar text keeps the current draft intact. Deletion always shows the target title and requires confirmation.

Storage is scoped to the browser profile and URL origin. Save is local persistence, not a downloaded file or cloud backup. Clearing browser data removes these texts. Save failures keep the draft available, and damaged storage is never silently overwritten. There is no backend to run.

## Validate

```sh
bunx playwright install chromium
just check
```

This checks Rust formatting, Clippy, native core tests, Biome, TypeScript, the production WASM/Web build, and browser workflows against the real Rust core. Browser tests cover Unicode round trips, copy/paste, sidebar duplicate/archive/restore/delete, draft navigation, legacy snapshots, failed storage, corrupt snapshots, stale tabs, and mobile layout.

For a production preview, run `just build` followed by `bun run preview`. The static output is in `apps/web/dist`.

## Boundaries and proofreading

- `crates/core`: platform-independent document operations and versioned snapshots.
- `crates/wasm`: thin browser transport to that core.
- `apps/web`: React UI, browser hosts, and bundled opt-in proofreading adapters.

Proofreading runs locally in a worker while a text is open, even with the panel closed. Enabled rules underline their ranges in the editor: red waves for errors and warnings, blue waves for informational suggestions. The footer's issue count opens **Proofreading** for messages and rule settings. New input clears old marks immediately; checks resume after a short pause, and Japanese IME composition pauses them until input is committed. Text is never rewritten by a diagnostic.

Hover a marked word to read its message and any suggested spellings without opening the panel. Placing the caret in a marked range or tapping it on a touch screen shows the same information. The card stays open while you hover it; Esc dismisses it. Typing, composition, scrolling, or switching documents removes stale messages. Suggestions are displayed for review and never applied automatically.

The panel labels analysis counts as grapheme clusters and the editor footer's code-point count as Unicode scalars. Realtime checks skip texts above 100,000 UTF-16 units and cap diagnostics at 200. Optional Japanese dependency analysis contacts a locally configured parser only after an explicit manual request while the panel is open; closing it stops further dependency runs. LSP, a VSCode extension, and a dedicated desktop/Tauri UI remain WIP. See [the architecture](docs/architecture.md) for the integration boundaries.
