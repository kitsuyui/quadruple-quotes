#!/usr/bin/env python3
"""Opt-in, JSONL-protocol comparison runner for local dependency parsers.

Commands must accept {"id", "text"} JSON Lines on stdin and return the same
id with {"ok": true, "dependencies": [...]}. It never installs models. A
labelled expectedAdvisory list records dependent ids expected to exceed the
configured source-offset distance; only complete labels receive P/R metrics.
"""
import argparse
import json
import platform
import subprocess
import time


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def run(command, item, timeout):
    started = time.perf_counter()
    payload = json.dumps({"id": 0, "text": item["text"]}, ensure_ascii=False) + "\n"
    try:
        result = subprocess.run(command, input=payload, text=True, capture_output=True,
                                timeout=timeout, check=True)
        reply = json.loads(result.stdout.strip())
        if reply.get("id") != 0 or reply.get("ok") is not True:
            raise ValueError(reply.get("error", "protocol reply was unsuccessful"))
        nodes = reply.get("dependencies")
        if not isinstance(nodes, list):
            raise ValueError("dependencies is not a list")
        return {"available": True, "nodes": nodes,
                "latencyMs": (time.perf_counter() - started) * 1000}
    except FileNotFoundError:
        return {"available": False, "reason": "command is not installed"}
    except subprocess.TimeoutExpired:
        return {"available": False, "reason": "timed out"}
    except Exception as error:
        return {"available": False, "reason": str(error)}


def advisory_ids(nodes, distance):
    by_id = {node.get("id"): node for node in nodes if isinstance(node, dict)}
    selected = set()
    for node in by_id.values():
        head = by_id.get(node.get("head"))
        node_range = node.get("range")
        head_range = head.get("range") if head else None
        if isinstance(node_range, dict) and isinstance(head_range, dict):
            if abs(node_range.get("start", 0) - head_range.get("start", 0)) >= distance:
                selected.add(node["id"])
    return selected


parser = argparse.ArgumentParser()
parser.add_argument("--corpus", required=True, help="JSONL with text and expectedAdvisory ids")
parser.add_argument("--ginza-command", nargs="+", default=["python3", "scripts/dependency-parser.py"])
parser.add_argument("--kwja-command", nargs="+", default=["kwja", "--text"])
parser.add_argument("--timeout", type=float, default=30)
parser.add_argument("--distance", type=int, default=24)
parser.add_argument("--out", required=True)
args = parser.parse_args()
items = [json.loads(line) for line in open(args.corpus, encoding="utf-8") if line.strip()]
report = {
    "schemaVersion": 2,
    "corpus": args.corpus,
    "runtime": {"platform": platform.platform(), "python": platform.python_version()},
    "parsers": {},
}
for name, command in (("ginza", args.ginza_command), ("kwja", args.kwja_command)):
    runs = [run(command, item, args.timeout) for item in items]
    usable = [entry for entry in runs if entry["available"]]
    entry = {"command": command, "available": len(usable) == len(items), "runs": runs}
    if len(usable) == len(items):
        latencies = [result["latencyMs"] for result in usable]
        entry["latencyMs"] = {"cold": latencies[0], "p50": percentile(latencies, .5),
                              "p95": percentile(latencies, .95)}
        if all("expectedAdvisory" in item for item in items):
            expected = set().union(*(set(item["expectedAdvisory"]) for item in items))
            actual = set().union(*(advisory_ids(result["nodes"], args.distance) for result in usable))
            true_positive = len(expected & actual)
            entry["advisoryMetrics"] = {
                "truePositive": true_positive, "falsePositive": len(actual - expected),
                "falseNegative": len(expected - actual),
                "precision": true_positive / len(actual) if actual else (1 if not expected else 0),
                "recall": true_positive / len(expected) if expected else 1,
            }
        else:
            entry["advisoryMetricsUnavailable"] = "corpus labels are incomplete"
    else:
        failed = next(result for result in runs if not result["available"])
        entry["unavailableReason"] = failed["reason"]
    report["parsers"][name] = entry
with open(args.out, "w", encoding="utf-8") as output:
    json.dump(report, output, ensure_ascii=False, indent=2)
