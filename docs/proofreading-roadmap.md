# Proofreading roadmap

Proofreading is advisory. It never rewrites a document, assigns an authorship score, sends text to a cloud service, or changes the saved workspace snapshot.

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

The UI submits an immutable `{documentId, revision, text, format, settings}` request after a 350 ms debounce whenever a draft is open, independently of the panel. It terminates previous worker work and renders only a result with the current ID and revision. IME composition pauses scheduling. Inputs above 100,000 UTF-16 units are explicitly skipped while full-body metrics remain available. Diagnostics cap at 200 and the visible list at 50. Settings use a separate versioned storage key; malformed or stale configuration must report an error without changing documents. Inline decorations use the same result as the panel and preserve the textarea as the sole editing surface.

The GiNZA adapter only contacts the same-origin `/api/dependencies` proxy on a user-requested manual run while the plugin is enabled. If the local helper is absent, it reports a plugin error with setup guidance. Saved document data and analysis output remain separate.

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
