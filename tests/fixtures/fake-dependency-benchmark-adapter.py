#!/usr/bin/env python3
"""Deterministic JSONL protocol fixture for the comparison runner."""
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    text = request["text"]
    if text.startswith("長い"):
        nodes = [
            {"id": 0, "text": "長い", "range": {"start": 0, "end": 2}, "head": 1, "relation": "dep", "sentence": 0},
            {"id": 1, "text": "中心語", "range": {"start": 25, "end": 28}, "head": None, "relation": "root", "sentence": 0},
        ]
    else:
        nodes = [{"id": 0, "text": text[:1], "range": {"start": 0, "end": 1}, "head": None, "relation": "root", "sentence": 0}]
    print(json.dumps({"id": request["id"], "ok": True, "dependencies": nodes}, ensure_ascii=False), flush=True)
