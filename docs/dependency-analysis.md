# Dependency analysis

Japanese dependency inspection is an opt-in, manual GiNZA request. The panel
links each dependent to its head and offers optional long-distance cues. A cue
is evidence for review, not a grammar finding: quotation, relative clauses,
and sentence style can all make a long link appropriate. It never edits text.

The local host rejects malformed graphs: non-finite or duplicate ids, invalid
UTF-16 scalar boundaries, ranges that do not match token text, unknown or
cross-sentence heads, cycles, and outputs over 5,000 nodes. The UI displays at
most 200 rows without truncating the validated graph. A result is tied
to the current document revision; editing, switching text, or closing the
panel clears it.

`scripts/compare-dependency-parsers.py` compares explicitly supplied local
commands on a JSONL corpus. It records cold/p50/p95 latency when a parser is
available and records an unavailable reason otherwise. KWJA is intentionally
not bundled: its official documentation lists Python 3.10+, optional CUDA/MPS,
and selectable tiny/base/large models, so installing a model is a deliberate
local choice. The runner does not claim agreement, precision/recall, RSS, or
model/version data when its required labelled corpus or process monitor is not
provided.
