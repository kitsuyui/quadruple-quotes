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

## Files and draft recovery

Open **Files & recovery** to download the current draft as UTF-8 `.txt` or `.md`. Downloading does not save it. **Download workspace JSON** backs up saved texts with their titles, IDs, timestamps, formats and archive flags. It excludes unsaved drafts and proofreading settings.

Choose a UTF-8 `.txt` or `.md` file, review it, and **Open as unsaved text**. Markdown files use Markdown format; other text files use Plain text. Both preserve the original Unicode and whitespace, including a UTF-8 BOM. Changing a document's format is a draft change saved with **Save**. Workspace `.json` files are validated before **Add texts** appends independent copies with new IDs, preserving existing texts and the current draft. Malformed, unsupported, duplicate-ID and over-limit backups are rejected. Limits are 5 MiB per text file and 10 MiB / 1,000 texts for an imported workspace (including the destination total). Imported copies do not inherit document-specific proofreading exceptions.

Unsaved title, body and format changes are recorded in separate browser recovery storage after a 500 ms pause and on page hide. **Recover drafts** lets you choose a draft to continue; recovery never saves its body automatically. If its saved base changed or was deleted, it opens a recovered copy instead. Save or explicitly discard the current draft to clear its recovery copy; other recovery entries remain. Undo history starts fresh after recovery. Storage failures display a warning and keep the draft available for download. Recovery stores up to 50 entries, never overwrites malformed or stale entries, and offers raw recovery downloads for inspection. It shares the browser profile/origin's storage and is not protection against clearing browser data or an abrupt crash before a successful write.

If a damaged workspace prevents startup, **Download raw workspace data** and **Download raw recovery data** preserve the available bytes without clearing or replacing them. Raw recovery downloads are inspection artifacts, not workspace imports.

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

Proofreading runs locally in a worker while a text is open, even with the panel closed. Enabled rules underline their ranges in the editor: red waves for errors and warnings, blue waves for informational suggestions. The footer's issue count opens **Proofreading** for messages and rule settings. During editing, unaffected marks follow inserted or deleted text while checks wait for a short pause. Editing a flagged word removes its mark immediately. Context-sensitive rules also discard marks when their sentence, paragraph, or document changes. Japanese IME composition pauses checks while preserving unaffected marks until input is committed. Text is never rewritten by a diagnostic.

Hover a marked word to read its message and any suggested spellings without opening the panel. Placing the caret in a marked range or tapping it on a touch screen shows the same information. The card stays open while you hover it; Esc dismisses it. Retained marks show **Rechecking…** in the card until a new result replaces them. Typing dismisses the current card; hovering a retained mark opens its explanation at the updated location. Composition suppresses cards, and scrolling or switching documents dismisses them. Suggestions are never applied automatically. Explicit typos fix buttons update only the draft; Undo/Redo restores body edits, and F8/Shift+F8 navigates issues. Ctrl/Cmd+. focuses a card action.

Under **Proofreading → Presets**, choose **Basic**, **Japanese prose**, or **Markdown documentation** and click **Apply preset**. A preset replaces rule switches, severities and the character limit; it keeps your allowed words and document exceptions. The Markdown preset requires choosing Markdown format separately. Built-in presets leave AI hints and native dependency analysis off. Save the current rules under a unique name to reuse them; deleting a saved preset keeps the active settings.

**Rules and plugins** offers each rule's default, suggestion, warning or error severity and a grapheme-based character limit. **Exclude here** disables a rule only for the current document. A diagnostic card or issue row also offers **Ignore rule in this document**; for spelling it offers **Allow “word” everywhere**. Allowed spelling words ignore ASCII case and do not silence other rules. **Exceptions** lists these choices and lets you remove them. Duplicated texts get a new document ID and do not inherit document exceptions.

Settings save separately from texts and never save or edit a draft. Legacy settings upgrade only after an explicit change. Corrupt or unsupported settings remain untouched; another tab's update disables stale analysis until **Reload proofreading settings** reads only the settings, preserving your draft and body history. **Reset proofreading settings** explicitly clears settings and saved presets without clearing texts.

The panel labels analysis counts as grapheme clusters and the editor footer's code-point count as Unicode scalars. Realtime checks skip texts above 100,000 UTF-16 units and cap diagnostics at 200. Optional Japanese dependency analysis contacts a locally configured parser only after an explicit manual request while the panel is open; closing it stops further dependency runs. LSP, a VSCode extension, and a dedicated desktop/Tauri UI remain WIP. See [the architecture](docs/architecture.md) for the integration boundaries.
