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
    elif text == "wrong-id":
        print(json.dumps({"id": item["id"] + 1, "ok": True, "dependencies": []}), flush=True)
    elif text == "old-response":
        print(json.dumps({"id": item["id"] - 33, "ok": True, "dependencies": []}), flush=True)
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": []}), flush=True)
    elif text == "exit":
        sys.exit(2)
    elif text == "huge-output":
        sys.stdout.write("x" * (513 * 1024))
        sys.stdout.flush()
    else:
        if text == "slow": time.sleep(0.2)
        if text == "brief": time.sleep(0.02)
        print(json.dumps({"id": item["id"], "ok": True, "dependencies": []}), flush=True)
