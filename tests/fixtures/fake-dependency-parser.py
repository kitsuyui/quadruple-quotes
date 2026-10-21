#!/usr/bin/env python3
import json, sys, time
for line in sys.stdin:
    item = json.loads(line)
    text = item.get("text", "")
    if text == "malformed":
        print("not-json", flush=True)
    elif text == "model-missing":
        print(json.dumps({"id": item["id"], "ok": False, "error": "GiNZA model missing", "dependencies": []}), flush=True)
    elif text == "parse-failure":
        print(json.dumps({"id": item["id"], "ok": False, "error": "dependency parsing failed", "dependencies": []}), flush=True)
    elif text == "invalid-dependencies":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "x", "range": {"start": 2, "end": 1}, "head": -1, "relation": "dep", "sentence": -1}]}), flush=True)
    elif text == "duplicate-graph":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "a", "range": {"start": 0, "end": 1}, "head": None, "relation": "root", "sentence": 0}, {"id": 0, "text": "b", "range": {"start": 1, "end": 2}, "head": 0, "relation": "dep", "sentence": 0}]}), flush=True)
    elif text == "emoji-range":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "😀", "range": {"start": 1, "end": 2}, "head": None, "relation": "root", "sentence": 0}]}), flush=True)
    elif text == "😀x":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "😀", "range": {"start": 0, "end": 1}, "head": None, "relation": "root", "sentence": 0}]}), flush=True)
    elif text == "cycle-graph":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "c", "range": {"start": 0, "end": 1}, "head": 1, "relation": "dep", "sentence": 0}, {"id": 1, "text": "y", "range": {"start": 1, "end": 2}, "head": 0, "relation": "dep", "sentence": 0}]}), flush=True)
    elif text == "wrong-id":
        print(json.dumps({"id": item["id"] + 1, "ok": True, "dependencies": []}), flush=True)
    elif text == "primitive-node":
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": [None, False, 1]}), flush=True)
    elif text == "partial-then-exit":
        sys.stdout.buffer.write('{"id":'.encode() + str(item["id"]).encode() + ',"ok":true,"dependencies":[{"text":"'.encode() + "東".encode())
        sys.stdout.buffer.flush()
        sys.exit(2)
    elif text == "unicode-split":
        payload = json.dumps({"id": item["id"], "ok": True, "dependencies": [{"id": 0, "text": "unicode-split", "range": {"start": 0, "end": 13}, "head": None, "relation": "分割😀", "sentence": 0}]}, ensure_ascii=False, separators=(",", ":")).encode()
        split = payload.index("分".encode()) + 1
        sys.stdout.buffer.write(payload[:split])
        sys.stdout.buffer.flush()
        time.sleep(0.01)
        sys.stdout.buffer.write(payload[split:] + b"\n")
        sys.stdout.buffer.flush()
    elif text == "old-response":
        print(json.dumps({"id": item["id"] - 33, "ok": True, "dependencies": []}), flush=True)
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": []}), flush=True)
    elif text == "exit":
        sys.exit(2)
    elif text == "huge-output":
        sys.stdout.write("x" * (2 * 1024 * 1024 + 1))
        sys.stdout.flush()
    elif len(text) == 5000 and set(text) == {"x"}:
        dependencies = [{"id": index, "text": "x", "range": {"start": index, "end": index + 1}, "head": None if index == 4999 else index + 1, "relation": "dep", "sentence": 0} for index in range(5000)]
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": dependencies}, separators=(",", ":")), flush=True)
    else:
        if text == "slow": time.sleep(0.2)
        if text == "brief": time.sleep(0.02)
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": []}), flush=True)
