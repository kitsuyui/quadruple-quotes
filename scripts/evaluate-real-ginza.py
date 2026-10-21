#!/usr/bin/env python3
"""Measure a local GiNZA model without treating structural cues as grammar gold."""
import argparse
import importlib.metadata
import json
import platform
from pathlib import Path
import resource
import shutil
import statistics
import subprocess
import sys
import time


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


def from_utf16_offset(text, offset):
    total = 0
    for index, character in enumerate(text):
        if total == offset:
            return index
        total += utf16(character)
        if total > offset:
            return None
    return len(text) if total == offset else None


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def graph(doc, source):
    nodes = []
    for sentence_index, sentence in enumerate(doc.sents):
        for token in sentence:
            start = utf16(source[:token.idx])
            nodes.append({
                "id": token.i,
                "text": token.text,
                "range": {"start": start, "end": start + utf16(token.text)},
                "head": None if token.head == token else token.head.i,
                "relation": token.dep_,
                "sentence": sentence_index,
            })
    return nodes


def valid_graph(nodes, source):
    by_id = {node["id"]: node for node in nodes}
    if len(nodes) > 5000 or len(by_id) != len(nodes):
        return False
    for node in nodes:
        start, end = node["range"]["start"], node["range"]["end"]
        start_index, end_index = from_utf16_offset(source, start), from_utf16_offset(source, end)
        if not (0 <= start <= end <= utf16(source)) or start_index is None or end_index is None:
            return False
        if source[start_index:end_index] != node["text"]:
            return False
        if node["head"] is not None:
            head = by_id.get(node["head"])
            if not head or head["sentence"] != node["sentence"] or head["id"] == node["id"]:
                return False
    for node in nodes:
        seen, current = set(), node
        while current["head"] is not None:
            if current["id"] in seen:
                return False
            seen.add(current["id"])
            current = by_id[current["head"]]
    return True


def cues(nodes, distance):
    by_id = {node["id"]: node for node in nodes}
    return [node["id"] for node in nodes if node["head"] is not None and
            abs(node["range"]["start"] - by_id[node["head"]]["range"]["start"]) >= distance]


parser = argparse.ArgumentParser()
parser.add_argument("--corpus", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--distance", type=int, default=24)
args = parser.parse_args()
items = [json.loads(line) for line in open(args.corpus, encoding="utf-8") if line.strip()]
cold_started = time.perf_counter()
cold = subprocess.run([sys.executable, "-c", "import spacy; spacy.load('ja_ginza')"], capture_output=True, text=True)
cold_ms = (time.perf_counter() - cold_started) * 1000
if cold.returncode:
    raise SystemExit(cold.stderr)
import ginza
import spacy

model_started = time.perf_counter()
nlp = spacy.load("ja_ginza")
model_load_ms = (time.perf_counter() - model_started) * 1000
model_path = Path(spacy.util.get_package_path("ja_ginza"))
model_bytes = sum(path.stat().st_size for path in model_path.rglob("*") if path.is_file())
outcomes = []
for item in items:
    nodes = graph(nlp(item["text"]), item["text"])
    found = cues(nodes, args.distance)
    outcomes.append({**item, "nodeCount": len(nodes), "graphValid": valid_graph(nodes, item["text"]),
                     "cueIds": found, "cuePresent": bool(found), "expectationMatched": bool(found) == item["expectCue"],
                     "graph": nodes})
benchmark = items[2]["text"]
warm_ms = []
for _ in range(11):
    started = time.perf_counter()
    nlp(benchmark)
    warm_ms.append((time.perf_counter() - started) * 1000)
five_k = "あ" * 5000
five_k_nodes = graph(nlp(five_k), five_k)
too_long = subprocess.run(
    [sys.executable, "scripts/dependency-parser.py"],
    input=json.dumps({"id": 0, "text": "あ" * 5001}, ensure_ascii=False) + "\n",
    capture_output=True, text=True, check=True,
)
too_long_reply = json.loads(too_long.stdout)
report = {
    "schemaVersion": 1,
    "parser": {"name": "GiNZA", "model": "ja_ginza", "ginzaVersion": importlib.metadata.version("ginza"),
               "spacyVersion": spacy.__version__, "device": "AppleOps backend selected; spaCy prefer_gpu() returned false, so this run is recorded as CPU-backed NumPy operations"},
    "provenance": {"license": "MIT", "modelBytes": model_bytes,
                   "officialGiNZA": "https://github.com/megagonlabs/ginza",
                   "officialKWJA": "https://github.com/ku-nlp/kwja"},
    "availability": {"ginza": "available and measured through the JSONL adapter", "kwja": "not installed; not measured because its official runtime is a separate opt-in model and adapter contract" if shutil.which("kwja") is None else "command found but not evaluated"},
    "runtime": {"platform": platform.platform(), "python": platform.python_version(), "rssMax": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "rssUnit": "bytes on macOS (getrusage ru_maxrss)" if sys.platform == "darwin" else "platform-dependent ru_maxrss units"},
    "timingMs": {"coldImportAndLoad": cold_ms, "warmModelLoad": model_load_ms, "warm11": warm_ms,
                 "warmMedian": statistics.median(warm_ms), "warmP95": percentile(warm_ms, .95)},
    "bounds": {"input5000Utf16Accepted": utf16(five_k) == 5000, "input5000NodeCount": len(five_k_nodes),
               "input5000GraphValid": valid_graph(five_k_nodes, five_k), "input5001RejectedByAdapterContract": too_long_reply.get("ok") is False and "at most 5000 UTF-16" in too_long_reply.get("error", ""),
               "uiRowCap": 200, "rawGraphNodeCap": 5000},
    "advisoryEvaluation": {"kind": "structural review cue only", "labelDefinition": "The hand-selected corpus labels whether this 24 UTF-16-unit source-offset heuristic should emit a review cue, not whether the Japanese is grammatically correct or ambiguous.",
                            "matched": sum(item["expectationMatched"] for item in outcomes), "total": len(outcomes),
                            "precisionRecall": "Not reported as linguistic accuracy; the labels exercise a structural heuristic."},
    "outcomes": outcomes,
}
with open(args.out, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
