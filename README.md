# Quadruple Quotes

A quiet workspace for your words. A text management and proofreading tool with a Rust core and a TypeScript/React UI in one repository.

The first stage provides a minimal plain-text workspace: create, edit, copy, paste, save, archive, restore, and delete. Your saved texts appear in a left sidebar; the rest of the screen is an editor. Texts are saved **in the current browser**, persist across reloads, and are never sent to a server.

## Run locally

Install [Rust](https://rustup.rs/), [wasm-pack](https://wasm-bindgen.github.io/wasm-pack/installer/), [Bun](https://bun.sh/), and [Just](https://just.systems/). Use Node.js 22.12+ if running Vite through Node. Then:

```sh
just setup
just dev
```

Open the local URL printed by Vite. `bun run dev` builds the Rust WASM adapter before starting the UI. Restart it after changing Rust; React changes reload automatically. The generated WASM files are ignored and rebuilt locally.

Use **New text** to start a draft. Paste using the toolbar or your usual shortcut, then **Save** (Cmd/Ctrl+S). Copy copies the entire body. The Paste button inserts at the cursor or replaces the selected range. Unsaved navigation and deletion ask for confirmation. Browser clipboard buttons require permission; keyboard shortcuts work directly in the editor.

Each sidebar text has a **…** menu with **Archive text** and **Delete text**. Archive removes a saved text from the active list without losing its contents; **Archived texts** opens the archive, where **Restore text** brings it back. Save a new draft before archiving it. Archiving/restoring the current unsaved text asks whether to save, discard, or cancel. Deleting another sidebar text keeps the current draft intact. Deletion always shows the target title and requires confirmation.

Storage is scoped to the browser profile and URL origin. Save is local persistence, not a downloaded file or cloud backup. Clearing browser data removes these texts. Save failures keep the draft available, and damaged storage is never silently overwritten. There is no backend to run.

## Validate

```sh
bunx playwright install chromium
just check
```

This checks Rust formatting, Clippy, native core tests, Biome, TypeScript, the production WASM/Web build, and browser workflows against the real Rust core. Browser tests cover Unicode round trips, copy/paste, sidebar archive/restore/delete, draft navigation, legacy snapshots, failed storage, corrupt snapshots, stale tabs, and mobile layout.

For a production preview, run `just build` followed by `bun run preview`. The static output is in `apps/web/dist`.

## Boundaries and WIP

- `crates/core`: platform-independent document operations and versioned snapshots.
- `crates/wasm`: thin browser transport to that core.
- `apps/web`: React UI and replaceable host ports for persistence, clipboard, IDs, and time.

Proofreading plugins, LSP, a VSCode extension, and a dedicated desktop/Tauri UI remain **WIP** with no implementation or placeholder controls. See [the architecture](docs/architecture.md) for their intended integration boundaries.
