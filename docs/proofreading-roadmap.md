# Proofreading roadmap

Proofreading is advisory. It never automatically rewrites a document, assigns an authorship score, or sends text to a cloud service. Accepted fixes update only the draft; the saved workspace snapshot changes only through an explicit save.

## First delivery

| Capability | Decision | Why |
| --- | --- | --- |
| Unicode counts and basic checks | Adopt in the Rust engine | One definition of graphemes, UTF-16 units, bytes, and ranges for browser and future native clients. |
| `typos` | Adopt for known English spelling corrections | It is a dictionary checker, not a Japanese prose judge. |
| `textlint` Japanese rules | Adapter boundary, individually enabled rules | The [textlint kernel](https://github.com/textlint/textlint) and [Japanese ecosystem](https://github.com/textlint-ja) offer useful focused rules; broad presets are not automatically appropriate for every genre. |
| `markdownlint` | Adapter boundary for Markdown only | [markdownlint](https://github.com/DavidAnson/markdownlint) checks structure, not ordinary text. |
| GiNZA dependencies | Optional manual local adapter | [GiNZA](https://github.com/megagonlabs/ginza) supports inspection of Japanese dependencies. A dependency tree is evidence to inspect, not a correctness verdict. |
| AI-writing hints | Experimental and opt-in | [textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing) is evaluated as explicit, span-level style hints. No single “AI score” is shown. |

## Deferred

WritingLint has a substantial model footprint, so it is deferred until an offline browser or native performance evaluation is useful. LanguageTool, Vale, RedPen, and cloud AI services require separate runtime, privacy, or deployment decisions. KWJA is a later comparison point for dependency analysis. Rules that force a specific technical or JTF style remain opt-in because style depends on audience and document purpose.

## Extension contract

The Rust engine owns metrics and built-in diagnostics. The shared `packages/analysis/src/types.ts` protocol uses UTF-16, start-inclusive/end-exclusive ranges so browser selections and future LSP positions can agree. Third-party adapters are statically registered, bundled code only: there is no URL, npm, or runtime-eval plugin loader. A plugin has a stable ID, a catalog of individually switchable rule IDs, a run policy, and an isolated status.

The UI submits an immutable `{documentId, revision, text, format, settings}` request after a 350 ms debounce whenever a draft is open, independently of the panel. It terminates previous worker work and accepts only a result with the current ID and revision. IME composition pauses scheduling. Inputs above 100,000 UTF-16 units are explicitly skipped while full-body metrics remain available. Diagnostics cap at 200 and the visible list at 50. Settings use a separate versioned storage key; malformed or stale configuration must report an error without changing documents. Inline decorations preserve the textarea as the sole editing surface.

### Tracking diagnostics during editing

The shared diagnostic protocol has an optional `invalidationScope`: `range`, `word`, `sentence`, `paragraph`, or `document`. Missing metadata defaults to document-wide invalidation. Core control checks retain their exact character ranges, spelling checks require an unchanged word (including its boundaries), and plain-text style hints require an unchanged sentence. Japanese normalization uses paragraph context. Mixed-period and Markdown parser-dependent checks invalidate on any document edit, since distant edits can change their interpretation.

`packages/analysis/src/diagnostic-tracking.ts` maps retained ranges through each edit in UTF-16 coordinates. The textarea host computes a single replacement from common prefix/suffix text, keeping surrogate pairs whole. Multiple separated edits in one update conservatively invalidate the intervening region. Sentence, paragraph, and word context indexes are built lazily once per update, and display work remains bounded to 100,000 units and 200 diagnostics.

The UI keeps confirmed analysis and provisional display state separate. Editing a diagnostic's range or changing its required context removes it immediately; other ranges move with the text. Insertion at a range's start stays before it, insertion at its end stays after it, and word boundary changes invalidate spelling marks. Retained hover cards say `Rechecking…`. Composition preserves unaffected marks while suppressing cards and scheduling. A matching new result atomically replaces all provisional diagnostics, including those it removes. Older worker results cannot revive removed marks. Document, format, and rule-setting changes clear provisional state. Counts and dependency trees in the panel always require a current confirmed result; provisional ranges are never presented as newly analyzed text.

This tracking layer does not require a CRDT or change saved documents. A future collaborative editor can supply relative anchors at the host boundary while retaining the same context-invalidation and revision checks. Position stability does not guarantee that a diagnostic remains semantically valid.

An isolated Chromium 153 measurement on 2026-10-04 retained 200 spelling diagnostics while inserting an emoji before a 99,998-unit document, producing exactly 100,000 UTF-16 units. Tracking alone took a median 3.2 ms over eleven warm samples (2.7–3.6 ms). A separate production-preview input-to-next-frame sample took 34.8 ms, retained all 200 marks, shifted the first offset to 2, and displayed `Checking… 200 previous issues`. The first measurement excludes rendering; the second includes React and mirror updates but excludes the delayed worker check. These are observations on the checked machine, not cross-device latency guarantees.

The GiNZA adapter only contacts the same-origin `/api/dependencies` proxy on a user-requested manual run while the plugin is enabled. If the local helper is absent, it reports a plugin error with setup guidance. Saved document data and analysis output remain separate.

### Applying fixes and navigating issues

`Diagnostic.fixes` contains named alternatives with explicit UTF-16 replacements, expected original text, and replacement text. `typos` supplies these actions; suggestion strings alone never become edits. The host requires the current document ID and analysis revision, verifies every precondition and scalar boundary, and rejects overlapping edits before applying the entire alternative. Provisional marks may retain messages and suggestions, but their fix buttons remain disabled until a matching analysis completes. Composition and navigation confirmations block editing actions.

Inline details are a nonmodal dialog because they now contain buttons. Hover or caret selection reveals it; Ctrl/Cmd+. focuses the first available fix and Escape returns focus to the textarea when dismissing a focused card. The panel exposes the same single-fix actions. Accepted edits preserve unrelated Unicode and whitespace, select the replacement, and leave the document unsaved.

Body undo/redo stores replacement transactions rather than workspace snapshots. Each fix and IME composition is one step; adjacent typing can coalesce within 750 ms. Later typing undoes before an earlier fix, and a new edit clears redo. History resets when opening another document, remains available after saving, and does not take over title-field native history. It trims older entries beyond 200 steps or 1,000,000 retained UTF-16 units, keeping the latest transaction. Buttons and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z operate on the body.

Previous/next buttons and Shift+F8 / F8 navigate diagnostics in source order, including distinct overlapping issues, and wrap at either end. The textarea reveals distant marks. Retained provisional ranges remain navigable, but that does not authorize applying their older fixes. LSP code actions and native hosts can reuse the fix protocol without adopting browser history or storage.

### Settings presets and exceptions

Three explicit built-in presets use the current closed catalog: Basic enables text health and spelling; Japanese prose adds normalization, Japanese sentence endings and length; Markdown documentation adds Markdown structure and Japanese normalization. Markdown format remains a separate choice. All built-in presets disable style/AI hints and native dependency analysis. Up to 20 uniquely named custom presets capture effective rule switches, severity overrides and the optional grapheme limit. Applying any preset replaces that policy while retaining allowed words, document exceptions and valid unrecognized rule/plugin IDs. Deleting a preset does not change the active policy.

`AnalysisSettings.allowedWords` permits up to 500 single words (100 UTF-16 units each), with ASCII case ignored. Only typos uses this allowlist; text-health and other engines still check the text. Its dictionary applies allowed words before collecting the first 200 spelling diagnostics, so allowed words cannot hide later visible spelling issues by consuming that budget. `ignoredRules` contains up to 500 distinct `{documentId, ruleId}` pairs. Each pair suppresses the whole rule in that document, not just one occurrence; duplicate documents have independent IDs. Exceptions survive archive/reload and remain listed, including for unavailable texts, until explicitly removed.

The Rust core's `resolve_analysis_settings` disables document-excluded rules before analysis, including the worker's bundled adapters. `apply_diagnostic_settings` applies document suppression and per-rule `info`, `warning` or `error` severity to their diagnostics. Both functions are exported by the analysis WASM adapter. The UI never implements a separate diagnostic filter or rewrites text to apply an exception. Inline/list exception actions require a current document and revision, just like fixes; provisional or composing input cannot register an old diagnostic as a new exception.

The browser persists envelope version 2 (`settings` and `presets`) at the unchanged settings key. Version 1 is loaded without mutation; the first explicit settings write migrates it. Validation rejects malformed data, unsupported versions, unexpected fields, invalid severities, duplicate entries, and oversized collections without overwriting the raw value. Rule maps retain at most 200 valid IDs per map, preset names have at most 60 characters, and the optional character limit is a whole number from 1 to 1,000,000,000. Unknown valid rule/plugin IDs are preserved; executable configuration, regular-expression exceptions and dynamic loading are unsupported.

Writes compare the exact inspected raw settings value before updating, preserving the previous value if validation or storage fails. Storage events disable stale analysis and invalidate diagnostic/fix revisions. Reload proofreading settings reads only this configuration and leaves the draft and body history intact. Reset is an explicit replacement of the inspected settings value and clears saved presets as well; neither operation clears saved texts. Preset metadata-only changes do not restart analysis. This remains best-effort conflict detection across tabs, not a transactional shared store.

Rule/exception changes, reload, and reset clear the prior manual dependency-run intent. Enabling a native parser through a saved preset therefore requires a new explicit Run dependency analysis action; saving or deleting preset metadata alone leaves analysis unchanged.

Temporary single-occurrence dismissals, regular-expression exceptions, project/team settings, automatic language detection, and additional proofreading engines remain separate work.

## Performance evidence to record

Before enabling an adapter by default, record cold and warm worker latency, a 100,000-unit request outcome, and built bundle output. These are regression evidence for the checked machine, not cross-device promises. Heavy or native-only analyzers stay manual until those measurements show an acceptable interaction cost.

### Browser measurement, 2026-10-03

An isolated Chromium run against the production preview on port 4183 measured from a textarea update until the matching result rendered. Each warm value is the median of eleven same-worker samples and includes the 350 ms UI debounce; it is an interaction measurement, not engine-only time. A cold value opens a fresh browser context and worker. The curated case enables Japanese writing (including the two optional rules), AI hype hints, and Markdown structure checks.

| Condition | Cold, 10,000 UTF-16 | Warm, 10,000 | Warm, 100,000 | Warm, 100,001 |
| --- | ---: | ---: | ---: | ---: |
| Default core and typos, plain text | 454.7 ms | 399.8 ms | 415.6 ms | 415.6 ms |
| Curated Japanese, AI, and Markdown | 520.1 ms | 433.4 ms | 483.3 ms | 417.5 ms |

At 100,001 UTF-16 units the adapter shortcut applies, so the result remains intentionally bounded; it does not establish that a terminated worker retains a warm cache. The checked build contains an 846,323-byte analysis worker (238,610 bytes gzip), a 2,735,168-byte analysis WebAssembly asset (873,777 bytes gzip), and a 150,683-byte core WebAssembly asset (52,696 bytes gzip). A scan of `apps/web/dist` found no `kuromojin`, `DIC_PATH`, or `kuromoji` references.

The same isolated session also exercised the real local GiNZA helper through the preview proxy. `太郎は😀寿司を食べる。花子も本を読む。` produced 13 dependency rows across two sentences, including the emoji-to-`寿司` compound relation. A second request produced a new dependency result while the same parser child remained resident. This verifies local proxy routing and process reuse for that session; it makes no lifetime guarantee across helper restarts.

The checked responsive-sheet evidence is saved locally as `.tmp/proofreading-panel-390.png`, `.tmp/proofreading-panel-768.png`, and `.tmp/proofreading-panel-1080.png`; `.tmp/proofreading-panel-1280.png` preserves the desktop side pane. Each shows panel controls and the close button without toolbar overlap.

## Implemented and deferred choices

| Capability | Status | Scope |
| --- | --- | --- |
| Rust metrics and `typos` | Implemented | Metrics use grapheme clusters, Unicode scalars, UTF-16 units, and bytes. The editor footer labels its `Array.from` count as Unicode scalars; analysis metrics retain the Rust grapheme count. |
| markdownlint | Implemented | The closed bundled catalog exposes MD001, MD009, MD012, MD022, MD025, MD031, MD032, MD040, MD041, and MD047 individually. Whole presets and unlisted rules are deferred. |
| textlint Japanese rules | Implemented | `no-nfd` is enabled when the optional plugin is enabled; mixed periods and 100-character sentence length are opt-in warnings. Dictionary-backed `max-ten` is deferred. |
| AI-writing hints | Implemented | Only the opt-in `no-ai-hype-expressions` deep rule is bundled as an info hint. It is not an authorship score. The rest of the preset, including dictionary-backed rules, is deferred. |
| GiNZA | Optional manual | A local helper and model are required. Manual runs cap input at 5,000 UTF-16 units; only the first 200 dependency rows render. |
| KWJA, Vale, LanguageTool, RedPen, WritingLint | Deferred | Their model, runtime, deployment, or browser-cost decisions remain separate. |

The selected tools are MIT except `typos` (MIT or Apache-2.0). GiNZA model and dictionary notices must be checked when installed. No selected browser adapter bundles a tokenizer dictionary.

Run `cargo run -p quadruple-quotes-core --release --example analysis_benchmark` for reproducible Rust evidence. On macOS 27.0 (26A428), Apple M4 Pro, rustc 1.98.1, release build, with eleven warm samples: exactly 10,000 UTF-16 units cold 0.922 ms / warm median 0.756 ms; exactly 100,000 units cold 7.330 ms / warm median 7.596 ms; 100,001 units cold 2.508 ms / warm median 2.469 ms and `truncated: true`. These are measured locally, not device-wide promises. Browser cold/warm evidence is a separate runtime measurement.

GiNZA requires a separately installed Python environment and model, then the local analysis host. The UI uses the same-origin `/api/dependencies` proxy on development/preview ports 5173 and 4173; manual requests cap at 5,000 UTF-16 units. The helper reports unavailable models as HTTP 503, parser or protocol failures as 502, timeouts as 504, and malformed or over-limit input as 400; the browser displays the supplied plugin error. No cloud calls, auto-rewrites, or AI authorship scores are used. LSP, VSCode, and Tauri remain WIP.

For GiNZA, create an isolated Python environment (for example with `uv`), install `ja-ginza`, set `ANALYSIS_HOST_PYTHON` when Python is not on `PATH`, and start `bun apps/analysis-host/server.ts`. The host reads `ANALYSIS_HOST_SCRIPT` and `ANALYSIS_HOST_PORT`; its default port is 4180. The browser uses only the development/preview proxy, never a cloud endpoint.
