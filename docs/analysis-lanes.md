# Analysis worker lanes

`BrowserAnalysisPort` lazily owns five long-lived workers: a Rust/WASM core lane,
three JavaScript adapter lanes, and one manual GiNZA lane. Catalog loading uses
a separate temporary core worker, so panel opening cannot supersede realtime work;
the bounded peak is six workers. Its successful catalog promise is cached and
the temporary worker is terminated; later catalog reads do not create another
worker. Idle persistent workers remain
available for the next request. Replacing busy work, worker errors, and hard
deadlines terminate only the affected worker, so synchronous third-party work
cannot survive a `Promise.race` timeout. Each lane accepts a reply only when
its request ID matches the outstanding request, so a reply from a retired
worker cannot settle a replacement request.

The core lane resolves settings and produces core diagnostics. Adapter lanes
then run independently; failures become their own plugin status. The core lane
applies the Rust diagnostic policy to joined adapter diagnostics and performs
the final 200-item cap. The GiNZA lane never loads WASM and cannot delay
realtime checks. Its request is limited to 5,000 UTF-16 units and its fetch is
aborted after five seconds.

The production build provides a 6.89 kB core/GiNZA worker entry and one
2.85 MB analysis WASM asset (902 kB gzip), while the adapter entry is 840.70
kB. A realtime request creates at most four workers (core plus three adapter
lanes); a manual dependency request can add the fifth GiNZA worker, while a
concurrent catalog can add the sixth temporary worker. This is a
bounded worker and asset footprint, not a measured RAM guarantee: idle
enabled-adapter workers retain their JavaScript runtime until disposal.

Run `bun run scripts/benchmark-analysis-browser.ts` for a production-build
Chromium measurement. It writes raw samples, browser/version information,
input UTF-16 and UTF-8 counts, worker creations, settings, and outcomes to
`.tmp/remaining-roadmap/priority4-performance.json`. Each cold sample uses a
fresh port; each warm series primes one port and then records eleven requests
on that same port. The script builds a benchmark-only Vite entry, starts a
temporary localhost preview server, and closes it in `finally`.

## Local Japanese style checks

The browser keeps bracket matching lightweight and disabled by default. Four morphology-backed rules are also disabled by default and run only after an explicit manual request: mixed です・ます/である style, doubled particles, redundant expressions, and common misuse dictionaries. The local helper accepts plain text and Markdown; Markdown code blocks and block quotes are excluded by the Markdown parser.

The helper is limited to 5,000 UTF-16 units, five seconds, and 200 diagnostics. It accepts only those fixed rule identifiers and returns UTF-16 ranges. It listens on loopback and permits configured browser origins; requests without an Origin header are intentionally supported for local command-line diagnostics. Browser UI support is available through the local analysis host; future desktop hosts must declare the capability before enabling it.
