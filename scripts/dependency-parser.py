#!/usr/bin/env python3
"""Optional GiNZA JSONL adapter; it never rewrites input text."""
import json
import sys

try:
    import spacy
    NLP = spacy.load("ja_ginza")
except Exception as error:  # Optional local model, so expose a stable capability error.
    NLP = None

def utf16(text):
    return len(text.encode("utf-16-le")) // 2

def handle(payload):
    request_id = payload.get("id")
    if NLP is None:
        return {"id": request_id, "ok": False, "error": "GiNZA model missing", "dependencies": []}
    text = payload.get("text", "")
    if not isinstance(text, str) or utf16(text) > 5000:
        return {"id": request_id, "ok": False, "error": "text must be a string of at most 5000 UTF-16 units", "dependencies": []}
    doc = NLP(text)
    nodes = []
    for sentence_index, sentence in enumerate(doc.sents):
        for token in sentence:
            start = utf16(text[:token.idx])
            end = start + utf16(token.text)
            nodes.append({"id": token.i, "text": token.text, "range": {"start": start, "end": end}, "head": None if token.head == token else token.head.i, "relation": token.dep_, "sentence": sentence_index})
    return {"id": request_id, "ok": True, "dependencies": nodes}

for line in sys.stdin:
    request_id = None
    try:
        payload = json.loads(line)
        if isinstance(payload, dict):
            request_id = payload.get("id")
        print(json.dumps(handle(payload), ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": request_id, "ok": False, "error": "dependency parsing failed", "dependencies": []}), flush=True)
